use super::*;
use crate::collab::session::{ComposeRefused, RoomDoc};

/// What [`Engine::relink_engram`] rewrote in one linking engram.
pub(super) struct Relinked {
    /// How many references changed.
    pub(super) references: usize,
    /// The linker's permalink.
    pub(super) permalink: String,
    /// Whether the rewrite composed into an open room rather than the file
    /// or the row.
    pub(super) live: bool,
}

/// Name one linking page or engram a move could not rewrite, in the shape
/// every move receipt's `links_failed` carries: `{ domain, path, reason }`.
/// Shared by the engram move, the reflection move and the reflection file
/// move, so the three receipts never drift apart. The caller logs it with
/// the context it has.
pub(super) fn note_link_failure(
    failed: &mut Vec<Value>,
    domain: &str,
    path: &str,
    e: &EngineError,
) {
    failed.push(json!({ "domain": domain, "path": path, "reason": e.to_string() }));
}

impl Engine {
    // --- move ----------------------------------------------------------------

    /// Move an engram to a new path, a new permalink or a new domain, and
    /// rewrite every reference that followed it there.
    ///
    /// A move is a refactoring. Source and destination may each be a file or
    /// virtual domain, so a move carries content between the two truths: a
    /// same-domain move renames the row in place (the id, and with it every
    /// chunk, embedding and bound reference, stays), a cross-domain move reads
    /// the source content and re-indexes it into the destination's source.
    ///
    /// **The permalink** is decided by `Engine::moved_permalink`: by default
    /// it follows the move only when it was in step with the old path, so a
    /// deliberate custom permalink survives a re-filing; `MoveParams::permalink`
    /// asks for the path's own, the current one, or a named one. A destination
    /// equal to the current path is the permalink-only rename - the repair for
    /// a permalink that drifted off its folder - and a move that changes
    /// neither path, domain nor permalink is refused as the no-op it is. The
    /// new permalink is written into the frontmatter `permalink:` line
    /// surgically, so the file and the row say the same thing and a later
    /// sync does not quietly put the old one back; `recorded_at` stays, and the
    /// `generated` block records the mover whenever the move changed the text.
    ///
    /// **Every address change rewrites every reference**, whether the domain,
    /// the permalink or both changed: `[[old]]`, `[[domain:old]]`, relation
    /// bullets and `crystalline://domain/old` URLs (see
    /// [`crystalline_core::relink`]), found through the index before the move
    /// and rewritten in each referencing engram's source of truth afterwards.
    /// A link by title is left alone unless the engram changed domain, since
    /// the title did not change and the link still resolves. `update_links`
    /// set to false skips the rewrite, as it always did.
    ///
    /// `scope` bounds the *side effect*, which is the half a surface cannot
    /// gate for itself. Whether this caller may write either end is decided at
    /// the edge (the REST write gate, the MCP domain gate); what only this
    /// function can decide is which other domains it rewrites a link inside.
    /// Those referencing engrams live in domains the mover may never have been
    /// shown. So the rewrite skips a domain this caller may not see: its link
    /// is left as it was - dangling, which its own members see as an
    /// unresolved-reference finding on the next sweep - rather than silently
    /// edited by somebody with no access to it, and the receipt's counts
    /// (`links_rewritten`, the engrams rewritten, and `references_rewritten`,
    /// the references inside them) cover the visible rewrites only, so a
    /// receipt never counts a file its reader may not know exists.
    pub async fn move_engram(&self, p: &MoveParams, scope: &crate::scope::Scope) -> Result<Value> {
        self.move_engram_as(p, None, scope).await
    }

    /// A move inside this actor's draft, under its two draft locks: its own
    /// function, so the locks end with it and every later step of
    /// [`Engine::move_engram_as`] (which closes rooms) runs with none held.
    async fn move_draft_locked(
        &self,
        view: &DomainView<'_>,
        p: &MoveParams,
        draft: DraftMove<'_>,
    ) -> Result<Value> {
        let DraftMove {
            who,
            src,
            src_source,
            dest_rel,
            cross,
            asked,
            mover,
        } = draft;
        // Two writes - a tombstone where the team's file is, an entry at
        // the destination - so two draft locks, taken in key order so two
        // moves that cross each other cannot each hold what the other
        // wants. `move_within` refuses a cross-domain move outright, so
        // both paths are this actor's own drafts in this one domain. See
        // `Engine::draft_lock`.
        let (first, second) = match src.path.as_str() <= dest_rel {
            true => (src.path.as_str(), dest_rel),
            false => (dest_rel, src.path.as_str()),
        };
        let low = self.draft_lock(&p.domain, who, first)?;
        let _low = low.lock().await;
        // A move onto its own path is the permalink-only rename (the caller
        // refused a no-op one), and its one path is taken once rather than
        // twice: one path is one lock.
        let high = match first == second {
            true => None,
            false => Some(self.draft_lock(&p.domain, who, second)?),
        };
        let _high = match &high {
            Some(lock) => Some(lock.lock().await),
            None => None,
        };
        view.move_within(p, src, src_source, dest_rel, cross, asked, mover)
            .await
    }

    /// [`Engine::move_engram`] with the mover's identity, resolved by
    /// [`Engine::actor`] (or, for a draft, the composed identity) and written
    /// into the moved engram's `generated` block when the move changes its
    /// text. The engrams whose references are rewritten record Crystalline
    /// itself instead: the mover did not author them.
    pub async fn move_engram_as(
        &self,
        p: &MoveParams,
        client: Option<&str>,
        scope: &crate::scope::Scope,
    ) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        // One engram move at a time in this process. A move gathers the
        // engrams that link it before it writes and rewrites them after it
        // moved; two moves running at once could each find a linker the
        // other has just moved away, and leave a link to the old address.
        // Taken first, before any write ticket, so a move waiting here holds
        // nothing a rename or another move waits for.
        let _one_move = self.lock_moves().await;
        // Resolved once, before anything is written, and used twice below: to
        // look the destination up, and to bound the inbound rewrite.
        let hidden = self.hidden_for(scope).await?;
        let p = &self.localized(p, &hidden).await;
        let view = DomainView::for_write(self, &p.domain, scope).await?;
        let overlay = view.actor();
        let (src, src_source) = match view.resolve(&p.identifier).await {
            Ok(resolved) => resolved,
            Err(EngineError::NotFound(missing)) => {
                self.refuse_reflection_identifier(&p.domain, &p.identifier)
                    .await?;
                return Err(EngineError::NotFound(missing));
            }
            Err(e) => return Err(e),
        };
        // A hit can be a stale row: a file that became the Reflection's page
        // since the last sync still has its engram row until the next one.
        self.refuse_reflection_identifier(&p.domain, &src.path)
            .await?;
        let dest_domain = p
            .destination_domain
            .clone()
            .unwrap_or_else(|| p.domain.clone());
        // Scoped, and that is load bearing rather than tidy. This lookup raises
        // the one error that names every registered domain, and a surface gate
        // above it can only check the spelling it normalizes: a padded or empty
        // `destination_domain` passes a gate that trims or skips it and arrives
        // here verbatim. Resolving it against the caller's own visible set
        // closes that for every spelling, present and future, instead of asking
        // one more pair of normalizers to agree.
        let dest_source = self.content_source_scoped(&dest_domain, &hidden)?;
        let dest_rel = normalize_md(&p.destination);
        if dest_rel.is_empty() {
            return Err(EngineError::Invalid("destination path is empty".into()));
        }
        // As on the create path: `normalize_md` drops empty segments but keeps
        // `..`, so containment is decided here, before either reserved check
        // reads the destination as text and before `join_rel` builds a path
        // from it.
        if !is_within_domain(&dest_rel) {
            return Err(EngineError::Invalid(escapes_root_error(&dest_rel)));
        }
        if crystalline_core::is_reserved_path(&dest_rel) {
            return Err(EngineError::Invalid(reserved_name_error(&dest_rel)));
        }
        // The declared switch of the destination domain: an engram may move
        // out of a folder whose switch waits for it, never into one.
        refuse_reserved_destination(
            &dest_rel,
            ReflectionMode::declared(self.reflection_switch(&dest_domain)),
        )?;
        let cross = dest_domain != p.domain;
        // A move into another domain writes there too, so it is counted there
        // for the whole move: a rename of the destination waits for it, and a
        // destination a rename has paused is waited for first.
        let _dest_ticket = if cross {
            Some(self.enter_write(&dest_domain).await?)
        } else {
            None
        };
        // The source was checked by its write view; a move into another
        // domain writes there too, so the destination is asked the same way,
        // inside its ticket and before anything is written at either end.
        if cross {
            self.refuse_read_only_domain(&dest_domain, scope).await?;
        }
        let new_permalink = Self::moved_permalink(&src, &dest_rel, p.permalink.as_deref())?;
        let in_place = !cross && dest_rel == src.path;
        // A file domain's MANIFEST never leaves its place, in a draft either:
        // the domain needs it. A rename of its permalink in place keeps it.
        if !in_place {
            refuse_manifest_removal(&src_source, &src.path)?;
        }
        if in_place && new_permalink == src.permalink {
            return Err(EngineError::Invalid(format!(
                "'{}' already sits at '{dest_rel}' and answers to '{new_permalink}', so this \
                 move changes nothing; to rename it in place pass a permalink (\"path\" for the \
                 destination path's own)",
                src.permalink
            )));
        }
        // Whether the engram answers to a different address afterwards, which
        // is what every reference to it has to follow.
        let readdressed = cross || new_permalink != src.permalink;

