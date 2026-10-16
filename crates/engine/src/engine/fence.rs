//! The host-lock fence of a Reflection write that is not a walk.
//!
//! On a shared database only the instance that holds a domain's host lock
//! writes its Reflection. Every such write passes the gate first
//! ([`Engine::confirm_reflection_host`]), then writes its files on this
//! disk, then its rows. A host that pauses (a sleeping laptop, a stopped
//! process) between the gate and the rows can lose the lock in between, and
//! its rows would then land in the shared database behind the new host's
//! back. So the rows commit in one transaction that first reads the lock
//! row the way a walk's apply does (`FOR SHARE` on Postgres) and goes on
//! only while this instance still holds it.
//!
//! A refused write keeps what the person or agent sent in the kept folder
//! (as a room keeps a text it could not save), puts every file it already
//! changed on this disk back to what it was, and answers the
//! `hosted_elsewhere` refusal naming the new host. A file that cannot be
//! put back stays as the write left it and is logged; nothing is ever
//! deleted that is the only copy of anything, since the sent text is kept
//! first.

use std::path::{Path, PathBuf};

use crystalline_core::reflection as r;
use crystalline_index::AssetTable;

use super::reflection::{REFUSED_HOSTED_START, hosted_refusal};
use super::*;

/// The files a Reflection write changed on this disk, each with what it
/// held before (`None`: it did not exist), recorded before the write so a
/// refused write can put them back.
#[derive(Default)]
pub(crate) struct DiskUndo {
    files: Vec<(PathBuf, Option<Vec<u8>>)>,
}

impl DiskUndo {
    /// Record what `abs` holds now, once per path: the first record is the
    /// state before the write.
    pub(crate) fn record(&mut self, abs: &Path) -> Result<()> {
        if self.files.iter().any(|(path, _)| path == abs) {
            return Ok(());
        }
        let before = match std::fs::read(abs) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(source) => {
                return Err(EngineError::Io {
                    path: abs.display().to_string(),
                    source,
                });
            }
        };
        self.files.push((abs.to_path_buf(), before));
        Ok(())
    }

    /// Put every recorded file back, the last change first. A file that
    /// cannot be put back is left as the write left it, and said loudly.
    pub(crate) fn put_back(self, domain: &str) {
        for (abs, before) in self.files.into_iter().rev() {
            let done = match &before {
                Some(bytes) => write_bytes(&abs, bytes),
                None => remove_if_there(&abs).map(|_| ()),
            };
            if let Err(e) = done {
                tracing::error!(
                    domain,
                    file = %abs.display(),
                    "a Reflection write this instance may no longer make could not put this file back, so it stays as the write left it: {e}"
                );
            }
        }
    }
}

/// What a refused write keeps in the kept folder: the text the person or
/// agent sent, under the page (or threads file) path inside `reflections/`.
pub(crate) struct KeepText<'a> {
    /// The path inside `reflections/`.
    pub path: &'a str,
    /// The text as sent.
    pub text: &'a str,
    /// Who sent it, for the log.
    pub actor: &'a str,
}

/// What a fenced write does when the fence refuses it.
pub(crate) struct OnRefusal<'a> {
    /// The domain, for the kept folder, the hosts map and the log.
    pub domain: &'a str,
    /// The files to put back.
    pub undo: DiskUndo,
    /// The text to keep, if the write carried one a person or agent sent.
    pub keep: Option<KeepText<'a>>,
}

