//! The asset substrate: the files a kind of document carries beside it, one
//! body of code for every kind. A home names the folder, the index table and
//! what a change owes afterwards; everything else (the path rules, the
//! allowlist, the size ceiling, containment, the per-file lock, the row heal)
//! is the same for every home. The overlay projection of the engram
//! attachments sits above this and is engram only.

use super::*;
use crystalline_core::ContentKind;
use crystalline_index::AssetTable;

/// Where a domain keeps the files of one kind of document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AssetHome {
    /// `assets/` at the domain root: the engram attachments.
    Engram,
    /// `reflections/assets/`: a Reflection's files. Rows in
    /// `reflection_asset`, a change marks the backup branch, never the evolve
    /// sweep, and a virtual domain has none (a Reflection needs files).
    Reflection,
}

impl AssetHome {
    /// The index table the home's rows live in.
    pub(crate) fn table(self) -> AssetTable {
        match self {
            AssetHome::Engram => AssetTable::Engram,
            AssetHome::Reflection => AssetTable::Reflection,
        }
    }

    /// The kind of document the home serves.
    pub(crate) fn kind(self) -> ContentKind {
        match self {
            AssetHome::Engram => ContentKind::Engram,
            AssetHome::Reflection => ContentKind::Reflection,
        }
    }

    /// The domain-relative path of the file the home names `path`.
    pub(crate) fn domain_rel(self, path: &str) -> String {
        format!("{}{path}", self.kind().root())
    }

    /// The miss every verb of this home reports, one spelling per home.
    fn missing(self, domain: &str, path: &str) -> String {
        match self {
            AssetHome::Engram => missing_attachment(domain, path),
            AssetHome::Reflection => {
                format!("no file '{path}' in the Reflection of '{domain}'")
            }
        }
    }

    /// What one file of the home is called in a log line.
    fn noun(self) -> &'static str {
        match self {
            AssetHome::Engram => "attachment",
            AssetHome::Reflection => "Reflection file",
        }
    }

    /// The answer for a virtual domain, which keeps no Reflection.
    fn no_virtual(self) -> EngineError {
        EngineError::Invalid(
            "a Reflection lives in a file domain; a virtual domain has no reflections/".into(),
        )
    }
}

/// Whether a write may replace a file that is already there.
#[derive(Debug)]
pub(crate) enum ReplaceRule {
    /// It may.
    Allow,
    /// It may not, and the caller is told this sentence (`Forbidden`).
    Refuse(String),
}

/// What a write landed as.
#[derive(Debug, Clone)]
pub(crate) struct WrittenAsset {
    /// The row that now describes the file.
    pub row: AttachmentRow,
    /// Whether the path held no file before.
    pub created: bool,
}

impl Engine {
    /// Every file of `home` in `domain`, metadata only, ordered by path.
    pub(crate) async fn asset_list_in(
        &self,
        home: AssetHome,
        domain: &str,
    ) -> Result<Vec<AttachmentRow>> {
        let (domain_id, _) = self.domain_source(domain).await?;
        let store = self.store.lock().await;
        Ok(store.list_assets(home.table(), domain_id).await?)
    }