        // A move onto the MANIFEST writes the moved text as the MANIFEST, so it
        // meets the switch-on rule every MANIFEST writer meets (decision D10),
        // before anything is written at either end and before the review-mode
        // branch, which writes a draft of it. A taken MANIFEST.md is refused
        // later as a collision; this is the move onto a missing one. The name
        // is compared in any letter case, as the write paths do: a
        // case-insensitive filesystem (the macOS and Windows defaults) opens
        // `manifest.md` as the very `MANIFEST.md` routing reads.
        // The text the screens below read, kept so the move can tell whether
        // the text it reads again under its locks is still that text.
        let mut screened: Option<String> = None;
        if names_the_manifest(&dest_rel) {
            // In a reviewing domain the move writes the mover's draft, so the
            // text that lands is what they see: their own draft when they hold
            // one, the base text otherwise. The miss below is reached only when
            // the mover's tombstone lands between `view.resolve` above and this
            // read; otherwise the resolve answers the same miss first.
            let text = match overlay {
                Some(_) => view.text_at(&src_source, &src).await?.ok_or_else(|| {
                    EngineError::NotFound(format!(
                        "no engram '{}' in domain '{}'",
                        p.identifier, p.domain
                    ))
                })?,
                None => self.move_source_text(&src_source, &src, &p.domain).await?,
            };
            self.refuse_read_only_switch_on(&dest_domain, &text, scope)
                .await?;
            // No MANIFEST stands there before the move.
            self.screen_manifest_write(&dest_domain, Some(""), &text)
                .await?;
            screened = Some(text);
        }

        // The third place a move can land, and it is two writes rather than
        // one: a tombstone where the team's file is, so this actor stops
        // seeing the engram there, and an entry at the destination, so they
        // see it where they moved it to. The folder itself does not move,
        // which is the whole of review mode - the rename is reviewed like any
        // other change.
        if let Some(who) = overlay {
            // A draft's permalink changes only when the caller names one. The
            // default rule stays out of review mode on purpose: a moved draft
            // is paired with the team's engram it came from by the address it
            // carries (the fold and the pull's rename-follow both key on it),
            // so a draft that quietly took the path's slug would stop reading
            // as a move of that engram and start reading as a new one.
            let asked = p
                .permalink
                .as_deref()
                .filter(|asked| !asked.trim().is_empty())
                .map(|_| new_permalink.as_str());
            let mover = self.actor_for(client, overlay);
            let draft = DraftMove {
                who,
                src: &src,
                src_source: &src_source,
                dest_rel: &dest_rel,
                cross,
                asked,
                mover: &mover,
            };
            return self.move_draft_locked(&view, p, draft).await;
        }

        // A move onto the MANIFEST may move the destination's switch.
        let switch_before =
            names_the_manifest(&dest_rel).then(|| self.reflection_switch(&dest_domain));

        // After the overlay branch, so a move OUT of a reviewing domain keeps
        // its own refusal ("share the change first"), and before anything is
        // read or written, so a refusal costs nothing. This is the move INTO
        // one: the view above is the SOURCE domain's, so a move from a domain
        // that takes changes directly would otherwise write the destination's
        // folder - the engram and every attachment it carries.
        if cross {
            self.refuse_write_into_reviewed_folder(
                &dest_domain,
                "a move from another domain cannot land there",
            )?;
        }

        // Destination collision checks, all of them before the first write so a
        // refusal leaves nothing half done: the path on disk or in the
        // database (an in-place rename is its own destination), then the
        // address, which the unique index would otherwise refuse only at the
        // reindex - after the file had already landed.
        if !in_place {
            self.ensure_dest_free(
                &dest_source,
                &dest_domain,
                &dest_rel,
                &src_source,
                &src.path,
                cross,
            )
            .await?;
        }
        if readdressed {
            self.refuse_permalink_held(&dest_domain, &new_permalink, &src, cross)
                .await?;
            self.refuse_under_live_rooms(&p.domain, &[RoomDoc::Engram(src.permalink.clone())])
                .await?;
        }

        // Gather the referencing engrams before the move, while every bound
        // reference's `to_id` still points at the source row.
        let update_links = p.update_links.unwrap_or(true);
        let linkers = if readdressed && update_links {
            self.move_linkers(&src, &hidden).await?
        } else {
            Vec::new()
        };
        // Every other domain the rewrite will write into is counted for the
        // rest of the move, as the source and the destination are, so a
        // rename of a linker's domain waits for the move instead of racing
        // its rewrite. Entered once, up front, and never for a domain this
        // move already holds: a rename that paused it would wait for this
        // move while this move waited for the rename. A domain a rename has
        // paused is not waited for: moves run one at a time, so waiting
        // would hold every other move back for as long as the rename may
        // take. Its linkers are not written and are named in the receipt.
        let mut linker_tickets = Vec::new();
        let mut paused: HashMap<String, EngineError> = HashMap::new();
        for linker in &linkers {
            let domain = linker.domain.as_str();
            if domain == p.domain
                || domain == dest_domain
                || paused.contains_key(domain)
                || linker_tickets.iter().any(|(held, _)| held == domain)
            {
                continue;
            }
            match self.try_enter_write(domain) {
                Ok(ticket) => linker_tickets.push((domain.to_string(), ticket)),
                Err(e) => {
                    paused.insert(domain.to_string(), e);
                }
            }
        }
        let spec = Relink {
            from_domain: &p.domain,
            from_permalink: &src.permalink,
            title: &src.title,
            to_domain: &dest_domain,
            to_permalink: &new_permalink,
        };

