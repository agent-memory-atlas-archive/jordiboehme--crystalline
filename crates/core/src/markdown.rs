//! The rich Markdown dialect: status labels (`:status[Text]{colour}`) and
//! callouts (`> [!KIND]`), plus the lints that keep both honest.
//!
//! The palette and the kind list live here so the checks, the write receipts
//! and the docs read one source. Fences and inline code are skipped.

use serde::Serialize;

use crate::parse::{body_lines, mask_inline_code, parse_relation, split_category};
use crate::verify::Severity;

/// The colours a status label may name.
pub const STATUS_COLOURS: [&str; 6] = ["grey", "blue", "green", "yellow", "red", "purple"];

/// The callout kinds, matched case-insensitively.
pub const CALLOUT_KINDS: [&str; 6] = ["note", "tip", "important", "warning", "caution", "details"];

/// One finding of [`lint_markdown`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MarkdownFinding {
    /// `Q006`, `Q007` or `Q008`.
    pub code: &'static str,
    /// How serious the finding is.
    pub severity: Severity,
    /// What is wrong and what to do.
    pub message: String,
    /// 1-based line in the text given (offset by `first_line`).
    pub line: usize,
}

/// The dialect checks over a whole engram file: its body, numbered by the
/// line the file holds it on, which is the number verify reports. Q008 is on.
/// For callers that hold the file text and not a parsed engram (write
/// receipts, the validate dry run).
pub fn lint_engram_source(source: &str) -> Vec<MarkdownFinding> {
    let (_, _, body_start) = crate::parse::locate(source);
    let first_line = source[..body_start].bytes().filter(|b| *b == b'\n').count() + 1;
    lint_markdown(&source[body_start..], first_line, true)
}

/// What the dialect checks find in one Markdown text (an engram body or a
/// reflection page). `engram` switches Q008 on. Fences and inline code are
/// skipped.
pub fn lint_markdown(text: &str, first_line: usize, engram: bool) -> Vec<MarkdownFinding> {
    let mut out = Vec::new();
    let mut prev_quote = false;
    let mut in_callout = false;
    for bl in body_lines(text, first_line) {
        if bl.in_fence {
            prev_quote = false;
            in_callout = false;
            continue;
        }
        let masked = mask_inline_code(bl.text);
        status_findings(&masked, bl.line_no, &mut out);

        let quoted = quote_body(&masked);
        if let Some(rest) = quoted {
            if !prev_quote {
                in_callout = false;
                if let Some(word) = callout_marker(rest) {
                    in_callout = true;
                    if !CALLOUT_KINDS.contains(&word.to_ascii_lowercase().as_str()) {
                        out.push(MarkdownFinding {
                            code: "Q007",
                            severity: Severity::Warning,
                            message: format!(
                                "unknown callout kind `{word}`; it shows as a plain quote. Use note, tip, important, warning, caution or details"
                            ),
                            line: bl.line_no,
                        });
                    }
                }
            } else if engram && in_callout && is_structure(rest) {
                out.push(MarkdownFinding {
                    code: "Q008",
                    severity: Severity::Info,
                    message: "an observation or relation inside a callout is not indexed; move it out of the callout".into(),
                    line: bl.line_no,
                });
            }
        } else {
            in_callout = false;
        }
        prev_quote = quoted.is_some();
    }
    out
}

fn status_findings(masked: &str, line: usize, out: &mut Vec<MarkdownFinding>) {
    let mut rest = masked;
    while let Some(at) = rest.find(":status[") {
        let after = &rest[at + ":status[".len()..];
        let Some(close) = label_end(after) else {
            // Unclosed here; a later label on the line can still close.
            rest = after;
            continue;
        };
        let tail = &after[close + 1..];
        rest = tail;
        let Some(braced) = tail.strip_prefix('{') else {
            continue;
        };
        let Some(end) = braced.find('}') else {
            continue;
        };
        let colour = braced[..end].trim().to_lowercase();
        if !colour.is_empty() && !STATUS_COLOURS.contains(&colour.as_str()) {
            out.push(MarkdownFinding {
                code: "Q006",
                severity: Severity::Warning,
                message: format!(
                    "unknown status colour `{colour}`; use grey, blue, green, yellow, red or purple"
                ),
                line,
            });
        }
    }
}

