use super::*;
use crystalline_core::folders::{
    FOLDER_GUIDANCE, close_folders, created_folder, folder_counts, sibling_folders,
};

/// The close-folder probe is one listing of a domain, so it gets the same
/// budget the neighbours advisory has: past it the receipt goes out without
/// the hint and the write is unaffected.
const CLOSE_FOLDER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

impl Engine {
    /// Put the close-folder hint on a `write_engram` receipt, or leave it
    /// alone.
    ///
    /// When the write was the first engram in a folder, in the caller's own
    /// view of the domain (base rows, and in review mode their drafts over
    /// them), the folders beside the first level it created are compared with
    /// it by [`crystalline_core::folders::close_folders`]. A match adds
    /// `close_folders` (each folder with its engram count) and
    /// `folder_guidance`; no match adds nothing, so a quiet receipt is
    /// byte-identical to one without the probe.
    ///
    /// A hint only. It runs after the write has landed and can never fail it:
    /// a store error or the timeout is a debug line and an unchanged receipt.
    /// An overwrite never carries it (its receipt says `written`, and the
    /// folder already held the engram it replaced), and neither does a receipt
    /// that names no `domain` and `path`.
    ///
    /// Called by the surface after the write returns rather than from inside
    /// the write, like [`Engine::attach_similar`]: the listing takes the store
    /// lock, which is not reentrant.
    pub async fn attach_close_folders(&self, receipt: &mut Value, scope: &crate::scope::Scope) {
        if receipt.get("action").and_then(Value::as_str) != Some("created") {
            return;
        }
        let (Some(domain), Some(path)) = (
            receipt
                .get("domain")
                .and_then(Value::as_str)
                .map(str::to_string),
            receipt
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string),
        ) else {
            return;
        };
        if !path.contains('/') {
            return;
        }
        let work = async {
            // The write already screened the domain, so this pass screens
            // nothing further: the caller sees what they just wrote into.
            let view = DomainView::for_read(self, &domain, &HashSet::new(), scope)?;
            // The common case first and cheaply: a write into a folder that
            // already held another engram started nothing. The store folds
            // case on the prefix and `list_over` appends every draft the
            // caller holds wherever it stands, so the rows are filtered here.
            let (folder, _) = path.rsplit_once('/').unwrap_or_default();
            let prefix = format!("{folder}/");
            let near = {
                let store = self.store.lock().await;
                store.list_engrams(&domain, Some(&prefix), None).await?
            };
            let occupied = view.list_over(near).await?.iter().any(|d| {
                d.path != path
                    && d.path.starts_with(&prefix)
                    && !crystalline_core::is_reserved_path(&d.path)
            });
            if occupied {
                return Ok(Vec::new());
            }
            let base = {
                let store = self.store.lock().await;
                store.list_engrams(&domain, None, None).await?
            };
            let descs = view.list_over(base).await?;
            let mut paths: Vec<&str> = descs.iter().map(|d| d.path.as_str()).collect();
            // The engram just written is counted once whether or not the
            // listing already carries its row.
            if !paths.contains(&path.as_str()) {
                paths.push(&path);
            }
            paths.sort_unstable();
            paths.dedup();
            let counts = folder_counts(paths);
            let Some(created) = created_folder(&path, &counts) else {
                return Ok::<_, EngineError>(Vec::new());
            };
            Ok(close_folders(&created, &sibling_folders(&created, &counts)))
        };
        match tokio::time::timeout(CLOSE_FOLDER_TIMEOUT, work).await {
            Ok(Ok(found)) if !found.is_empty() => {
                receipt["close_folders"] = json!(found);
                receipt["folder_guidance"] = json!(FOLDER_GUIDANCE);
            }
            Ok(Ok(_)) => {}
            Ok(Err(e)) => tracing::debug!("close-folder probe skipped: {e}"),
            Err(_) => tracing::debug!("close-folder probe cut at {CLOSE_FOLDER_TIMEOUT:?}"),
        }
    }
}