        // The source's and the destination's write locks, from the read of
        // the source through the write, the removal and the reindex, as every
        // other writer of either file takes them: an edit of the source
        // cannot land between the read and the removal and be lost, nor after
        // the removal and bring the source back. Both in lock key order; an
        // in-place move takes one. A virtual end takes none, since the store
        // writes it in one statement. Released before the attachments and the
        // linkers, so the rewrite below never holds two file locks.
        let src_abs = match &src_source {
            ContentSource::File { root } => Some(join_rel(root, &src.path)),
            ContentSource::Virtual => None,
        };
        let dest_abs = match &dest_source {
            ContentSource::File { root } => Some(join_rel(root, &dest_rel)),
            ContentSource::Virtual => None,
        };
        let held: Vec<&Path> = src_abs
            .iter()
            .chain(dest_abs.iter())
            .map(PathBuf::as_path)
            .collect();
        let _lock = self.lock_files(&held).await;
        // The destination was free when it was checked above; it is asked
        // again now that nobody else may write it.
        if !in_place {
            self.ensure_dest_free(
                &dest_source,
                &dest_domain,
                &dest_rel,
                &src_source,
                &src.path,
                cross,
            )
            .await?;
        }

        // Read here for the write, inside the locks, by the strict reader the
        // MANIFEST check above uses too (see [`Engine::move_source_text`]).
        let original = self.move_source_text(&src_source, &src, &p.domain).await?;
        // The screens above read the source before these locks were taken, so
        // an edit may have landed in between. A text that changed since is
        // screened again here, where it can no longer change. The screens
        // take no file lock, so running them under these is safe.
        if let Some(screened) = &screened
            && *screened != original
        {
            self.refuse_read_only_switch_on(&dest_domain, &original, scope)
                .await?;
            self.screen_manifest_write(&dest_domain, Some(""), &original)
                .await?;
        }
        // A move writes the engram anew, so it lands as LF whatever line
        // endings it was read with, a plain rename included.
        let original = crystalline_core::to_lf(&original).into_owned();
        // The text the engram lands with, when the move has to change it: the
        // permalink line, and its own references to itself. `None` is the
        // plain rename, which carries the bytes across untouched.
        let moved_text = Self::readdressed_text(
            &original,
            &dest_rel,
            &new_permalink,
            (readdressed && update_links).then_some(&spec),
            &self.actor(client),
        )?;

        // What the move carries besides the engram: the attachments it
        // references or claims. Filled in the cross-domain branch and acted on
        // once every store lock that branch takes has been released. Beside it,
        // the attachments the plan could not carry, which ride out in the
        // receipt so a caller who never sees the daemon's trace still learns
        // what stayed behind.
        let mut carried: Vec<AttachmentCarry> = Vec::new();
        let mut attachment_warnings: Vec<String> = Vec::new();
        // The checksum of the text that landed at the destination, for the
        // change this move announces at its tail.
        let moved_checksum: String;

        if cross {
            // Index the content into the destination source, then remove the
            // source.
            let mut content = moved_text.clone().unwrap_or_else(|| original.clone());
            // Resolved before the write, since an attachment that has to be
            // renamed at the destination changes the very text being written:
            // the engram lands already pointing at the name its file took.
            (carried, attachment_warnings) = self
                .plan_attachment_carry(&src, &dest_domain, &content)
                .await;
            let renames: BTreeMap<String, String> = carried
                .iter()
                .filter(|carry| carry.to != carry.from)
                .map(|carry| (carry.from.clone(), carry.to.clone()))
                .collect();
            if !renames.is_empty() {
                content = rewrite_carried_refs(&content, &renames);
            }
            // The moved engram's own text passes through the same funnel
            // every other write's final text does: a cross-domain link it
            // carries, spelled with an alias or a non-canonical local name,
            // is written with the canonical one instead. The move's own
            // relink pass above only follows THIS engram's address; a link to
            // some other domain is untouched by it and would otherwise cross
            // domains still spelled however it was written.
            let (content, _) = self.normalize_domain_spellings(&content, &hidden).await;
            moved_checksum = sha256_hex(content.as_bytes());
            match &dest_source {
                ContentSource::File { root } => {
                    let dest_abs = join_rel(root, &dest_rel);
                    write_file(&dest_abs, &content)?;
                    let store = self.store.lock().await;
                    let dest_id = store
                        .upsert_domain(
                            &dest_domain,
                            Some(&root.to_string_lossy()),
                            DomainKind::File,
                        )
                        .await?;
                    self.reindex_file(&*store, dest_id, root, &dest_rel).await?;
                }
                ContentSource::Virtual => {
                    let store = self.store.lock().await;
                    let dest_id = store
                        .upsert_domain(&dest_domain, None, DomainKind::Virtual)
                        .await?;
                    let stamp = virtual_stamp(&content);
                    self.index_markdown(&*store, dest_id, &dest_rel, &content, stamp, None, true)
                        .await?;
                }
            }
            if let ContentSource::File { root } = &src_source {
                let src_abs = join_rel(root, &src.path);
                if let Err(e) = std::fs::remove_file(&src_abs) {
                    tracing::warn!(
                        "could not remove moved source {}: {e}; leaving it in place",
                        src_abs.display()
                    );
                }
            }
            let store = self.store.lock().await;
            // One transaction for the source row, as the index half of a
            // delete has: the row, its children and the unbinding of every
            // reference that named it land together.
            store.begin().await?;
            if let Err(e) = store.delete_engram(src.domain_id, &src.path).await {
                let _ = store.rollback().await;
                return Err(e.into());
            }
            store.commit().await?;
        } else {
            // Same-domain rename: move the file when file-backed, then give the
            // row its new path and permalink in place, keeping its id. A move
            // that did not change the text needs no reparse; one that did is
            // reindexed from what was written, so the row reads the file.
            //
            // When the move DID change the text (a permalink line, or a
            // relinked self-reference), that text passes through the same
            // funnel every other write's final text does: a cross-domain
            // link it carries to some other domain, spelled with an alias or
            // a non-canonical local name, is written with the canonical one
            // instead. Byte-identical carries (`None`) are untouched, so an
            // ordinary rename never rewrites content the move itself did not
            // touch.
            let moved_text = match moved_text {
                Some(text) => Some(self.normalize_domain_spellings(&text, &hidden).await.0),
                None => None,
            };
            // A plain rename carries `original` across byte for byte; a
            // readdressing one lands `moved_text`.
            moved_checksum = sha256_hex(
                moved_text
                    .as_deref()
                    .map_or(original.as_bytes(), str::as_bytes),
            );
            if let ContentSource::File { root } = &src_source {
                let src_abs = join_rel(root, &src.path);
                let dest_abs = join_rel(root, &dest_rel);
                // A letter-case rename on a case-insensitive disk renames the
                // file first (atomic, and it stays on disk under one name or
                // the other if the write fails), then writes the new text.
                let case_only = !cross
                    && !in_place
                    && is_case_only_rename(&src_abs, &dest_abs, &src.path, &dest_rel);
                if case_only {
                    std::fs::rename(&src_abs, &dest_abs).map_err(|source| EngineError::Io {
                        path: dest_abs.display().to_string(),
                        source,
                    })?;
                }
                match &moved_text {
                    Some(text) => write_file(&dest_abs, text)?,
                    None => write_bytes(&dest_abs, original.as_bytes())?,
                }
                if !in_place && !case_only {
                    std::fs::remove_file(&src_abs).map_err(|source| EngineError::Io {
                        path: src_abs.display().to_string(),
                        source,
                    })?;
                }
            }
            let store = self.store.lock().await;
            store
                .readdress_engram(src.domain_id, &src.path, &dest_rel, &new_permalink)
                .await?;
            if let Some(text) = &moved_text {
                match &src_source {
                    ContentSource::File { root } => {
                        self.reindex_file(&*store, src.domain_id, root, &dest_rel)
                            .await?;
                    }
                    ContentSource::Virtual => {
                        self.index_markdown(
                            &*store,
                            src.domain_id,
                            &dest_rel,
                            text,
                            virtual_stamp(text),
                            None,
                            true,
                        )
                        .await?;
                    }
                }
            } else if readdressed {
                // A reference somebody wrote ahead of time to the new address
                // binds now rather than at the next sync. The reindex arm above
                // resolves inside its own transaction.
                store.resolve_pending_relations(src.domain_id).await?;
                store.resolve_pending_links(src.domain_id).await?;
            }
        }

