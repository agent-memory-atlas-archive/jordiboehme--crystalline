//! The reflect and evolve loops run headless: the words and the numbers a
//! runner, the engine and every surface share. Plain data; the engine keeps
//! the lease and the run record, a runner outside Crystalline does the work.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// A lease that was not renewed for this many seconds is stale: its runner
/// is taken for crashed, the loop is due again and a new run may take it.
pub const LEASE_STALE_SECS: i64 = 300;

/// How often a runner renews its lease, in seconds.
pub const LEASE_RENEW_SECS: u64 = 60;

/// How many runs are kept per domain and loop.
pub const RUNS_KEPT: usize = 50;

/// The most bytes a run summary keeps; a longer one is cut at a char
/// boundary.
pub const SUMMARY_MAX_BYTES: usize = 2048;

/// One of the two loops a runner works.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Loop {
    /// Reflection threads, feedback and page updates.
    Reflect,
    /// Maintenance findings.
    Evolve,
}

impl Loop {
    /// The wire word: `reflect` or `evolve`.
    pub fn as_str(self) -> &'static str {
        match self {
            Loop::Reflect => "reflect",
            Loop::Evolve => "evolve",
        }
    }

    /// The word a title starts with: `Reflect` or `Evolve`.
    pub fn title_word(self) -> &'static str {
        match self {
            Loop::Reflect => "Reflect",
            Loop::Evolve => "Evolve",
        }
    }
}

impl fmt::Display for Loop {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Loop {
    type Err = String;

    fn from_str(s: &str) -> Result<Loop, String> {
        match s.trim() {
            "reflect" => Ok(Loop::Reflect),
            "evolve" => Ok(Loop::Evolve),
            other => Err(format!(
                "unknown loop '{other}'; valid loops: reflect, evolve"
            )),
        }
    }
}

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    /// It worked everything it could; what it did not settle is left for a
    /// person.
    Done,
    /// It stopped at its item cap; the rest stays due.
    StoppedAtCap,
    /// It failed; everything stays due.
    Failed,
    /// It found nothing due.
    NothingDue,
    /// Its runner stopped renewing the lease.
    Expired,
}

impl RunOutcome {
    /// The wire word, as serde writes it.
    pub fn as_str(self) -> &'static str {
        match self {
            RunOutcome::Done => "done",
            RunOutcome::StoppedAtCap => "stopped_at_cap",
            RunOutcome::Failed => "failed",
            RunOutcome::NothingDue => "nothing_due",
            RunOutcome::Expired => "expired",
        }
    }
}

/// What a runner reports when a run ends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunReport {
    /// When the run started, RFC 3339. Empty means when the lease was taken.
    pub started_at: String,
    /// How it ended.
    pub outcome: RunOutcome,
    /// Items done.
    pub done: u64,
    /// The run summary; kept up to [`SUMMARY_MAX_BYTES`].
    pub summary: String,
}

/// `text` cut to at most `max` bytes, at a char boundary.
pub fn cap_summary(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_loop_reads_and_writes_its_word() {
        for lp in [Loop::Reflect, Loop::Evolve] {
            assert_eq!(lp.as_str().parse::<Loop>().unwrap(), lp);
            assert_eq!(serde_json::to_value(lp).unwrap(), lp.as_str());
        }
        assert_eq!(
            "maintain".parse::<Loop>().unwrap_err(),
            "unknown loop 'maintain'; valid loops: reflect, evolve"
        );
    }

    #[test]
    fn an_outcome_writes_the_word_serde_writes() {
        for outcome in [
            RunOutcome::Done,
            RunOutcome::StoppedAtCap,
            RunOutcome::Failed,
            RunOutcome::NothingDue,
            RunOutcome::Expired,
        ] {
            assert_eq!(serde_json::to_value(outcome).unwrap(), outcome.as_str());
        }
    }

    #[test]
    fn a_summary_is_cut_at_a_char_boundary() {
        assert_eq!(cap_summary("short", 2048), "short");
        let long = "ä".repeat(1100);
        let cut = cap_summary(&long, SUMMARY_MAX_BYTES);
        assert_eq!(cut.len(), 2048);
        assert_eq!(cap_summary("aä", 2), "a");
    }
}