    /// One file of `home`: its bytes and its metadata row.
    ///
    /// A file domain reads the file under its root; a virtual domain reads the
    /// stored blob. Either way an absent file is [`EngineError::NotFound`], the
    /// same miss an absent engram reports.
    ///
    /// The file arm heals the row it serves. A file can arrive behind the index
    /// (a `git pull`, an editor, a domain whose first sync has not run) and can
    /// change behind it the same way, so when the recorded row does not match
    /// the file's own size and modification instant the bytes just read are
    /// hashed and the row is refreshed through the same upsert the walker uses,
    /// in the home's own table. That keeps the sha a caller caches on
    /// describing exactly what it received. The match itself is the walker's
    /// stat prefilter, so the common case costs no hashing at all.
    pub(crate) async fn asset_read_in(
        &self,
        home: AssetHome,
        domain: &str,
        path: &str,
    ) -> Result<(Vec<u8>, AttachmentRow)> {
        validate_attachment_path(path)?;
        let (domain_id, source) = self.domain_source(domain).await?;
        match (home, &source) {
            (AssetHome::Engram | AssetHome::Reflection, ContentSource::File { root }) => {
                let abs = contained_asset_path(root, &home.domain_rel(path))?;
                // The stat comes first so an over-cap file is refused without
                // ever being read: the ceiling is enforced by the walker (which
                // skips such a file, so it has no row) and by the write, and a
                // read that hashed one anyway would both spend the memory and
                // mint a row the next full scan deletes again.
                let meta = match std::fs::metadata(&abs) {
                    Ok(meta) => meta,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        return Err(EngineError::NotFound(home.missing(domain, path)));
                    }
                    Err(source) => {
                        return Err(EngineError::Io {
                            path: abs.display().to_string(),
                            source,
                        });
                    }
                };
                if meta.len() > crystalline_core::MAX_ATTACHMENT_BYTES {
                    return Err(EngineError::Invalid(over_cap_error(path, meta.len())));
                }
                let bytes = match std::fs::read(&abs) {
                    Ok(bytes) => bytes,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        return Err(EngineError::NotFound(home.missing(domain, path)));
                    }
                    Err(source) => {
                        return Err(EngineError::Io {
                            path: abs.display().to_string(),
                            source,
                        });
                    }
                };
                // The bytes that were actually read decide, like the walker's
                // post-read check: a file that grew past the ceiling between
                // the stat and the read is caught here rather than served.
                if bytes.len() as u64 > crystalline_core::MAX_ATTACHMENT_BYTES {
                    return Err(EngineError::Invalid(over_cap_error(
                        path,
                        bytes.len() as u64,
                    )));
                }
                let modified = asset_modified(&abs);
                let store = self.store.lock().await;
                if let Some(row) = store.get_asset(home.table(), domain_id, path).await?
                    && row.size == bytes.len() as u64
                    && row.modified == modified
                {
                    return Ok((bytes, row));
                }
                let row = attachment_row(path, &bytes, modified)?;
                store.upsert_asset(home.table(), domain_id, &row).await?;
                Ok((bytes, row))
            }
            (AssetHome::Engram, ContentSource::Virtual) => {
                let store = self.store.lock().await;
                let row = store
                    .get_asset(home.table(), domain_id, path)
                    .await?
                    .ok_or_else(|| EngineError::NotFound(home.missing(domain, path)))?;
                let bytes = store
                    .read_attachment_blob(domain_id, path)
                    .await?
                    .ok_or_else(|| EngineError::NotFound(home.missing(domain, path)))?;
                Ok((bytes, row))
            }
            (AssetHome::Reflection, ContentSource::Virtual) => Err(home.no_virtual()),
        }
    }

    /// Create or replace one file of `home`, returning the row that now
    /// describes it and whether the path held no file before.
    ///
    /// Every gate runs before a byte is stored: the path rules and the
    /// extension allowlist ([`crystalline_core::validate_asset_path`]) and the
    /// size ceiling. A file domain then writes the bytes atomically under its
    /// root, with the joined path proven to stay inside it, and takes the same
    /// per-file lock every other file write takes so a concurrent replace
    /// cannot leave the row describing the loser's bytes. A virtual domain
    /// writes the row and then the blob, in that order, since the store keeps a
    /// blob without a row an error rather than an orphan; a blob write that
    /// fails takes the row back out with it, so a failure leaves the domain
    /// exactly as it found it rather than listing a path with no bytes.
    ///
    /// `replace` decides whether a file already at the path may be replaced;
    /// [`ReplaceRule::Refuse`] answers [`EngineError::Forbidden`] with its
    /// sentence. The check runs under the lock that serialises the write, so
    /// two racing writes cannot both find the path empty.
    ///
    /// Both kinds owe the home's after-change step afterwards
    /// (`Engine::after_asset_change`).
    pub(crate) async fn asset_write_in(
        &self,
        home: AssetHome,
        domain: &str,
        path: &str,
        bytes: Vec<u8>,
        replace: ReplaceRule,
    ) -> Result<WrittenAsset> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        validate_attachment_path(path)?;
        if bytes.len() as u64 > crystalline_core::MAX_ATTACHMENT_BYTES {
            return Err(EngineError::Invalid(over_cap_error(
                path,
                bytes.len() as u64,
            )));
        }
        let (domain_id, source) = self.domain_source(domain).await?;
        let written = match (home, &source) {
            (AssetHome::Engram | AssetHome::Reflection, ContentSource::File { root }) => {
                let abs = contained_asset_path(root, &home.domain_rel(path))?;
                // Held across the write and the row upsert, the file lock
                // before the store lock like every other writer here. See
                // `Engine::write_lock`.
                let lock = self.write_lock(&abs);
                let _guard = lock.lock().await;
                // The disk decides whether the path holds a file, not the
                // row: a file that arrived with no sync yet has none, and a
                // refused replace must still see it. The atomic write's rename
                // cannot report what it replaced, so this one stat stays, under
                // the lock so no racing write can slip in after it.
                let existed = abs.is_file();
                if existed && let ReplaceRule::Refuse(sentence) = &replace {
                    return Err(EngineError::Forbidden(sentence.clone()));
                }
                write_bytes(&abs, &bytes)?;
                // The modification instant is read back off the file rather
                // than taken from the clock, so it is the same value the sync
                // walker's stat prefilter compares against and an upload costs
                // no re-hash on the next scan.
                let row = attachment_row(path, &bytes, asset_modified(&abs))?;
                let store = self.store.lock().await;
                store.upsert_asset(home.table(), domain_id, &row).await?;
                WrittenAsset {
                    row,
                    created: !existed,
                }
            }
            (AssetHome::Engram, ContentSource::Virtual) => {
                let row = attachment_row(path, &bytes, Utc::now().to_rfc3339())?;
                let store = self.store.lock().await;
                // What was there before this write, so a failure can put it
                // back rather than approximate it.
                let previous = store.get_asset(home.table(), domain_id, path).await?;
                if previous.is_some()
                    && let ReplaceRule::Refuse(sentence) = &replace
                {
                    return Err(EngineError::Forbidden(sentence.clone()));
                }
                store.upsert_asset(home.table(), domain_id, &row).await?;
                // A failed blob write must leave the domain exactly as it found
                // it, which is two different things depending on what was
                // there. A replace: the upsert above moved the row's metadata
                // only - the blob belongs to the row and still holds the older
                // bytes - so restoring the recorded row restores the whole
                // attachment, and deleting instead would destroy an attachment
                // this write never got to replace. A create: nothing was there,
                // so the row this write inserted goes with it, or a listing
                // would advertise bytes that were never stored. Best effort
                // either way (the next write, or a scan of the file domain's
                // twin, reconciles), and the original error is what the caller
                // sees. A file domain needs none of this: the temp file is
                // renamed into place only on success, so a failed write leaves
                // the old file untouched.
                if let Err(e) = store.write_attachment_blob(domain_id, path, &bytes).await {
                    let undone = match &previous {
                        Some(prior) => store
                            .upsert_asset(home.table(), domain_id, prior)
                            .await
                            .err(),
                        None => store
                            .delete_asset(home.table(), domain_id, path)
                            .await
                            .err(),
                    };
                    if let Some(failed) = undone {
                        tracing::warn!(
                            "{} '{path}' in '{domain}' could not be rolled back after a failed blob write: {failed}",
                            home.noun()
                        );
                    }
                    return Err(e.into());
                }
                WrittenAsset {
                    row,
                    created: previous.is_none(),
                }
            }
            (AssetHome::Reflection, ContentSource::Virtual) => return Err(home.no_virtual()),
        };
        self.after_asset_change(home, domain);
        Ok(written)
    }

    /// Remove one file of `home`: the file or the blob, and the row.
    ///
    /// [`EngineError::NotFound`] when neither was there, so a caller can answer
    /// a miss. A file that is gone while its row stands (or the reverse, after
    /// a hand-edited domain) still counts as a delete: whichever half existed
    /// is removed and the pair ends up consistent.
    pub(crate) async fn asset_delete_in(
        &self,
        home: AssetHome,
        domain: &str,
        path: &str,
    ) -> Result<()> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        validate_attachment_path(path)?;
        let (domain_id, source) = self.domain_source(domain).await?;
        let mut file_removed = false;
        match (home, &source) {
            (AssetHome::Engram | AssetHome::Reflection, ContentSource::File { root }) => {
                let abs = contained_asset_path(root, &home.domain_rel(path))?;
                let lock = self.write_lock(&abs);
                let _guard = lock.lock().await;
                match std::fs::remove_file(&abs) {
                    Ok(()) => file_removed = true,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(source) => {
                        return Err(EngineError::Io {
                            path: abs.display().to_string(),
                            source,
                        });
                    }
                }
            }
            (AssetHome::Engram, ContentSource::Virtual) => {}
            (AssetHome::Reflection, ContentSource::Virtual) => return Err(home.no_virtual()),
        }
        let row_removed = {
            let store = self.store.lock().await;
            store.delete_asset(home.table(), domain_id, path).await?
        };
        if !file_removed && !row_removed {
            return Err(EngineError::NotFound(home.missing(domain, path)));
        }
        self.after_asset_change(home, domain);
        Ok(())
    }

    /// Move a file of `home` from `from` to `to` (paths inside the home's
    /// root), and its row with it. Refuses a destination that holds a file,
    /// so a move never overwrites. Both file locks are taken in byte order,
    /// so two crossing moves cannot wait on each other. Links to the file
    /// are the caller's: the substrate moves bytes and rows only.
    pub(crate) async fn asset_move_in(
        &self,
        home: AssetHome,
        domain: &str,
        from: &str,
        to: &str,
    ) -> Result<AttachmentRow> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        validate_attachment_path(from)?;
        validate_attachment_path(to)?;
        let (domain_id, source) = self.domain_source(domain).await?;
        let ContentSource::File { root } = &source else {
            return Err(match home {
                AssetHome::Reflection => home.no_virtual(),
                AssetHome::Engram => {
                    EngineError::Invalid(format!("a move of '{from}' needs a file domain"))
                }
            });
        };
        let src = contained_asset_path(root, &home.domain_rel(from))?;
        let dst = contained_asset_path(root, &home.domain_rel(to))?;
        if src == dst {
            return Err(EngineError::Invalid(format!(
                "'{from}' already is at '{to}'"
            )));
        }
        let row = {
            let (first, second) = if src < dst {
                (&src, &dst)
            } else {
                (&dst, &src)
            };
            let first = self.write_lock(first);
            let second = self.write_lock(second);
            let _first = first.lock().await;
            // Two spellings of one file (a letter-case rename on a
            // case-insensitive disk) share one lock: taken once, never twice.
            let _second = if Arc::ptr_eq(&first, &second) {
                None
            } else {
                Some(second.lock().await)
            };
            if !src.is_file() {
                return Err(EngineError::NotFound(home.missing(domain, from)));
            }
            if dst.exists() {
                return Err(EngineError::Conflict(format!(
                    "'{to}' already holds a file; remove it first or pick another name"
                )));
            }
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|source| EngineError::Io {
                    path: parent.display().to_string(),
                    source,
                })?;
            }
            std::fs::rename(&src, &dst).map_err(|source| EngineError::Io {
                path: dst.display().to_string(),
                source,
            })?;
            let bytes = std::fs::read(&dst).map_err(|source| EngineError::Io {
                path: dst.display().to_string(),
                source,
            })?;
            attachment_row(to, &bytes, asset_modified(&dst))?
        };
        {
            let store = self.store.lock().await;
            store.delete_asset(home.table(), domain_id, from).await?;
            store.upsert_asset(home.table(), domain_id, &row).await?;
        }
        self.after_asset_change(home, domain);
        Ok(row)
    }

    /// What a change to a file of `home` owes afterwards.
    fn after_asset_change(&self, home: AssetHome, domain: &str) {
        match home {
            // A human just added something the agent has not read yet, which
            // is exactly what a consolidation sweep is for.
            AssetHome::Engram => crate::maintenance::record_pending(domain),
            // A Reflection's file is the backup branch's business, never the
            // evolve sweep's (D4).
            AssetHome::Reflection => {
                self.mark_reflection_dirty(domain, crate::reflection_backup::BackupCause::Settled)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_engram_home_is_assets_at_the_domain_root() {
        assert_eq!(AssetHome::Engram.table(), AssetTable::Engram);
        assert_eq!(
            AssetHome::Engram.domain_rel("assets/flow.png"),
            "assets/flow.png"
        );
        assert_eq!(AssetHome::Engram.kind(), ContentKind::Engram);
    }

    #[test]
    fn the_reflection_home_is_assets_under_reflections() {
        assert_eq!(AssetHome::Reflection.table(), AssetTable::Reflection);
        assert_eq!(
            AssetHome::Reflection.domain_rel("assets/flow.png"),
            "reflections/assets/flow.png"
        );
        assert_eq!(AssetHome::Reflection.kind(), ContentKind::Reflection);
    }
}