        drop(_lock);

        // The attachments follow the engram, now that the engram itself has
        // landed and the branch above has released its store lock. A
        // same-domain move carries nothing: an `assets/` reference is
        // domain-root relative, so a rename inside one domain leaves every one
        // of them valid as written.
        if !carried.is_empty() {
            self.carry_attachments(&src.domain, &dest_domain, &carried)
                .await;
        }

        // Rewrite every reference that followed the engram. The referencing
        // engrams were not authored by whoever asked for the move, so their
        // refreshed `generated.by` records Crystalline itself (or the
        // configured `identity.actor`), not the moving client. A referencing
        // engram that cannot be rewritten is logged and skipped rather than
        // failing the call: the move is committed by this line, and an error
        // now would report a move that happened as one that did not. The
        // receipt names it in `links_failed`, as a reflection move does.
        let linker_actor = self.actor(None);
        let mut rewritten: Vec<Value> = Vec::new();
        let mut failed: Vec<Value> = Vec::new();
        let mut references = 0usize;
        for linker in &linkers {
            if let Some(e) = paused.get(&linker.domain) {
                tracing::warn!(
                    domain = linker.domain.as_str(),
                    path = linker.path.as_str(),
                    "the move could not rewrite the references in this engram: {e}"
                );
                note_link_failure(&mut failed, &linker.domain, &linker.path, e);
                continue;
            }
            match self
                .relink_engram(linker, &spec, &linker_actor, &hidden)
                .await
            {
                Ok(Some(relinked)) => {
                    references += relinked.references;
                    let mut entry =
                        json!({ "domain": linker.domain, "permalink": relinked.permalink });
                    // Written into a room somebody has open, which saves it.
                    if relinked.live {
                        entry["landed"] = json!("live");
                    }
                    rewritten.push(entry);
                }
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(
                        domain = linker.domain.as_str(),
                        path = linker.path.as_str(),
                        "the move could not rewrite the references in this engram: {e}"
                    );
                    note_link_failure(&mut failed, &linker.domain, &linker.path, &e);
                }
            }
        }

        // When either end of the move is a virtual domain, a MANIFEST engram
        // may have moved into or out of it, so refresh the routing cache. Every
        // store lock taken above is released by here.
        if matches!(src_source, ContentSource::Virtual)
            || matches!(dest_source, ContentSource::Virtual)
        {
            self.refresh_routing_cache().await;
        }
        // A move empties one folder and fills another, so both ends need their
        // index files back in step; a same-domain move refreshes once.
        self.refresh_index_files(&p.domain).await;
        if cross {
            self.refresh_index_files(&dest_domain).await;
        }

        // The address the engram answers to at its destination, asked rather
        // than assumed, exactly as `save_engram` asks: a permalink that was
        // derived from the path follows the move (the store's rename says so
        // in as many words), so a receipt repeating the one it went in with
        // would name a permalink that no longer resolves on the very calls
        // that changed it. The move is committed by this line, so the asking is
        // tolerant: a missing row and a failing lookup alike fall back to the
        // name it went in with rather than failing a done move - see
        // [`receipt_permalink`].
        let dest_permalink = {
            let store = self.store.lock().await;
            let found = store
                .list_engrams(&dest_domain, Some(&dest_rel), None)
                .await
                .map_err(EngineError::from)
                .map(|rows| {
                    rows.into_iter()
                        .find(|found| found.path == dest_rel)
                        .map(|found| found.permalink)
                });
            receipt_permalink(found, new_permalink.clone())
        };

        // A subscriber may see only one of two domains, so a cross-domain
        // move is a `deleted` in the source and an `added` in the
        // destination; a rename inside one domain, a permalink-only rename in
        // place included, is one `moved` with `from`. The linkers the move
        // rewrote announced themselves in `relink_engram`.
        let label = change_label(scope);
        if cross {
            self.announce(Change::Engram(EngramChanged {
                domain: p.domain.clone(),
                permalink: src.permalink.clone(),
                path: src.path.clone(),
                kind: ChangeKind::Deleted,
                from: None,
                checksum: None,
                actor: label.clone(),
                draft_of: None,
                audience: None,
            }));
            self.announce(Change::Engram(EngramChanged {
                domain: dest_domain.clone(),
                permalink: dest_permalink.clone(),
                path: dest_rel.clone(),
                kind: ChangeKind::Added,
                from: None,
                checksum: Some(moved_checksum),
                actor: label,
                draft_of: None,
                audience: None,
            }));
        } else {
            self.announce(Change::Engram(EngramChanged {
                domain: p.domain.clone(),
                permalink: dest_permalink.clone(),
                path: dest_rel.clone(),
                kind: ChangeKind::Moved,
                from: Some(MovedFrom {
                    path: src.path.clone(),
                    permalink: src.permalink.clone(),
                }),
                checksum: Some(moved_checksum),
                actor: label,
                draft_of: None,
                audience: None,
            }));
        }
        // Moving the last engram out of `reflections/`, or a file onto the
        // MANIFEST, can move a Reflection's mode in either domain.
        self.heal_reflection_rows_after(&p.domain, &src.path).await;
        if cross || src.path != dest_rel {
            self.heal_reflection_rows_after(&dest_domain, &dest_rel)
                .await;
        }
        if let Some(before) = switch_before {
            self.announce_switch_if_moved(&dest_domain, before, change_label(scope));
        }
        // The new address may be what a link in another domain has been
        // waiting for. A draft move returned above, through `move_within`.
        if readdressed {
            self.bind_references_to(&dest_domain, &dest_permalink, &src.title)
                .await;
        }

        // `links_rewritten` counts engrams, as it always has; the references
        // inside them are `references_rewritten`, and `rewritten` names the
        // engrams so a caller can re-read what changed under it.
        // `links_failed` appears only when a linker could not be rewritten.
        let mut receipt = json!({
            "from": { "domain": p.domain, "permalink": src.permalink, "path": src.path },
            "to": { "domain": dest_domain, "permalink": dest_permalink, "path": dest_rel },
            "cross_domain": cross,
            "links_rewritten": rewritten.len(),
            "references_rewritten": references,
            "rewritten": rewritten,
            "attachment_warnings": attachment_warnings,
        });
        if !failed.is_empty() {
            receipt["links_failed"] = json!(failed);
        }
        Ok(receipt)
    }

    /// The permalink a moved engram answers to at `dest_rel`.
    ///
    /// Omitted, the permalink follows the move only when it was **in step**
    /// with the old path - equal to the slug the old path derives, which is
    /// also what an engram with no `permalink:` line answers to - and stays
    /// otherwise, since a permalink that differs from its path was either
    /// chosen on purpose or drifted, and only the caller knows which. `"path"`
    /// takes the destination path's own, `"keep"` keeps the current one
    /// whatever it is, and any other value is validated as a permalink and
    /// taken as given. The two keywords are why neither can be asked for as a
    /// literal permalink; an engram that should answer to `path` is written
    /// to `path.md` and moved with `"path"`.
    fn moved_permalink(
        src: &EngramDescriptor,
        dest_rel: &str,
        asked: Option<&str>,
    ) -> Result<String> {
        let from_path = crystalline_core::path_permalink(dest_rel);
        let chosen = match asked.map(str::trim) {
            None | Some("") => {
                if src.permalink == crystalline_core::path_permalink(&src.path) {
                    from_path
                } else {
                    src.permalink.clone()
                }
            }
            Some("path") => from_path,
            Some("keep") => src.permalink.clone(),
            Some(named) => {
                crystalline_core::validate_permalink(named).map_err(EngineError::Invalid)?;
                named.to_string()
            }
        };
        if chosen.is_empty() {
            return Err(EngineError::Invalid(format!(
                "the destination '{dest_rel}' does not slugify to a permalink; use a path with \
                 letters or digits, or pass a permalink"
            )));
        }
        Ok(chosen)
    }

    /// The text a moved engram lands with, or `None` when the move leaves its
    /// bytes exactly as they are.
    ///
    /// Two things can change it. The `permalink:` line, rewritten surgically
    /// (or added) whenever what the text would answer to at `dest_rel` - its
    /// own `permalink:` line, or the destination path's slug when it has none -
    /// is not `new_permalink`: that is what makes `"keep"` hold for an engram
    /// whose permalink was only ever path-derived, and what makes the new
    /// address survive the next sync. And, when `relink` is given, the engram's
    /// references to itself, which follow it like everybody else's. Either
    /// change touches `generated` with the mover; `recorded_at` is never
    /// touched, because the knowledge was not recorded again.
    fn readdressed_text(
        original: &str,
        dest_rel: &str,
        new_permalink: &str,
        relink: Option<&Relink<'_>>,
        mover: &str,
    ) -> Result<Option<String>> {
        let engram = parse_engram(original).map_err(|e| {
            EngineError::Invalid(format!(
                "the engram does not parse ({e}); fix it before moving it"
            ))
        })?;
        let implied = engram
            .frontmatter
            .permalink
            .filter(|permalink| !permalink.is_empty())
            .unwrap_or_else(|| crystalline_core::path_permalink(dest_rel));
        let mut text = original.to_string();
        if implied != new_permalink {
            text = set_frontmatter_field(&text, "permalink", new_permalink);
        }
        if let Some(spec) = relink {
            text =
                crystalline_core::relink::relink(&text, spec.from_domain, spec.to_domain, spec).0;
        }
        Ok((text != original).then(|| touch_generated(&text, mover, None, now_offset())))
    }

    /// Refuse a move onto a permalink another engram in the destination domain
    /// already answers to, naming the holder, before anything is written.
    ///
    /// Asked by permalink alone: [`Store::find_engram`] also matches a title,
    /// and an engram titled like the new permalink does not hold the address.
    /// The moved engram itself is not a holder on a same-domain move, since
    /// its row is the one being readdressed.
    async fn refuse_permalink_held(
        &self,
        dest_domain: &str,
        new_permalink: &str,
        src: &EngramDescriptor,
        cross: bool,
    ) -> Result<()> {
        let holder = {
            let store = self.store.lock().await;
            store
                .find_engram(dest_domain, new_permalink)
                .await?
                .filter(|found| found.permalink == new_permalink)
                .filter(|found| cross || found.path != src.path)
        };
        match holder {
            Some(holder) => Err(EngineError::Conflict(format!(
                "permalink '{new_permalink}' is already held by '{}' in domain '{dest_domain}'; \
                 pick another permalink, or move that engram first",
                holder.path
            ))),
            None => Ok(()),
        }
    }

    /// Refuse a move while somebody has one of `docs` open in the co-editing
    /// editor: a room saves back to the document it was opened over, so a
    /// change underneath it would turn the editor's next save into a write
    /// to an address that no longer exists. Base rooms only: a move in review
    /// mode never reaches this, since it moves a draft. Checked before
    /// anything moves.
    ///
    /// An engram room is keyed on the permalink it was opened under and saves
    /// back to that permalink, so a move that changed it underneath would show
    /// the person typing the engram as deleted, and a later engram taking the
    /// old name would receive the save. A path-only move keeps the permalink
    /// and needs no refusal, so the caller asks only on a permalink change.
    pub(super) async fn refuse_under_live_rooms(
        &self,
        domain: &str,
        docs: &[RoomDoc],
    ) -> Result<()> {
        let Some(rooms) = self.collab_rooms() else {
            return Ok(());
        };
        for doc in docs {
            if !rooms.has_live_doc(domain, doc, None).await {
                continue;
            }
            return Err(EngineError::Conflict(match doc {
                RoomDoc::Engram(permalink) => format!(
                    "'{permalink}' is open in the editor right now, and moving it would change the \
                     address the editor saves to; close the editor and move it again"
                ),
                // A reflection room saves straight to its file: a move or a
                // delete, or a rewrite of its links, would race its next save.
                RoomDoc::Reflection(path) => {
                    format!("somebody is editing '{path}'; try again once the page is closed")
                }
            }));
        }
        Ok(())
    }

    /// The engrams whose references a move rewrites: every base engram with a
    /// relation or link that points at `src`, plus every one whose content
    /// holds its `crystalline://` URL (no edge table records those), in
    /// domains this caller may see, each once, `src` itself excluded - its own
    /// references travel with its text.
    pub(super) async fn move_linkers(
        &self,
        src: &EngramDescriptor,
        hidden: &HashSet<String>,
    ) -> Result<Vec<MoveLinker>> {
        let url = format!(
            "{}{}/{}",
            crystalline_core::address::SCHEME,
            src.domain,
            src.permalink
        );
        let (refs, mentions) = {
            let store = self.store.lock().await;
            (
                store
                    .inbound_refs(src.id, src.domain_id, &src.permalink, &src.title)
                    .await?,
                store.engrams_mentioning(&url).await?,
            )
        };
        let candidates = refs
            .into_iter()
            .map(|r| (r.src_domain, r.src_domain_id, r.src_path))
            .chain(
                mentions
                    .into_iter()
                    .map(|m| (m.domain, m.domain_id, m.path)),
            );
        let mut seen: HashSet<(i64, String)> = HashSet::new();
        let mut linkers = Vec::new();
        for (domain, domain_id, path) in candidates {
            if hidden.contains(&domain)
                || (domain_id == src.domain_id && path == src.path)
                // A read-only domain's link is left as it was, like a hidden
                // domain's (decision D7).
                || self.domain_is_read_only(&domain).await
            {
                continue;
            }
            if seen.insert((domain_id.0, path.clone())) {
                linkers.push(MoveLinker {
                    domain,
                    domain_id,
                    path,
                });
            }
        }
        Ok(linkers)
    }

    /// Rewrite the references to a moved engram inside one referencing engram,
    /// in its source of truth, then reindex it. Answers how many references
    /// changed and the engram's permalink, or `None` when its text held none
    /// after all - a content hit inside code, or a longer permalink.
    ///
    /// Written the way an edit writes, because an edit of the same engram may
    /// run beside the move. A file is read, rewritten and reindexed under its
    /// write lock, which every other writer of it takes too, so neither change
    /// is lost. A virtual row is written by the store's compare and swap, and
    /// a refused swap is applied again to the row stored now, as an unguarded
    /// edit is.
    ///
    /// While a co-editing room that will save is open over the linker, the
    /// room's text IS the engram, so the rewrite composes into it, the way an
    /// edit's live arm does: computed from the live text, it never collides
    /// with what a person is typing, and the room's own save writes it down
    /// and announces it. Neither the file nor the row is written behind that
    /// room, and the receipt marks the linker `landed: live`.
    ///
    /// A room that will not save what it is given (a conflict, a failed save,
    /// or one whose last connection left, whose final save has run or is
    /// running) gets nothing: the rewrite goes to the file or the row, and the
    /// room meets it as an external change on its next save, by its compare
    /// and swap and a three-way merge. The same holds when the room keeps
    /// moving under the compose because somebody is typing.
    ///
    /// Lock order: the room first, holding nothing else, then the file lock,
    /// then the store lock, as `edit_engram` takes them and as a room's save
    /// takes them. The move holds no other file lock and no store lock while
    /// it waits here, so an edit of this engram and the move cannot wait on
    /// each other.
    pub(super) async fn relink_engram(
        &self,
        linker: &MoveLinker,
        spec: &Relink<'_>,
        actor: &str,
        hidden: &HashSet<String>,
    ) -> Result<Option<Relinked>> {
        // The live arm. The room is keyed on the linker's permalink, which
        // the index knows; asked before any lock is taken, and only when a
        // room over one of this domain's engrams is open at all.
        if let Some(rooms) = self.collab_rooms()
            && rooms.has_engram_rooms_in(&linker.domain).await
            && let Some(desc) = self.descriptor_at(&linker.domain, &linker.path).await?
        {
            for attempt in 0..super::edit::UNGUARDED_EDIT_ATTEMPTS {
                let Some(live) = rooms.live_text(&linker.domain, &desc.permalink, None).await
                else {
                    break;
                };
                let Some((edited, references)) = self
                    .relinked_text(&live.text, linker, spec, actor, hidden)
                    .await
                else {
                    // The room holds no such reference. When it saves, that
                    // is what lands; when it does not, the source still may.
                    if live.saving {
                        return Ok(None);
                    }
                    break;
                };
                // Whether the room saves is decided again inside the compose,
                // under the lock the compose holds; that is the decision that
                // counts.
                match rooms
                    .compose_while_saving(
                        &linker.domain,
                        &desc.permalink,
                        None,
                        Some(&live.text),
                        edited,
                        actor,
                        None,
                    )
                    .await
                {
                    Ok(_) => {
                        return Ok(Some(Relinked {
                            references,
                            permalink: desc.permalink,
                            live: true,
                        }));
                    }
                    // Somebody is typing. Wait a moment before the next try,
                    // a little longer each time, so a person typing steadily
                    // still leaves a gap the rewrite can compose into.
                    Err(ComposeRefused::Moved) => {
                        if attempt + 1 < super::edit::UNGUARDED_EDIT_ATTEMPTS {
                            tokio::time::sleep(super::edit::LIVE_RETRY_PAUSE * (1 << attempt))
                                .await;
                        }
                        continue;
                    }
                    Err(ComposeRefused::NotSaving) => break,
                }
            }
            tracing::debug!(
                domain = linker.domain.as_str(),
                path = linker.path.as_str(),
                "the room over this linker will not take the move's rewrite, \
                 so it goes to the source and the room merges it on its next save"
            );
        }
        let source = self.read_source(&linker.domain);
        let (replaced, count, _lock) = match &source {
            ContentSource::File { root } => {
                let abs = join_rel(root, &linker.path);
                let lock = self.lock_file(&abs).await;
                let text = std::fs::read_to_string(&abs).map_err(|source| EngineError::Io {
                    path: abs.display().to_string(),
                    source,
                })?;
                let Some((replaced, count)) =
                    self.relinked_text(&text, linker, spec, actor, hidden).await
                else {
                    return Ok(None);
                };
                write_file(&abs, &replaced)?;
                let store = self.store.lock().await;
                self.reindex_file(&*store, linker.domain_id, root, &linker.path)
                    .await?;
                (replaced, count, Some(lock))
            }
            ContentSource::Virtual => {
                let mut attempt = 0usize;
                loop {
                    attempt += 1;
                    let stored = {
                        let store = self.store.lock().await;
                        match store.engram_content(linker.domain_id, &linker.path).await? {
                            Some(text) => text,
                            None => return Ok(None),
                        }
                    };
                    // Compared against the bytes as stored, before the LF
                    // pass below, as an edit compares them.
                    let expected = sha256_hex(stored.as_bytes());
                    let Some((replaced, count)) = self
                        .relinked_text(&stored, linker, spec, actor, hidden)
                        .await
                    else {
                        return Ok(None);
                    };
                    // The seam an edit's virtual arm has: a token nothing can
                    // match, never retried. See `Engine::fail_next_source_edit`.
                    let armed = self.take_armed_failure();
                    // And the race seam, which is retried like a real race.
                    // See `Engine::lose_next_relink_swap`.
                    let lost = self.take_lost_relink_swap();
                    let expected = if armed || lost {
                        "0".repeat(64)
                    } else {
                        expected
                    };
                    let store = self.store.lock().await;
                    let indexed = self
                        .index_markdown(
                            &*store,
                            linker.domain_id,
                            &linker.path,
                            &replaced,
                            virtual_stamp(&replaced),
                            Some(&expected),
                            true,
                        )
                        .await;
                    drop(store);
                    match indexed {
                        Ok(_) => break (replaced, count, None),
                        Err(e)
                            if !armed
                                && attempt < super::edit::UNGUARDED_EDIT_ATTEMPTS
                                && super::edit::is_stale_edit(&e) =>
                        {
                            tracing::debug!(
                                domain = linker.domain.as_str(),
                                path = linker.path.as_str(),
                                attempt,
                                "a move's rewrite lost a race with another writer; \
                                 applying it again to the stored text"
                            );
                        }
                        Err(e) => return Err(e),
                    }
                }
            }
        };
        drop(_lock);
        let permalink = parse_engram(&replaced)
            .ok()
            .and_then(|engram| engram.frontmatter.permalink)
            .filter(|permalink| !permalink.is_empty())
            .unwrap_or_else(|| crystalline_core::path_permalink(&linker.path));
        // The linker's own text changed, possibly in another domain, so its
        // page follows too.
        self.announce(Change::Engram(EngramChanged {
            domain: linker.domain.clone(),
            permalink: permalink.clone(),
            path: linker.path.clone(),
            kind: ChangeKind::Modified,
            from: None,
            checksum: Some(sha256_hex(replaced.as_bytes())),
            actor: Some(actor.to_string()),
            draft_of: None,
            audience: None,
        }));
        Ok(Some(Relinked {
            references: count,
            permalink,
            live: false,
        }))
    }

    /// The linker's text with the moved engram's references rewritten,
    /// stamped and normalized, and how many references changed; `None` when
    /// none did.
    async fn relinked_text(
        &self,
        text: &str,
        linker: &MoveLinker,
        spec: &Relink<'_>,
        actor: &str,
        hidden: &HashSet<String>,
    ) -> Option<(String, usize)> {
        // Rewritten as LF, the whole file, like every write.
        let text = crystalline_core::to_lf(text);
        let (relinked, count) =
            crystalline_core::relink::relink(&text, &linker.domain, &linker.domain, spec);
        if count == 0 {
            return None;
        }
        let replaced = touch_generated(&relinked, actor, None, now_offset());
        // The rewritten reference passes through the same funnel every other
        // write's final text does: `spec.to_domain` is the destination's
        // local name (moves are localized before they reach here), so
        // without this a linker would carry `[[<local-name>:...]]` even where
        // that local name is only an alias or a non-canonical spelling of the
        // domain's declared name. Called before the store lock is taken,
        // since it may itself need the store.
        let (replaced, _) = self.normalize_domain_spellings(&replaced, hidden).await;
        Some((replaced, count))
    }

    /// Rename a tag to `new`, or (with `merge`) fold it into an existing `new`,
    /// across every engram that carries it, optionally scoped to one domain.
    /// Each affected file is rewritten string-surgically by
    /// [`crystalline_core::retag`]: only the tag tokens change, every other byte
    /// (including the `generated` provenance block) is preserved, so a hygiene
    /// rename never
    /// reflows a file or looks like a fresh edit. Files are the source of truth,
    /// so each rewrite writes the file (or the virtual row) then reindexes it,
    /// which is where the index picks up the new tag identity.
    ///
    /// The two verbs differ only in a precheck: a `rename` refuses when `new`
    /// already exists (that would silently merge, so it points at `tags merge`),
    /// and a `merge` refuses when `new` does not exist yet. `dry_run` reports the
    /// affected engrams without writing anything.
    ///
    /// A non-dry-run `merge` with `record_alias` also records the fold as a tag
    /// alias: it appends `- old -> new` to each affected domain's MANIFEST
    /// `## Tag Aliases` section (creating the section when absent), so a later
    /// search for the old name still finds its engrams through the alias. The
    /// recording is idempotent and permissive: when the pair is already present
    /// the append no-ops and the domain still counts as recorded (a re-merge of a
    /// tag that reappeared must work, never be refused), and a domain with no
    /// MANIFEST lands in `alias_skipped` rather than erroring. When `old` is
    /// already aliased to a different canonical, first-wins parsing keeps the
    /// existing mapping, so a fresh bullet would be inert: the MANIFEST is left
    /// untouched and the domain is surfaced in `alias_conflict` rather than a
    /// false `alias_recorded`. The merge's tag rewrites still proceed either way;
    /// only the recording is skipped. A `rename` records nothing.
    ///
    /// A read-only domain is left out (named in `read_only_skipped`), and a
    /// retag scoped to one is refused.
    pub async fn retag(
        &self,
        old: &str,
        new: &str,
        domain: Option<&str>,
        merge: bool,
        dry_run: bool,
        record_alias: bool,
    ) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        // A retag of one read-only domain is refused; across every domain it
        // skips the read-only ones and names them (decision D7).
        if let Some(d) = domain {
            self.refuse_read_only_domain(d, &crate::scope::Scope::Unrestricted)
                .await?;
        }
        let old_f = old.trim().to_lowercase();
        let new_f = new.trim().to_lowercase();
        // Only the target name must be a canonical lowercase-with-hyphens tag:
        // the whole point of a rename or merge is to move a non-canonical `old`
        // (an underscore or separator variant that the cluster detection flags)
        // onto a clean name, so `old` only has to be a non-empty folded tag.
        if old_f.is_empty() {
            return Err(EngineError::Invalid(
                "the tag to rename or merge is empty".into(),
            ));
        }
        if !is_lower_hyphen(&new_f) {
            return Err(EngineError::Invalid(format!(
                "target tag '{new_f}' is not a lowercase-with-hyphens tag"
            )));
        }
        if old_f == new_f {
            return Err(EngineError::Invalid(
                "the old and new tag are the same".into(),
            ));
        }

        // What this instance has no registration for is not part of this verb's
        // world: not a tag that exists, not an engram to list, not a file to
        // rewrite. Resolved once, before the first store lock (the lock is not
        // reentrant), and threaded through both reads below.
        //
        // The privacy half of `hidden_for` is deliberately absent: renaming a
        // tag is `Scope::Unrestricted` only, so there is no caller here with a
        // narrower view than the machine's own.
        let unregistered = self.unregistered_domains().await?;

        // Precheck against the vocabulary in scope: a rename must not collide
        // with an existing tag, a merge must land on one.
        let new_exists = {
            let vocab = self.scoped_vocabulary(domain, &unregistered).await?;
            vocab.tags.iter().any(|t| t.name == new_f)
        };
        let scope = match domain {
            Some(d) => format!(" in domain '{d}'"),
            None => String::new(),
        };
        if merge {
            if !new_exists {
                return Err(EngineError::NotFound(format!(
                    "cannot merge into '{new_f}': no engram carries it{scope}"
                )));
            }
        } else if new_exists {
            return Err(EngineError::Conflict(format!(
                "tag '{new_f}' already exists{scope}; use `crystalline tags merge` to combine them"
            )));
        }

        // The engrams carrying the old tag, ordered by domain then path, with
        // every unregistered domain's dropped here at the single point where
        // the list is built: `listed`, the dry run, the rewrite loop, the count
        // and the alias recording all read from it, so one filter covers all of
        // them and no later addition can forget it.
        let (targets, read_only_skipped) = {
            let store = self.store.lock().await;
            let mut found = store.engrams_with_tag(&old_f, domain).await?;
            drop(store);
            found.retain(|d| !unregistered.contains(&d.domain));
            // A read-only domain is left out here too, for the same reason:
            // one filter covers the dry run, the rewrite and the alias
            // recording into its MANIFEST. Asked once per domain, after the
            // store guard is gone.
            let mut locked: HashMap<String, bool> = HashMap::new();
            let mut kept = Vec::with_capacity(found.len());
            for d in found {
                let is_locked = match locked.get(&d.domain) {
                    Some(known) => *known,
                    None => {
                        let known = self.domain_is_read_only(&d.domain).await;
                        locked.insert(d.domain.clone(), known);
                        known
                    }
                };
                if !is_locked {
                    kept.push(d);
                }
            }
            let mut skipped: Vec<String> = locked
                .into_iter()
                .filter_map(|(name, is_locked)| is_locked.then_some(name))
                .collect();
            skipped.sort();
            (kept, skipped)
        };
        let listed: Vec<Value> = targets
            .iter()
            .map(|d| json!({ "domain": d.domain, "permalink": d.permalink, "path": d.path }))
            .collect();

        if dry_run {
            let mut dry = json!({
                "old": old_f, "new": new_f, "merge": merge, "dry_run": true,
                "engrams": listed, "rewritten": targets.len(),
            });
            if !read_only_skipped.is_empty() {
                dry["read_only_skipped"] = json!(read_only_skipped);
            }
            return Ok(dry);
        }

        // Rewrite each engram, mirroring move_engram's file-vs-virtual branches.
        let mut rewritten = 0usize;
        // What each domain saw rewritten, announced once per domain after every
        // store lock is released, through the collapse rule a sync goes
        // through: a tag across a hundred engrams is one `domain` event.
        let mut pending = PendingAnnouncements::new(self);
        let retagged = |desc: &EngramDescriptor, edited: &str| PathChange {
            kind: crystalline_index::PathChangeKind::Modified,
            path: desc.path.clone(),
            from: None,
            from_permalink: None,
            permalink: Some(desc.permalink.clone()),
            checksum: Some(sha256_hex(edited.as_bytes())),
        };
        for desc in &targets {
            match self.read_source(&desc.domain) {
                ContentSource::File { root } => {
                    let abs = join_rel(&root, &desc.path);
                    let Ok(text) = std::fs::read_to_string(&abs) else {
                        continue;
                    };
                    let text = crystalline_core::to_lf(&text);
                    let Some((edited, _)) = crystalline_core::retag(&text, &old_f, &new_f) else {
                        continue;
                    };
                    write_file(&abs, &edited)?;
                    let store = self.store.lock().await;
                    self.reindex_file(&*store, desc.domain_id, &root, &desc.path)
                        .await?;
                    rewritten += 1;
                    pending.push_path(&desc.domain, retagged(desc, &edited));
                }
                ContentSource::Virtual => {
                    let current = {
                        let store = self.store.lock().await;
                        store.engram_content(desc.domain_id, &desc.path).await?
                    };
                    let Some(text) = current else { continue };
                    let text = crystalline_core::to_lf(&text);
                    let Some((edited, _)) = crystalline_core::retag(&text, &old_f, &new_f) else {
                        continue;
                    };
                    let stamp = virtual_stamp(&edited);
                    let store = self.store.lock().await;
                    self.index_markdown(
                        &*store,
                        desc.domain_id,
                        &desc.path,
                        &edited,
                        stamp,
                        None,
                        true,
                    )
                    .await?;
                    rewritten += 1;
                    pending.push_path(&desc.domain, retagged(desc, &edited));
                }
            }
        }

        let mut response = json!({
            "old": old_f, "new": new_f, "merge": merge, "dry_run": false,
            "engrams": listed, "rewritten": rewritten,
        });
        if !read_only_skipped.is_empty() {
            response["read_only_skipped"] = json!(read_only_skipped);
        }

        // Record the fold as a tag alias in each affected domain's MANIFEST, once
        // per distinct domain in first-seen order. Only a merge records, and only
        // when the caller did not opt out.
        if merge && record_alias {
            let mut domains: Vec<(String, DomainId)> = Vec::new();
            for desc in &targets {
                if !domains.iter().any(|(name, _)| *name == desc.domain) {
                    domains.push((desc.domain.clone(), desc.domain_id));
                }
            }

            let mut alias_recorded: Vec<String> = Vec::new();
            let mut alias_skipped: Vec<String> = Vec::new();
            let mut alias_conflict: Vec<String> = Vec::new();
            let mut virtual_manifest_changed = false;
            for (name, domain_id) in &domains {
                match self.read_source(name) {
                    ContentSource::File { root } => {
                        let abs = join_rel(&root, "MANIFEST.md");
                        let Ok(text) = std::fs::read_to_string(&abs) else {
                            alias_skipped.push(name.clone());
                            continue;
                        };
                        let text = crystalline_core::to_lf(&text);
                        match decide_alias_record(&text, &old_f, &new_f) {
                            AliasRecord::Recorded(edited) => {
                                write_file(&abs, &edited)?;
                                let store = self.store.lock().await;
                                self.reindex_file(&*store, *domain_id, &root, "MANIFEST.md")
                                    .await?;
                                alias_recorded.push(name.clone());
                                pending.push_path(name, manifest_change(&edited));
                            }
                            AliasRecord::AlreadyPresent => alias_recorded.push(name.clone()),
                            AliasRecord::Conflict => alias_conflict.push(name.clone()),
                        }
                    }
                    ContentSource::Virtual => {
                        let current = {
                            let store = self.store.lock().await;
                            store.engram_content(*domain_id, "MANIFEST.md").await?
                        };
                        let Some(text) = current else {
                            alias_skipped.push(name.clone());
                            continue;
                        };
                        let text = crystalline_core::to_lf(&text);
                        match decide_alias_record(&text, &old_f, &new_f) {
                            AliasRecord::Recorded(edited) => {
                                let stamp = virtual_stamp(&edited);
                                let store = self.store.lock().await;
                                self.index_markdown(
                                    &*store,
                                    *domain_id,
                                    "MANIFEST.md",
                                    &edited,
                                    stamp,
                                    None,
                                    true,
                                )
                                .await?;
                                virtual_manifest_changed = true;
                                alias_recorded.push(name.clone());
                                pending.push_path(name, manifest_change(&edited));
                            }
                            AliasRecord::AlreadyPresent => alias_recorded.push(name.clone()),
                            AliasRecord::Conflict => alias_conflict.push(name.clone()),
                        }
                    }
                }
            }

            // A rewritten virtual MANIFEST may have changed its routing bullets,
            // so refresh the cache once, after every store lock is released.
            if virtual_manifest_changed {
                self.refresh_routing_cache().await;
            }

            if let Value::Object(map) = &mut response {
                map.insert("alias_recorded".to_string(), json!(alias_recorded));
                map.insert("alias_skipped".to_string(), json!(alias_skipped));
                map.insert("alias_conflict".to_string(), json!(alias_conflict));
            }
        }

        // Retag carries no scope and stamps nobody. Announced here, or on any
        // early exit above, for every row that landed.
        drop(pending);
        Ok(response)
    }

    /// Refuse a move whose destination path is already taken, checking disk for
    /// a file domain and the database for a virtual one.
    async fn ensure_dest_free(
        &self,
        dest_source: &ContentSource,
        dest_domain: &str,
        dest_rel: &str,
        src_source: &ContentSource,
        src_rel: &str,
        cross: bool,
    ) -> Result<()> {
        let taken = match dest_source {
            // The source file itself at the destination (a letter-case rename
            // on a case-insensitive disk) is not a collision.
            ContentSource::File { root } => {
                let dest_abs = join_rel(root, dest_rel);
                // Never across domains: overlapping roots are not one domain.
                let itself = !cross
                    && matches!(src_source, ContentSource::File { root: r }
                        if is_case_only_rename(&join_rel(r, src_rel), &dest_abs, src_rel, dest_rel));
                let taken = dest_abs.exists() && !itself;
                if !taken && !itself {
                    // A destination whose file is missing here may still
                    // be the row of an engram only the previous host of a
                    // host move has.
                    let dest_id = self.store.lock().await.domain_id(dest_domain).await?;
                    if let Some(dest_id) = dest_id {
                        self.refuse_only_elsewhere(
                            dest_domain,
                            dest_id,
                            ElsewhereRow::Engram(dest_rel),
                        )
                        .await?;
                    }
                }
                taken
            }
            ContentSource::Virtual => {
                let store = self.store.lock().await;
                let dest_id = store
                    .upsert_domain(dest_domain, None, DomainKind::Virtual)
                    .await?;
                store.engram_content(dest_id, dest_rel).await?.is_some()
            }
        };
        if taken {
            return Err(EngineError::Conflict(format!(
                "destination '{dest_rel}' already exists in domain '{dest_domain}'"
            )));
        }
        Ok(())
    }
}

