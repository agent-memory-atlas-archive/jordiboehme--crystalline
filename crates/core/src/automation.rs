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

/// The reflect loop's shipped prompt, with `{domain}` and `{max_items}` to
/// fill in.
const REFLECT_PROMPT: &str = include_str!("automation/reflect-prompt.md");

/// The evolve loop's shipped prompt, with `{domain}` and `{max_items}` to
/// fill in.
const EVOLVE_PROMPT: &str = include_str!("automation/evolve-prompt.md");

/// The shipped prompt a headless run of `lp` starts its agent with, for
/// `domain` and at most `max_items` items. It ends with the block
/// [`parse_run_summary`] reads.
pub fn headless_prompt(lp: Loop, domain: &str, max_items: u32) -> String {
    let template = match lp {
        Loop::Reflect => REFLECT_PROMPT,
        Loop::Evolve => EVOLVE_PROMPT,
    };
    template
        .replace("{max_items}", &max_items.to_string())
        .replace("{domain}", domain)
}

/// The fixed block a headless run's agent ends with, read into numbers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunSummary {
    /// Items the run settled.
    pub done: u64,
    /// Items it left for a person.
    pub left: u64,
    /// Errors it met.
    pub errors: u64,
    /// The free text under the three counts.
    pub text: String,
}

/// The summary block at the end of `last_message`, or `None` without one.
/// The block is the last `Done: <n>`, `Left for a person: <n>` and
/// `Errors: <n>` lines in that order (blank lines between them, spaces
/// around them and a code fence around the block are fine); the lines under
/// it are its text.
pub fn parse_run_summary(last_message: &str) -> Option<RunSummary> {
    let lines: Vec<&str> = last_message.lines().map(str::trim).collect();
    (0..lines.len()).rev().find_map(|at| {
        let done = count(lines[at], "Done")?;
        let (left_at, left) = next_count(&lines, at + 1, "Left for a person")?;
        let (errors_at, errors) = next_count(&lines, left_at + 1, "Errors")?;
        let text: Vec<&str> = lines[errors_at + 1..]
            .iter()
            .copied()
            .filter(|line| !line.starts_with("```"))
            .collect();
        Some(RunSummary {
            done,
            left,
            errors,
            text: text.join("\n").trim().to_string(),
        })
    })
}

/// The number on a `<key>: <n>` line, or `None` for any other line.
fn count(line: &str, key: &str) -> Option<u64> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case(key) {
        return None;
    }
    value.trim().parse().ok()
}

