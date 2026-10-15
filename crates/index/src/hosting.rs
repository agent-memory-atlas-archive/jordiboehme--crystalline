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
/// The previous holder is read on the caller's store, right before the
/// claim: the caller holds its store lock across both, so no claim of this
/// instance runs in between. Every other argument is
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
                walked: false,
                only_elsewhere: OnlyElsewhere {
                    previous_host: previous.map(|(_, label)| label),
                    ..OnlyElsewhere::default()
                },
            };
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
    }
}