/// A MANIFEST rewrite as a path change: its permalink is left to the
/// announce's path fallback, since the alias recording never touches it.
fn manifest_change(edited: &str) -> PathChange {
    PathChange {
        kind: crystalline_index::PathChangeKind::Modified,
        path: "MANIFEST.md".to_string(),
        from: None,
        from_permalink: None,
        permalink: parse_engram(edited)
            .ok()
            .and_then(|engram| engram.frontmatter.permalink)
            .filter(|permalink| !permalink.is_empty()),
        checksum: Some(sha256_hex(edited.as_bytes())),
    }
}

impl Engine {
    /// The moved engram's whole text, frontmatter included, read from its
    /// source of truth. Stricter than the read path on purpose: a move
    /// re-emits the file at the destination, and a file domain's stored
    /// `content` column holds the body only, so falling back to it would strip
    /// the frontmatter off the engram that lands. Failing loudly is the only
    /// honest option; the store is the source of truth for a virtual domain,
    /// so only that kind reads from it.
    async fn move_source_text(
        &self,
        src_source: &ContentSource,
        src: &EngramDescriptor,
        domain: &str,
    ) -> Result<String> {
        match src_source {
            ContentSource::File { root } => {
                let abs = join_rel(root, &src.path);
                std::fs::read_to_string(&abs).map_err(|e| {
                    EngineError::NotFound(format!(
                        "the source file for '{}' at {} is unreadable ({e}); resync '{domain}' and retry the move",
                        src.permalink,
                        abs.display(),
                    ))
                })
            }
            ContentSource::Virtual => self.load_content(src_source, src).await,
        }
    }
}

/// What [`Engine::move_draft_locked`] moves, and for whom.
struct DraftMove<'a> {
    who: &'a str,
    src: &'a EngramDescriptor,
    src_source: &'a ContentSource,
    dest_rel: &'a str,
    cross: bool,
    asked: Option<&'a str>,
    mover: &'a str,
}