/// The first line from `from` on that is not blank, when it is a `<key>: <n>`
/// line: its index and its number.
fn next_count(lines: &[&str], from: usize, key: &str) -> Option<(usize, u64)> {
    let at = (from..lines.len()).find(|&i| !lines[i].is_empty())?;
    Some((at, count(lines[at], key)?))
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

    const BLOCK: &str = "Done: <n>\nLeft for a person: <n>\nErrors: <n>\n<free text>";

    fn both() -> [(Loop, String); 2] {
        [
            (Loop::Reflect, headless_prompt(Loop::Reflect, "work", 7)),
            (Loop::Evolve, headless_prompt(Loop::Evolve, "work", 7)),
        ]
    }

    #[test]
    fn a_prompt_fills_in_the_domain_and_the_cap() {
        for (lp, prompt) in both() {
            assert!(!prompt.contains("{domain}"), "{lp} keeps {{domain}}");
            assert!(!prompt.contains("{max_items}"), "{lp} keeps {{max_items}}");
            assert!(prompt.contains("`work`"), "{lp} lacks the domain");
            assert!(prompt.contains("7 items"), "{lp} lacks the cap");
        }
    }

    #[test]
    fn a_prompt_loads_the_skills_before_any_other_tool() {
        for (lp, prompt) in both() {
            let skills = prompt.find("`skills`").unwrap_or(usize::MAX);
            for tool in [
                "`reflect`",
                "`evolve_engrams`",
                "`read_reflection`",
                "`write_reflection`",
                "`edit_engram`",
                "`discuss`",
            ] {
                if let Some(at) = prompt.find(tool) {
                    assert!(skills < at, "{lp} names {tool} before `skills`");
                }
            }
            assert!(skills < usize::MAX, "{lp} never names `skills`");
        }
    }

    #[test]
    fn a_prompt_never_waits_for_a_yes_and_asks_in_threads() {
        for (lp, prompt) in both() {
            assert!(prompt.contains("Nobody is there to answer"), "{lp}");
            assert!(prompt.contains("Never wait for a yes"), "{lp}");
            assert!(prompt.contains("Reflection thread"), "{lp}");
            assert!(prompt.contains("`discuss`"), "{lp}");
            assert!(prompt.contains("never in this session"), "{lp}");
        }
    }

    #[test]
    fn a_prompt_forbids_the_tools_that_need_a_yes() {
        for (lp, prompt) in both() {
            let rule = prompt
                .lines()
                .find(|line| line.trim_start_matches("- ").starts_with("Do not use"))
                .unwrap_or_else(|| panic!("{lp} has no Do not use line"));
            for needle in [
                "`delete_engram`",
                "`move_engram`",
                "`remove_domain`",
                "`write_reflection` action `delete_asset`",
            ] {
                assert!(rule.contains(needle), "{lp} does not forbid {needle}");
            }
        }
    }

    #[test]
    fn a_prompt_keeps_every_change_in_the_run() {
        for (lp, prompt) in both() {
            assert!(prompt.contains("through the crystalline MCP tools"), "{lp}");
            assert!(prompt.contains("pull request"), "{lp}");
            assert!(prompt.contains("Do not share"), "{lp}");
            assert!(prompt.contains("`[crystalline]`"), "{lp}");
        }
    }

    #[test]
    fn a_prompt_stops_at_the_cap_and_leaves_a_rename() {
        for (lp, prompt) in both() {
            assert!(prompt.contains("Stop after 7 items"), "{lp}");
            assert!(prompt.contains("rename"), "{lp}");
            assert!(prompt.contains("Leave it for a person"), "{lp}");
        }
    }

    #[test]
    fn a_prompt_ends_with_the_summary_block() {
        for (lp, prompt) in both() {
            assert!(prompt.trim_end().ends_with(BLOCK), "{lp} ends otherwise");
            assert!(
                !prompt.contains('\u{2014}') && !prompt.contains('\u{2013}'),
                "{lp} holds a long dash"
            );
        }
    }

    #[test]
    fn the_reflect_prompt_reads_the_pages_and_names_sources() {
        let prompt = headless_prompt(Loop::Reflect, "work", 7);
        for needle in [
            "`## Pages`",
            "`sources`",
            "settle `PACT.md`",
            "Your own writes never come back as feedback",
            "leave it open",
        ] {
            assert!(prompt.contains(needle), "reflect prompt lacks {needle}");
        }
        assert!(
            prompt
                .lines()
                .any(|line| line.contains("read the pact's `## Pages`")
                    && line.contains("new engrams")),
            "reflect prompt does not read ## Pages to place new engrams"
        );
    }

    #[test]
    fn the_evolve_prompt_asks_for_mechanical_findings_only() {
        let prompt = headless_prompt(Loop::Evolve, "work", 7);
        for needle in [
            "class: \"mechanical\"",
            "`judgment`",
            "`evolve_ack`",
            "domains: [\"work\"]",
        ] {
            assert!(prompt.contains(needle), "evolve prompt lacks {needle}");
        }
    }

    #[test]
    fn a_summary_block_is_read_from_the_end_of_the_message() {
        let message = "I answered two threads.\n\nDone: 3\nLeft for a person: 1\nErrors: 0\nThe thread on Setup needs a person.\nNo rename.";
        assert_eq!(
            parse_run_summary(message),
            Some(RunSummary {
                done: 3,
                left: 1,
                errors: 0,
                text: "The thread on Setup needs a person.\nNo rename.".to_string(),
            })
        );
    }

    #[test]
    fn a_summary_block_takes_extra_whitespace_and_a_fence() {
        let message = "Work done.\r\n```\r\n  Done:3  \r\n\r\nLeft for a person:   2\r\n\r\n   Errors: 1\r\n\r\n  One write failed.  \r\n```\r\n";
        assert_eq!(
            parse_run_summary(message),
            Some(RunSummary {
                done: 3,
                left: 2,
                errors: 1,
                text: "One write failed.".to_string(),
            })
        );
    }

    #[test]
    fn the_last_summary_block_wins() {
        let message = "Done: 1\nLeft for a person: 1\nErrors: 1\nan example\n\nDone: 4\nLeft for a person: 0\nErrors: 0\n";
        let summary = parse_run_summary(message).unwrap();
        assert_eq!((summary.done, summary.left, summary.errors), (4, 0, 0));
        assert_eq!(summary.text, "");
    }

    #[test]
    fn a_message_without_the_block_has_no_summary() {
        for message in [
            "",
            "All done, nothing left.",
            "Done: 3\nErrors: 0\n",
            "Done: three\nLeft for a person: 0\nErrors: 0\n",
            "Done: 3\nLeft for a person: 0\n",
            "Left for a person: 0\nDone: 3\nErrors: 0\n",
        ] {
            assert_eq!(parse_run_summary(message), None, "{message:?}");
        }
    }
}
