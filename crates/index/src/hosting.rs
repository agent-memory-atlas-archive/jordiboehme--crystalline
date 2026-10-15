//! The host lock of a file domain on a shared database, and the host move a
//! claim marks when it takes a domain from another instance (Task 50).
//!
//! A file domain's files on disk are its one source of truth. On a shared
//! Postgres database each instance keeps its own disk copy of a domain, so
//! an instance that takes a domain over can meet a disk that lacks files the
//! previous host wrote. The mark set here makes every complete walk keep the
//! rows it does not see until that is resolved (see [`crate::apply_scan`]).

use crate::error::Result;
use crate::store::{DomainId, HostClaim, HostMove, OnlyElsewhere, Store};

/// The default host-lock stale threshold, seconds (three missed heartbeats
/// of 30 s). A lock whose last heartbeat is older is takeable by another
/// instance.
const DEFAULT_STALE_SECS: i64 = 90;

/// The host-lock stale threshold in seconds, from `CRYSTALLINE_STALE_SECS`
/// (a short one makes multi-instance verification fast), else 90. An unset,
/// empty, unparsable or non-positive value is the default. The daemon and a
/// sync without a daemon both read it here, so they agree on when a lock is
/// stale.
pub fn stale_secs() -> i64 {
    std::env::var("CRYSTALLINE_STALE_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_STALE_SECS)
}

/// The `(now, stale_before)` pair a claim compares heartbeats with, both
/// RFC 3339 in the one spelling every heartbeat is written in, so the
/// comparison stays a lexical one.
pub fn claim_window(stale_secs: i64) -> (String, String) {
    let now = chrono::Utc::now().fixed_offset();
    let stale_before = now - chrono::Duration::seconds(stale_secs);
    (now.to_rfc3339(), stale_before.to_rfc3339())
}

/// The refusal of `--accept-disk` without a named domain: it drops rows, so
/// it is asked of one domain at a time.
pub const ACCEPT_DISK_NEEDS_DOMAIN: &str =
    "--accept-disk drops the rows of one domain; name it with --domain <name>";

/// Claim `domain`'s host lock for `instance_id`, and on a shared database
/// mark a host move when the claim acquires a domain whose previous holder
/// was not this instance: another instance's id, or no holder anyone
/// recorded. The previous holder is the lock row when there is one, else the
/// instance the domain row names as its last host (a release deletes the
/// lock row, the domain row keeps that name), so a restart of the same host
/// marks nothing, clean or not.
///
/// The previous holder is read, the lock claimed and the move marked in one
/// transaction, so a failed mark write or a crash between the steps never
/// leaves the lock naming this instance without the mark: the next claim
/// would read "this instance", mark nothing, and its walk would drop the
/// rows only the previous host has. Every other argument is
/// [`Store::claim_domain_host`]'s. Off a shared database this is that claim
/// and nothing more, since one instance owns the database.
pub async fn claim_host_marking_moves(
    store: &dyn Store,
    domain: DomainId,
    instance_id: &str,
    label: &str,
    now: &str,
    stale_before: &str,
    take_over: bool,
) -> Result<HostClaim> {
    if !store.shares_database() {
        return store
            .claim_domain_host(domain, instance_id, label, now, stale_before, take_over)
            .await;
    }
    store.begin().await?;
    let claimed = claim_and_mark(
        store,
        domain,
        instance_id,
        label,
        now,
        stale_before,
        take_over,
    )
    .await;
    match claimed {
        Ok(claim) => {
            store.commit().await?;
            Ok(claim)
        }
        Err(e) => {
            let _ = store.rollback().await;
            Err(e)
        }
    }
}

/// The body of [`claim_host_marking_moves`] on a shared database, inside
/// its transaction.
async fn claim_and_mark(
    store: &dyn Store,
    domain: DomainId,
    instance_id: &str,
    label: &str,
    now: &str,
    stale_before: &str,
    take_over: bool,
) -> Result<HostClaim> {
    let holder = store.domain_host(domain).await?;
    let last = store.last_domain_host(domain).await?;
    let previous = holder.map(|h| (h.instance_id, h.label)).or(last.clone());
    let claim = store
        .claim_domain_host(domain, instance_id, label, now, stale_before, take_over)
        .await?;
    if claim == HostClaim::Acquired {
        if previous.as_ref().map(|(id, _)| id.as_str()) != Some(instance_id) {
            let mark = HostMove {
                at: now.to_string(),
                claimant: Some(instance_id.to_string()),
                walked: false,
                only_elsewhere: OnlyElsewhere {
                    previous_host: previous.map(|(_, label)| label),
                    ..OnlyElsewhere::default()
                },
            };
            #[cfg(test)]
            seam::fail_mark_of(instance_id)?;
            store.set_host_move(domain, Some(&mark)).await?;
        }
        if last.as_ref().map(|(id, _)| id.as_str()) != Some(instance_id) {
            store
                .set_last_domain_host(domain, instance_id, label)
                .await?;
        }
    }
    Ok(claim)
}

/// A failure injected into the mark write, for the test that proves a
/// failed mark leaves no claim behind. Keyed by instance id, so tests that
/// run side by side never meet it.
#[cfg(test)]
mod seam {
    use std::collections::HashSet;
    use std::sync::Mutex;

    static FAILING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

    pub(super) fn fail_marks_of(instance_id: &str) {
        FAILING
            .lock()
            .unwrap()
            .get_or_insert_with(HashSet::new)
            .insert(instance_id.to_string());
    }

    pub(super) fn fail_mark_of(instance_id: &str) -> crate::error::Result<()> {
        if FAILING
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|ids| ids.contains(instance_id))
        {
            return Err(crate::error::IndexError::Db(
                "injected: the mark write failed".to_string(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_line_names_the_counts_the_host_and_both_ways_out() {
        let mut counts = OnlyElsewhere {
            previous_host: Some("alpha".to_string()),
            engrams: 1,
            attachments: 0,
            pages: 2,
            files: 1,
        };
        assert_eq!(
            counts.line("eng"),
            "1 engram and 3 Reflection files exist only on alpha; copy the domain folder over or restore it, then sync, or drop them with: crystalline sync --domain eng --accept-disk"
        );
        counts.previous_host = None;
        counts.attachments = 2;
        counts.pages = 0;
        counts.files = 1;
        assert_eq!(
            counts.line("eng"),
            "1 engram, 2 attachments and 1 Reflection file exist only on another instance; copy the domain folder over or restore it, then sync, or drop them with: crystalline sync --domain eng --accept-disk"
        );
        assert_eq!(counts.total(), 4);
        assert_eq!(
            counts.line_elsewhere("beta"),
            "1 engram, 2 attachments and 1 Reflection file exist only on another instance; beta hosts this domain, so resolve it there"
        );
    }

    /// A Postgres store on a schema of its own, or `None` with no URL.
    #[cfg(feature = "postgres")]
    async fn shared_store() -> Option<crate::PostgresStore> {
        let url = std::env::var("CRYSTALLINE_TEST_POSTGRES_URL").ok()?;
        if url.is_empty() {
            return None;
        }
        let schema = format!(
            "hosting_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        Some(
            crate::PostgresStore::open_in_schema(&url, &schema)
                .await
                .unwrap(),
        )
    }

    /// A claim whose mark write fails leaves no claim behind: the lock still
    /// names the previous holder, and the next claim marks the move.
    #[cfg(feature = "postgres")]
    #[tokio::test]
    async fn a_failed_mark_leaves_the_lock_where_it_was() {
        let Some(store) = shared_store().await else {
            return;
        };
        let domain = store
            .upsert_domain("eng", Some("/tmp/eng"), crate::DomainKind::File)
            .await
            .unwrap();
        let (now, stale_before) = claim_window(90);
        let claim = |id: &'static str| {
            let (store, now, stale_before) = (&store, now.clone(), stale_before.clone());
            async move {
                claim_host_marking_moves(store, domain, id, id, &now, &stale_before, true).await
            }
        };
        assert_eq!(claim("alpha-mark").await.unwrap(), HostClaim::Acquired);
        store.set_host_move(domain, None).await.unwrap();

        seam::fail_marks_of("beta-mark-fails");
        assert!(claim("beta-mark-fails").await.is_err());
        assert_eq!(
            store
                .domain_host(domain)
                .await
                .unwrap()
                .unwrap()
                .instance_id,
            "alpha-mark",
            "the lock was not taken"
        );
        assert!(store.host_move(domain).await.unwrap().is_none());
        assert_eq!(
            store.last_domain_host(domain).await.unwrap().unwrap().0,
            "alpha-mark"
        );

        assert_eq!(claim("beta-mark").await.unwrap(), HostClaim::Acquired);
        let mark = store.host_move(domain).await.unwrap().expect("marked");
        assert_eq!(mark.claimant.as_deref(), Some("beta-mark"));
        assert_eq!(
            mark.only_elsewhere.previous_host.as_deref(),
            Some("alpha-mark")
        );
        store.drop_schema().await.unwrap();
    }

    /// Only the instance that marked a move ends it: a complete walk that
    /// sees every row but names no walker, or names another, keeps the mark;
    /// the claimant's walk ends it.
    #[cfg(feature = "postgres")]
    #[tokio::test]
    async fn only_the_claimant_ends_a_move() {
        let Some(store) = shared_store().await else {
            return;
        };
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("eng");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("a.md"),
            "---\ntype: engram\ntitle: A\npermalink: a\nstatus: stable\n---\n\n# A\n",
        )
        .unwrap();
        let domain = store
            .upsert_domain(
                "eng",
                Some(&root.to_string_lossy()),
                crate::DomainKind::File,
            )
            .await
            .unwrap();
        let (now, stale_before) = claim_window(90);
        claim_host_marking_moves(&store, domain, "gamma", "gamma", &now, &stale_before, true)
            .await
            .unwrap();
        assert!(store.host_move(domain).await.unwrap().is_some(), "marked");
        let walk = |walker: Option<&'static str>| {
            let (store, root) = (&store, root.clone());
            async move {
                let stamps = store.file_stamps(domain).await.unwrap();
                let mut scan =
                    crate::scan_domain("eng", &root, stamps, &crate::ChunkParams::default(), false)
                        .await
                        .unwrap();
                if let Some(walker) = walker {
                    scan.walked_by(walker);
                }
                crate::apply_scan(store, domain, scan).await
            }
        };
        walk(None).await.unwrap();
        assert!(
            store.host_move(domain).await.unwrap().is_some(),
            "a walk that names no walker leaves the move standing"
        );
        let refused = walk(Some("delta")).await.unwrap_err();
        assert!(
            matches!(refused, crate::IndexError::NotHost(_)),
            "{refused}"
        );
        let report = walk(Some("gamma")).await.unwrap();
        assert!(report.host_move_resolved);
        assert!(store.host_move(domain).await.unwrap().is_none());
        store.drop_schema().await.unwrap();
    }
}
