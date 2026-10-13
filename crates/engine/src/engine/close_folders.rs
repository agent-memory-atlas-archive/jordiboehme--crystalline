use super::*;
use crystalline_core::folders::{
    CloseFolder, FOLDER_GUIDANCE, close_folders, created_folder, folder_counts, sibling_folders,
};

/// The close-folder probe's own budget for its queries. **The clock starts
/// once the probe holds the store lock**: a probe queued behind the
/// neighbours advisory, a sync or any other holder waits its turn rather than
/// spending this budget on the queue, and then has all of it for its own
/// queries. Past it the receipt goes out without the hint. Like the
/// advisory's, the timeout cuts only where the store yields.
///
/// The probe runs beside the advisory rather than after it, so its worst case
/// is [`LOCK_CEILING`] waiting for the store plus this budget, the two run one
/// after the other, and the write waits for the slower of the probe and the
/// advisory.
const CLOSE_FOLDER_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

/// How long the probe waits for the store lock at most, the neighbours
/// advisory's own ceiling ([`crate::similar::SIMILAR_TIMEOUT`]). A store held
/// longer than that leaves the hint out.
const LOCK_CEILING: std::time::Duration = crate::similar::SIMILAR_TIMEOUT;

/// What the close-folder probe needs from a write receipt, taken off it before
/// the receipt moves on to the neighbours advisory so the two probes can run at
/// the same time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderProbe {
    domain: String,
    path: String,
}

impl Engine {
    /// The probe for a `write_engram` receipt, or `None` when there is nothing
    /// to ask: an overwrite (its receipt says `written`, and the folder already
    /// held the engram it replaced), a root-level engram, or a receipt that
    /// names no `domain` and `path`.
    pub fn close_folder_probe(receipt: &Value) -> Option<FolderProbe> {
        if receipt.get("action").and_then(Value::as_str) != Some("created") {
            return None;
        }
        let domain = receipt.get("domain").and_then(Value::as_str)?;
        let path = receipt.get("path").and_then(Value::as_str)?;
        path.contains('/').then(|| FolderProbe {
            domain: domain.to_string(),
            path: path.to_string(),
        })
    }

    /// The sibling folders with a close name to the folder a write started,
    /// in the caller's own view of the domain (base rows, and in review mode
    /// their own drafts over them, never another account's), or nothing.
    ///
    /// A hint only, so it can never fail a write: a store error, a store
    /// still busy after two seconds, or the probe's 500 ms budget (counted
    /// from the moment it holds the store lock) is a debug line and an empty
    /// answer.
    ///
    /// Cheap in the common case. "Did anything else already stand in this
    /// folder" is one `LIMIT 1` query on the folder's prefix, base rows first,
    /// and the caller's draft paths only when the base folder is empty; no
    /// draft body is read. Only a write that really started a folder lists the
    /// domain's paths to count the siblings.
    pub async fn close_folders_for(
        &self,
        probe: Option<&FolderProbe>,
        scope: &crate::scope::Scope,
    ) -> Vec<CloseFolder> {
        let Some(probe) = probe else {
            return Vec::new();
        };
        // The write already screened the domain, so this pass screens nothing
        // further: the caller sees what they just wrote into.
        let actor = match DomainView::for_read(self, &probe.domain, &HashSet::new(), scope) {
            Ok(view) => view.actor().map(str::to_string),
            Err(e) => {
                tracing::debug!("close-folder probe skipped: {e}");
                return Vec::new();
            }
        };
        // Taken outside the budget, and held for the probe's few queries so
        // they are not queued behind another holder one by one. The wait has
        // its own ceiling, the neighbours advisory's: past it the hint is
        // left out rather than holding the write's answer.
        let Ok(store) = tokio::time::timeout(LOCK_CEILING, self.store.lock()).await else {
            tracing::debug!(
                "close-folder probe skipped: the store stayed busy past {LOCK_CEILING:?}"
            );
            return Vec::new();
        };
        let probed = close_folders_in(&*store, probe, actor.as_deref());
        match tokio::time::timeout(CLOSE_FOLDER_TIMEOUT, probed).await {
            Ok(Ok(found)) => found,
            Ok(Err(e)) => {
                tracing::debug!("close-folder probe skipped: {e}");
                Vec::new()
            }
            Err(_) => {
                tracing::debug!("close-folder probe cut at {CLOSE_FOLDER_TIMEOUT:?}");
                Vec::new()
            }
        }
    }

    /// Put what [`Engine::close_folders_for`] found on the receipt:
    /// `close_folders` and `folder_guidance`, or nothing for an empty list, so
    /// a quiet receipt is byte-identical to one without the probe.
    pub fn attach_close_folders(receipt: &mut Value, found: &[CloseFolder]) {
        if found.is_empty() || !receipt.is_object() {
            return;
        }
        receipt["close_folders"] = json!(found);
        receipt["folder_guidance"] = json!(FOLDER_GUIDANCE);
    }
}

/// The probe itself, on a store the caller already holds: the caller's own
/// view of the domain (base rows, and with an `actor` their drafts over them).
async fn close_folders_in(
    store: &dyn Store,
    probe: &FolderProbe,
    actor: Option<&str>,
) -> Result<Vec<CloseFolder>> {
    let FolderProbe { domain, path } = probe;
    let Some(domain_id) = store.domain_id(domain).await? else {
        return Ok(Vec::new());
    };
    let (folder, _) = path.rsplit_once('/').unwrap_or_default();
    let prefix = format!("{folder}/");

    // Base rows first: one `LIMIT 1` probe, exact on the folder name as
    // written, which skips the reserved `index.md` and `log.md` in SQL just as
    // the draft check below skips them here.
    if store.folder_holds_other(domain_id, &prefix, path).await? {
        return Ok(Vec::new());
    }
    let drafts = match actor {
        Some(actor) => store.overlay_paths(domain_id, actor).await?,
        None => Vec::new(),
    };
    if drafts.iter().any(|(p, tombstone)| {
        !tombstone && p != path && p.starts_with(&prefix) && !crystalline_core::is_reserved_path(p)
    }) {
        return Ok(Vec::new());
    }

    // A folder this write started: the caller's view of every path, the base
    // rows with their own drafts laid over them.
    let base = store.list_engrams(domain, None, None).await?;
    let removed: HashSet<&str> = drafts
        .iter()
        .filter(|(_, tombstone)| *tombstone)
        .map(|(p, _)| p.as_str())
        .collect();
    let mut paths: Vec<&str> = base
        .iter()
        .map(|d| d.path.as_str())
        .filter(|p| !removed.contains(p))
        .chain(
            drafts
                .iter()
                .filter(|(_, tombstone)| !tombstone)
                .map(|(p, _)| p.as_str()),
        )
        .chain([path.as_str()])
        .collect();
    paths.sort_unstable();
    paths.dedup();
    let counts = folder_counts(paths);
    let Some(created) = created_folder(path, &counts) else {
        return Ok(Vec::new());
    };
    Ok(close_folders(&created, &sibling_folders(&created, &counts)))
}