/// The byte index of the `]` that closes a status label, the way the reader
/// reads it: brackets inside the label nest and `\]` is no close.
fn label_end(after: &str) -> Option<usize> {
    let mut depth = 0usize;
    let mut escaped = false;
    for (i, c) in after.char_indices() {
        match c {
            _ if escaped => escaped = false,
            '\\' => escaped = true,
            '[' => depth += 1,
            ']' if depth == 0 => return Some(i),
            ']' => depth -= 1,
            _ => {}
        }
    }
    None
}

/// The text after the leading `>` markers of a quote line, or None.
fn quote_body(line: &str) -> Option<&str> {
    let mut rest = line.trim_start();
    rest = rest.strip_prefix('>')?;
    loop {
        rest = rest.trim_start();
        match rest.strip_prefix('>') {
            Some(r) => rest = r,
            None => return Some(rest),
        }
    }
}

/// `[!WORD]` at the start of `rest`: the word as written.
fn callout_marker(rest: &str) -> Option<&str> {
    let inner = rest.strip_prefix("[!")?;
    let close = inner.find(']')?;
    let word = &inner[..close];
    (!word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    .then_some(word)
}

/// A list item whose content is an observation or relation head, read with
/// the parser's own rules.
fn is_structure(rest: &str) -> bool {
    let Some(content) = ["- ", "* ", "+ "].iter().find_map(|p| rest.strip_prefix(p)) else {
        return false;
    };
    let content = content.trim_start();
    split_category(content).is_some() || parse_relation(content).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(text: &str, engram: bool) -> Vec<(&'static str, usize)> {
        lint_markdown(text, 1, engram)
            .into_iter()
            .map(|f| (f.code, f.line))
            .collect()
    }

    #[test]
    fn an_unknown_status_colour_is_q006_and_a_known_one_is_quiet() {
        assert_eq!(
            codes("Ship :status[Done]{orange} now\n", false),
            [("Q006", 1)]
        );
        assert!(codes("Ship :status[Done]{green} and :status[Open]\n", false).is_empty());
        assert!(
            codes(
                "`:status[Done]{orange}`\n```\n:status[x]{pink}\n```\n",
                false
            )
            .is_empty()
        );
    }

    #[test]
    fn a_status_label_closes_on_its_balanced_bracket() {
        assert_eq!(codes(":status[a [b] c]{orange}\n", false), [("Q006", 1)]);
        assert_eq!(codes(":status[a \\] b]{orange}\n", false), [("Q006", 1)]);
        assert!(codes(":status[a [b] c]{green}\n", false).is_empty());
        // An unclosed label does not hide a later one on the same line.
        assert_eq!(
            codes(":status[open [ and :status[Done]{pink}\n", false),
            [("Q006", 1)]
        );
    }

    #[test]
    fn a_relation_head_without_its_close_is_not_q008() {
        assert!(codes("> [!NOTE]\n> - relates_to [[X\n", true).is_empty());
    }

    #[test]
    fn an_unknown_callout_kind_is_q007() {
        assert_eq!(codes("> [!DANGER] Hot\n> body\n", false), [("Q007", 1)]);
        for ok in [
            "> [!note]\n",
            "> [!WARNING]- Data loss\n",
            "> [!Details]+ More\n",
        ] {
            assert!(codes(ok, false).is_empty(), "{ok:?}");
        }
        // Not at the head of a quote: not a callout marker at all.
        assert!(codes("> see [!DANGER] here\n", false).is_empty());
    }

    #[test]
    fn structure_inside_a_callout_is_q008_for_engrams_only() {
        let text = "> [!NOTE]\n> - [fact] hidden here\n> - relates_to [[X]]\n";
        assert_eq!(codes(text, true), [("Q008", 2), ("Q008", 3)]);
        assert!(codes(text, false).is_empty());
    }

    #[test]
    fn task_boxes_and_plain_quotes_are_not_q008() {
        assert!(codes("> [!NOTE]\n> - [x] done\n> - [ ] todo\n", true).is_empty());
        assert!(codes("> plain\n> - [fact] in a plain quote\n", true).is_empty());
        // A second quote after a blank line is a new block, not the callout.
        assert!(codes("> [!NOTE]\n\n> - [fact] elsewhere\n", true).is_empty());
    }
}