impl<'a> OnRefusal<'a> {
    /// A refusal that puts `undo` back and keeps nothing.
    pub(crate) fn put_back(domain: &'a str, undo: DiskUndo) -> OnRefusal<'a> {
        OnRefusal {
            domain,
            undo,
            keep: None,
        }
    }
}

/// One row change of a fenced commit.
pub(crate) enum RowOp<'a> {
    /// A page's row and chunks, from its text as written at `abs`.
    Page {
        inner: &'a str,
        text: &'a str,
        abs: &'a Path,
    },
    /// A page's row goes.
    DeletePage(&'a str),
    /// A Reflection file's row, as written.
    PutAsset(&'a crystalline_index::AttachmentRow),
    /// A Reflection file's row goes.
    DeleteAsset(&'a str),
}

/// Whether `e` is a refusal of the host-lock fence (or of the gate, whose
/// sentence it shares).
pub(crate) fn is_fence_refusal(e: &EngineError) -> bool {
    matches!(e, EngineError::Refused(text) if text.starts_with(REFUSED_HOSTED_START))
}

/// The sentence of a fence refusal when no instance holds the lock now.
fn nobody_holds() -> EngineError {
    EngineError::Refused(format!("{REFUSED_HOSTED_START}no instance now; try again"))
}

impl Engine {
    /// Whether this instance may write `domain_id`'s Reflection rows now:
    /// `None` when it holds the domain's host lock (or the database is
    /// its own, or it has no instance id and so holds no locks at all),
    /// else the refusal naming the holder. Read inside the caller's
    /// transaction, so a take-over waits for the commit on Postgres.
    async fn reflection_row_fence(
        &self,
        store: &dyn Store,
        domain_id: DomainId,
    ) -> Result<Option<(EngineError, bool)>> {
        if self.instance_id.is_empty() || !store.shares_database() {
            return Ok(None);
        }
        let holder = store.domain_host_held(domain_id).await?;
        Ok(match holder {
            Some(h) if h.instance_id == self.instance_id => None,
            Some(h) => Some((hosted_refusal(&h.label), true)),
            None => Some((nobody_holds(), false)),
        })
    }

    /// Commit `ops` in one transaction behind the host-lock fence (see the
    /// module). With an empty `ops` it only checks the fence, for a write
    /// that has no rows (a thread entry). On a refusal it keeps the sent
    /// text, puts the files back and answers the refusal; any other failure
    /// is answered as it is, the files left as written (the next sync
    /// brings the rows up to date).
    pub(crate) async fn commit_reflection_rows(
        &self,
        domain_id: DomainId,
        ops: &[RowOp<'_>],
        on_refusal: OnRefusal<'_>,
    ) -> Result<()> {
        self.take_row_fence_hold().await;
        let store = self.store.lock().await;
        store.begin().await?;
        let written = async {
            if let Some(refused) = self.reflection_row_fence(&*store, domain_id).await? {
                return Ok(Some(refused));
            }
            for op in ops {
                match op {
                    RowOp::Page { inner, text, abs } => {
                        let row = crystalline_index::ReflectionRow {
                            path: inner.to_string(),
                            title: r::title_of(text, inner),
                            content: text.to_string(),
                            sha256: sha256_hex(text.as_bytes()),
                            size: text.len() as u64,
                            modified: asset_modified(abs),
                        };
                        crystalline_index::reflection::index_reflection_row(
                            &*store,
                            domain_id,
                            &row,
                            &self.chunk_params,
                        )
                        .await?;
                    }
                    RowOp::DeletePage(inner) => {
                        store.delete_reflection(domain_id, inner).await?;
                    }
                    RowOp::PutAsset(row) => {
                        store
                            .upsert_asset(AssetTable::Reflection, domain_id, row)
                            .await?;
                    }
                    RowOp::DeleteAsset(path) => {
                        store
                            .delete_asset(AssetTable::Reflection, domain_id, path)
                            .await?;
                    }
                }
            }
            #[cfg(any(test, feature = "testing"))]
            if self
                .reflection_index_fault
                .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                return Err(EngineError::Invalid(
                    "injected failure after the reflection row and its chunks".into(),
                ));
            }
            Ok::<_, EngineError>(None)
        }
        .await;
        let committed = match written {
            Ok(None) => store.commit().await.map_err(EngineError::from),
            Ok(Some((refusal, foreign))) => {
                let _ = store.rollback().await;
                drop(store);
                return Err(self.refuse_fenced(refusal, foreign, on_refusal));
            }
            Err(e) => {
                let _ = store.rollback().await;
                Err(e)
            }
        };
        drop(store);
        // R56: the new chunks are embedded soon after the write, as an
        // engram's are, rather than at the next tick.
        if committed.is_ok() && ops.iter().any(|op| matches!(op, RowOp::Page { .. })) {
            self.nudge_embed();
        }
        committed
    }

    /// The refusal of a fenced write: keep the sent text, put the files
    /// back, stop hosting a domain another instance took, and answer.
    fn refuse_fenced(
        &self,
        refusal: EngineError,
        foreign: bool,
        on_refusal: OnRefusal<'_>,
    ) -> EngineError {
        let OnRefusal { domain, undo, keep } = on_refusal;
        if let Some(keep) = keep.filter(|k| !k.text.trim().is_empty()) {
            let kept = self
                .kept_dir()
                .ok_or_else(|| "this process knows no state folder".to_string());
            match kept.and_then(|root| {
                crystalline_core::kept::write(
                    &root,
                    domain,
                    None,
                    crystalline_core::kept::KeptKind::Reflection,
                    keep.path,
                    chrono::Utc::now(),
                    keep.text,
                )
                .map_err(|e| e.to_string())
            }) {
                Ok(file) => tracing::warn!(
                    domain,
                    path = keep.path,
                    actor = keep.actor,
                    kept = %file.display(),
                    "a Reflection write was refused because this instance no longer holds the domain's host lock ({refusal}); the text sent is kept here; crystalline kept list shows it"
                ),
                Err(e) => tracing::error!(
                    domain,
                    path = keep.path,
                    actor = keep.actor,
                    "a Reflection write was refused because this instance no longer holds the domain's host lock ({refusal}), and keeping the text sent failed: {e}"
                ),
            }
        } else {
            tracing::warn!(
                domain,
                "a Reflection write was refused because this instance no longer holds the domain's host lock: {refusal}"
            );
        }
        undo.put_back(domain);
        if foreign && self.hosted.write().unwrap().remove(domain).is_some() {
            self.announce_host_moved(domain);
        }
        refusal
    }
}
