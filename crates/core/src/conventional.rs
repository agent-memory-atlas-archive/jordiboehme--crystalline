//! Conventional comments (conventionalcomments.org) on a thread entry: a
//! first line `<label> [decorations]: <subject>`, then an optional
//! discussion. The text is stored as written; this module only reads the
//! first line, so a reader can draw the label and the queue can rank a
//! blocking thread first.
//!
//! The parse is strict, the way a status label is: only the exact form is a
//! label, anything else is plain text. The grammar is
//! `<label>( \(<decoration>(, <decoration>)*\))?: <subject>`, where the label
//! is one of the nine in [`Label`] in any case, a decoration is one or more
//! ASCII letters, digits or hyphens, and the subject is not empty once its
//! spaces are trimmed. fluid/src/markdown/conventionalComment.ts reads the
//! same grammar, and both are tested against
//! `crates/core/tests/fixtures/conventional-comments.json`.

/// The fixed label set. Nothing else is read as a label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Label {
    /// Something done well.
    Praise,
    /// A small detail, take it or leave it.
    Nitpick,
    /// A proposal to change something.
    Suggestion,
    /// Something is wrong.
    Issue,
    /// A small task to do.
    Todo,
    /// The writer needs an answer.
    Question,
    /// An idea, no action needed.
    Thought,
    /// A routine step to do before this is accepted.
    Chore,
    /// Something the reader should know.
    Note,
}

impl Label {
    /// Every label, in the order a menu lists them.
    pub const ALL: [Label; 9] = [
        Label::Praise,
        Label::Nitpick,
        Label::Suggestion,
        Label::Issue,
        Label::Todo,
        Label::Question,
        Label::Thought,
        Label::Chore,
        Label::Note,
    ];

    /// The label as it is written and drawn: lowercase.
    pub fn as_str(self) -> &'static str {
        match self {
            Label::Praise => "praise",
            Label::Nitpick => "nitpick",
            Label::Suggestion => "suggestion",
            Label::Issue => "issue",
            Label::Todo => "todo",
            Label::Question => "question",
            Label::Thought => "thought",
            Label::Chore => "chore",
            Label::Note => "note",
        }
    }

    /// The label a word names, in any case.
    pub fn parse(word: &str) -> Option<Label> {
        Label::ALL
            .into_iter()
            .find(|label| label.as_str().eq_ignore_ascii_case(word))
    }
}

/// The first line of a conventional comment, read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConventionalComment {
    /// The label.
    pub label: Label,
    /// The decorations as written, in their order: the three the standard
    /// names (`blocking`, `non-blocking`, `if-minor`) and any other.
    pub decorations: Vec<String>,
    /// The words after `: `, trimmed.
    pub subject: String,
}

impl ConventionalComment {
    /// Whether the comment blocks: it carries the `blocking` decoration, in
    /// any case.
    pub fn is_blocking(&self) -> bool {
        self.decorations
            .iter()
            .any(|d| d.eq_ignore_ascii_case("blocking"))
    }
}

/// Whether `word` is a decoration: one or more ASCII letters, digits or
/// hyphens.
fn is_decoration(word: &str) -> bool {
    !word.is_empty() && word.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// The conventional comment `text` opens with, read from its first line, or
/// `None` when that line is not exactly the form (plain text).
pub fn parse_conventional(text: &str) -> Option<ConventionalComment> {
    let line = text.split('\n').next().unwrap_or("");
    let line = line.strip_suffix('\r').unwrap_or(line);
    let (head, subject) = line.split_once(": ")?;
    let subject = subject.trim();
    if subject.is_empty() {
        return None;
    }
    let (word, decorations) = match head.split_once(' ') {
        None => (head, Vec::new()),
        Some((word, rest)) => {
            let inner = rest.strip_prefix('(')?.strip_suffix(')')?;
            let decorations: Vec<String> = inner.split(", ").map(str::to_string).collect();
            if !decorations.iter().all(|d| is_decoration(d)) {
                return None;
            }
            (word, decorations)
        }
    };
    Some(ConventionalComment {
        label: Label::parse(word)?,
        decorations,
        subject: subject.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_head_ends_at_the_first_colon_and_space() {
        // A colon in the subject is the subject's own.
        let parsed = parse_conventional("note: a: b").unwrap();
        assert_eq!(parsed.subject, "a: b");
        // A decoration list that holds ": " is no head at all.
        assert_eq!(parse_conventional("note (a: b): c"), None);
    }

    #[test]
    fn non_blocking_is_not_blocking() {
        let parsed = parse_conventional("question (non-blocking): why?").unwrap();
        assert!(!parsed.is_blocking());
    }
}
