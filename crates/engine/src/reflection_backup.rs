//! When a home instance's Reflection is due for its backup commit: at once
//! for a settled change, after 60 idle seconds for a room's edits. Pure
//! scheduling; the commit itself is `crystalline_remote::reflections_backup`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a room's edits must rest before they are one settled change.
pub const SETTLE_IDLE: Duration = Duration::from_secs(60);

/// How long a failed backup waits before the next attempt.
pub const RETRY_AFTER: Duration = Duration::from_secs(60);

/// Why a Reflection is marked for backup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupCause {
    /// A room saved, or the sync saw a change: settles after [`SETTLE_IDLE`].
    Edit,
    /// An agent write, a comment, a settle, a move, a delete, a room closed.
    Settled,
}

/// One domain's pending backup.
#[derive(Debug, Clone, Copy)]
pub struct BackupMark {
    /// When the domain was last marked.
    pub last_edit: Instant,
    /// Whether a settled change is among the marked ones.
    pub settled: bool,
    /// After a failed attempt, the earliest moment of the next one.
    pub retry_after: Option<Instant>,
}

/// Whether a mark is due at `now`.
pub fn due(mark: &BackupMark, now: Instant) -> bool {
    if mark.retry_after.is_some_and(|at| now < at) {
        return false;
    }
    mark.settled || now.saturating_duration_since(mark.last_edit) >= SETTLE_IDLE
}

/// Every domain's pending backup.
#[derive(Debug, Default)]
pub struct BackupMarks(Mutex<HashMap<String, BackupMark>>);

impl BackupMarks {
    /// Mark `domain` for backup.
    pub fn mark(&self, domain: &str, cause: BackupCause, now: Instant) {
        let mut marks = self.0.lock().expect("backup marks");
        let mark = marks.entry(domain.to_string()).or_insert(BackupMark {
            last_edit: now,
            settled: false,
            retry_after: None,
        });
        mark.last_edit = now;
        mark.settled |= cause == BackupCause::Settled;
    }

    /// The domains due at `now`, sorted.
    pub fn due_domains(&self, now: Instant) -> Vec<String> {
        let marks = self.0.lock().expect("backup marks");
        let mut out: Vec<String> = marks
            .iter()
            .filter(|(_, m)| due(m, now))
            .map(|(d, _)| d.clone())
            .collect();
        out.sort();
        out
    }

    /// Forget `domain`'s mark: it is not a home Reflection here.
    pub fn clear(&self, domain: &str) {
        self.0.lock().expect("backup marks").remove(domain);
    }

    /// The backup of `domain` that the tick started at `seen` landed (or had
    /// nothing to do): forget the mark, unless a change was marked after the
    /// tick read it - that one is not in the commit and stays marked.
    pub fn clear_if_unchanged(&self, domain: &str, seen: Instant) {
        let mut marks = self.0.lock().expect("backup marks");
        if marks.get(domain).is_some_and(|m| m.last_edit <= seen) {
            marks.remove(domain);
        }
    }

    /// The backup of `domain` failed at `now`: keep the mark, wait.
    pub fn failed(&self, domain: &str, now: Instant) {
        if let Some(mark) = self.0.lock().expect("backup marks").get_mut(domain) {
            mark.retry_after = Some(now + RETRY_AFTER);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_settled_mark_is_due_at_once_and_an_edit_after_sixty_idle_seconds() {
        let t0 = Instant::now();
        let edit = BackupMark {
            last_edit: t0,
            settled: false,
            retry_after: None,
        };
        assert!(!due(&edit, t0 + Duration::from_secs(59)));
        assert!(due(&edit, t0 + Duration::from_secs(60)));
        let settled = BackupMark {
            settled: true,
            ..edit
        };
        assert!(due(&settled, t0));
        let waiting = BackupMark {
            retry_after: Some(t0 + Duration::from_secs(60)),
            ..settled
        };
        assert!(
            !due(&waiting, t0 + Duration::from_secs(10)),
            "a failed attempt waits"
        );
        assert!(due(&waiting, t0 + Duration::from_secs(61)));
    }

    #[test]
    fn a_new_edit_restarts_the_idle_clock_and_a_settle_wins() {
        let marks = BackupMarks::default();
        let t0 = Instant::now();
        marks.mark("eng", BackupCause::Edit, t0);
        marks.mark("eng", BackupCause::Edit, t0 + Duration::from_secs(50));
        assert!(
            marks.due_domains(t0 + Duration::from_secs(70)).is_empty(),
            "idle only since 50s"
        );
        assert_eq!(
            marks.due_domains(t0 + Duration::from_secs(111)),
            vec!["eng".to_string()]
        );
        marks.mark("ops", BackupCause::Settled, t0);
        assert!(marks.due_domains(t0).contains(&"ops".to_string()));
        // A settle after an edit wins: the domain is due at once.
        let t1 = t0 + Duration::from_secs(200);
        marks.mark("eng", BackupCause::Edit, t1);
        assert!(
            !marks.due_domains(t1).contains(&"eng".to_string()),
            "an edit alone waits"
        );
        marks.mark("eng", BackupCause::Settled, t1);
        assert!(
            marks.due_domains(t1).contains(&"eng".to_string()),
            "the settle wins"
        );
    }
}
