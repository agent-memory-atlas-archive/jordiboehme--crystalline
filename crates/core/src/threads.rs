//! Threads: discussions anchored on a passage of a document, stored in a
//! thread file the document's kind places. One `##` per thread. The model is
//! the familiar document comment: an anchor on a section plus a quoted
//! passage, a status, and a history that is only ever appended to. The
//! format knows no kind of document: the anchor names its section by id or
//! by heading, and the caller hands in how to find that section's text.
//! Where a kind keeps its thread file is that kind's own choice.

use serde::{Deserialize, Serialize};

/// How an anchor names its section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SectionRef {
    /// A section id: what a document with id lines (a reflection) writes.
    Id(String),
    /// A heading path (`## API > ### Auth`): what a document without id
    /// lines will write.
    Heading(String),
}

impl SectionRef {
    /// The id, for an anchor addressed by id.
    pub fn id(&self) -> Option<&str> {
        match self {
            SectionRef::Id(id) => Some(id),
            SectionRef::Heading(_) => None,
        }
    }

    /// The id or the heading path, whichever the anchor names.
    pub fn key(&self) -> &str {
        match self {
            SectionRef::Id(key) | SectionRef::Heading(key) => key,
        }
    }
}

/// Where a thread is anchored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Anchor {
    /// The section.
    pub section: SectionRef,
    /// The quoted passage; `None` for the whole section.
    pub quote: Option<String>,
    /// Which occurrence of the quote in the section, 1-based.
    pub occurrence: u32,
}

/// Open or resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadStatus {
    /// Waiting for somebody.
    Open,
    /// Closed with an outcome; reopening is a new entry.
    Resolved,
}

impl ThreadStatus {
    /// The wire word.
    pub fn as_str(self) -> &'static str {
        match self {
            ThreadStatus::Open => "open",
            ThreadStatus::Resolved => "resolved",
        }
    }
}

/// What one entry did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    /// Said something.
    Comment,
    /// Closed the thread with an outcome.
    Resolve,
    /// Opened a resolved thread again.
    Reopen,
}

impl EntryKind {
    /// The wire word, which is also the word in the file.
    pub fn as_str(self) -> &'static str {
        match self {
            EntryKind::Comment => "comment",
            EntryKind::Resolve => "resolve",
            EntryKind::Reopen => "reopen",
        }
    }

    fn parse(word: &str) -> Option<EntryKind> {
        match word {
            "comment" => Some(EntryKind::Comment),
            "resolve" => Some(EntryKind::Resolve),
            "reopen" => Some(EntryKind::Reopen),
            _ => None,
        }
    }
}

/// Who wrote an entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Author {
    /// The account or agent label, sanitized.
    pub name: String,
    /// Whether an agent wrote it.
    pub agent: bool,
}

/// One entry in a thread's history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// RFC 3339.
    pub at: String,
    /// What it did.
    pub kind: EntryKind,
    /// Who.
    pub author: Author,
    /// What was said; may span lines; may be empty for a reopen.
    pub text: String,
}

/// One thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Thread {
    /// `t-` plus 8 hex digits.
    pub id: String,
    /// Where it is anchored.
    pub anchor: Anchor,
    /// Open or resolved.
    pub status: ThreadStatus,
    /// The history, oldest first.
    pub entries: Vec<Entry>,
}

impl Thread {
    /// When the first entry was written.
    pub fn opened_at(&self) -> &str {
        self.entries.first().map(|e| e.at.as_str()).unwrap_or("")
    }

    /// When the last entry was written.
    pub fn last_at(&self) -> &str {
        self.entries.last().map(|e| e.at.as_str()).unwrap_or("")
    }
}

/// The yaml block of one thread. `section` for an anchor by id, `heading`
/// for one by heading path; exactly one of them is written.
#[derive(Serialize, Deserialize)]
struct Meta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    section: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    heading: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quote: Option<String>,
    #[serde(default = "one")]
    occurrence: u32,
    status: ThreadStatus,
}

fn one() -> u32 {
    1
}

/// Why an entry could not be appended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadError {
    /// No thread with this id in the file.
    NoThread(String),
    /// The thread is there and the entry does not fit its state.
    Refused(String),
}

impl std::fmt::Display for ThreadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThreadError::NoThread(id) => write!(f, "no thread {id} here"),
            ThreadError::Refused(why) => f.write_str(why),
        }
    }
}

impl std::error::Error for ThreadError {}

/// A fresh thread id: `t-` plus 8 lowercase hex digits, the first a letter.
pub fn random_thread_id() -> String {
    loop {
        let hex = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
        if hex.as_bytes()[0].is_ascii_alphabetic() {
            return format!("t-{hex}");
        }
    }
}

/// A name that cannot break an entry line: parentheses, colons, commas and
/// line breaks become spaces, runs of spaces collapse, an empty name is
/// `someone`.
pub fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '(' | ')' | ':' | '\n' | '\r' | ',') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.is_empty() {
        "someone".to_string()
    } else {
        joined
    }
}

fn render_entry(entry: &Entry) -> String {
    let who = if entry.author.agent {
        "agent"
    } else {
        "person"
    };
    let mut lines = entry.text.lines();
    let first = lines.next().unwrap_or("");
    let mut out = format!(
        "- {}, {} by {} ({who})",
        entry.at,
        entry.kind.as_str(),
        sanitize_name(&entry.author.name)
    );
    if !first.is_empty() {
        out.push_str(": ");
        out.push_str(first);
    }
    out.push('\n');
    for line in lines {
        out.push_str("  ");
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn parse_entry(line: &str) -> Option<Entry> {
    let rest = line.strip_prefix("- ")?;
    let (at, rest) = rest.split_once(", ")?;
    let (kind, rest) = rest.split_once(" by ")?;
    let open = rest.find(" (")?;
    let name = &rest[..open];
    let after = &rest[open + 2..];
    let (who, text) = match after.split_once("): ") {
        Some((who, text)) => (who, text),
        None => (after.strip_suffix(')')?, ""),
    };
    Some(Entry {
        at: at.to_string(),
        kind: EntryKind::parse(kind)?,
        author: Author {
            name: name.to_string(),
            agent: who == "agent",
        },
        text: text.to_string(),
    })
}

fn render_thread(thread: &Thread) -> String {
    let (section, heading) = match &thread.anchor.section {
        SectionRef::Id(id) => (Some(id.clone()), None),
        SectionRef::Heading(path) => (None, Some(path.clone())),
    };
    let meta = Meta {
        section,
        heading,
        quote: thread.anchor.quote.clone(),
        occurrence: thread.anchor.occurrence.max(1),
        status: thread.status,
    };
    let yaml = serde_yaml_ng::to_string(&meta).unwrap_or_default();
    let mut out = format!("## {}\n\n```yaml\n{yaml}```\n\n", thread.id);
    for entry in &thread.entries {
        out.push_str(&render_entry(entry));
    }
    out
}

/// The yaml block of one thread's text (everything after its `##` line):
/// the byte range of the yaml between the opening ```` ```yaml ```` line and
/// the first line that is exactly the closing fence, and where the entries
/// start. A fence inside a quoted passage is never a line of its own (the
/// quote is a YAML scalar on the `quote:` line, or indented under it).
fn yaml_block(rest: &str) -> Option<(usize, usize, usize)> {
    let open = rest.find("```yaml\n")? + "```yaml\n".len();
    let mut at = open;
    for line in rest[open..].split_inclusive('\n') {
        if line.trim_end_matches('\n') == "```" {
            return Some((open, at, at + line.len()));
        }
        at += line.len();
    }
    None
}

/// Every thread in a threads file, in file order. A block that does not
/// read as a thread is skipped rather than failing the whole file. A CRLF
/// file reads like an LF one.
pub fn parse_threads(text: &str) -> Vec<Thread> {
    let text = crate::to_lf(text);
    let mut threads = Vec::new();
    for block in text.split("\n## ").skip(1) {
        let (id, rest) = block.split_once('\n').unwrap_or((block, ""));
        let Some((start, end, entries_at)) = yaml_block(rest) else {
            continue;
        };
        let Ok(meta) = serde_yaml_ng::from_str::<Meta>(&rest[start..end]) else {
            continue;
        };
        let section = match (meta.section, meta.heading) {
            (Some(id), _) => SectionRef::Id(id),
            (None, Some(path)) => SectionRef::Heading(path),
            (None, None) => continue,
        };
        let mut entries: Vec<Entry> = Vec::new();
        for line in rest[entries_at..].lines() {
            if let Some(cont) = line.strip_prefix("  ")
                && let Some(last) = entries.last_mut()
            {
                last.text.push('\n');
                last.text.push_str(cont);
            } else if let Some(entry) = parse_entry(line) {
                entries.push(entry);
            }
        }
        threads.push(Thread {
            id: id.trim().to_string(),
            anchor: Anchor {
                section,
                quote: meta.quote,
                occurrence: meta.occurrence,
            },
            status: meta.status,
            entries,
        });
    }
    threads
}

/// `file` with `thread` appended; an empty file gets its `# Threads` title.
pub fn open_thread(file: &str, thread: &Thread) -> String {
    let mut out = if file.trim().is_empty() {
        "# Threads\n\n".to_string()
    } else {
        let mut kept = crate::to_lf(file).trim_end_matches('\n').to_string();
        kept.push_str("\n\n");
        kept
    };
    out.push_str(&render_thread(thread));
    out
}

/// `file` with `entry` appended to thread `id`. A resolve sets the status to
/// resolved and needs an outcome; a reopen sets it to open; a comment needs
/// the thread open. The only existing byte that changes is the `status:`
/// line of that thread's yaml block. The file comes back as LF.
pub fn append_entry(file: &str, id: &str, entry: &Entry) -> Result<String, ThreadError> {
    let file = crate::to_lf(file).into_owned();
    let thread = parse_threads(&file)
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| ThreadError::NoThread(id.to_string()))?;
    let refused = |why: String| -> Result<String, ThreadError> { Err(ThreadError::Refused(why)) };
    let new_status = match (entry.kind, thread.status) {
        (EntryKind::Comment, ThreadStatus::Open) => None,
        (EntryKind::Comment, ThreadStatus::Resolved) => {
            return refused(format!("thread {id} is resolved; reopen it to answer"));
        }
        (EntryKind::Resolve, ThreadStatus::Open) if entry.text.trim().is_empty() => {
            return refused("resolving a thread needs a short outcome".to_string());
        }
        (EntryKind::Resolve, ThreadStatus::Open) => Some(ThreadStatus::Resolved),
        (EntryKind::Resolve, ThreadStatus::Resolved) => {
            return refused(format!("thread {id} is already resolved"));
        }
        (EntryKind::Reopen, ThreadStatus::Resolved) => Some(ThreadStatus::Open),
        (EntryKind::Reopen, ThreadStatus::Open) => {
            return refused(format!("thread {id} is open already"));
        }
    };
    let header = format!("\n## {id}\n");
    let start = file
        .find(&header)
        .ok_or_else(|| ThreadError::NoThread(id.to_string()))?;
    let body_start = start + header.len();
    let end = file[body_start..]
        .find("\n## ")
        .map(|i| body_start + i + 1)
        .unwrap_or(file.len());
    // The entry goes right after the thread's last line; the blank lines
    // before the next thread stay as they are.
    let content_end = start + file[start..end].trim_end_matches('\n').len();
    let (insert_at, line_break) = if file[content_end..].starts_with('\n') {
        (content_end + 1, "")
    } else {
        (content_end, "\n")
    };
    let mut head = file[..insert_at].to_string();
    if let Some(status) = new_status {
        // The status line inside this thread's yaml block, and nowhere else:
        // a quoted passage may hold the same words, and a line inside the
        // block that is not a top-level key is indented.
        let (yaml_start, yaml_end, _) = yaml_block(&file[body_start..end])
            .ok_or_else(|| ThreadError::NoThread(id.to_string()))?;
        let (yaml_start, yaml_end) = (body_start + yaml_start, body_start + yaml_end);
        let mut replaced = false;
        let yaml: String = file[yaml_start..yaml_end]
            .split_inclusive('\n')
            .map(|line| {
                if !replaced && line.starts_with("status:") {
                    replaced = true;
                    format!("status: {}\n", status.as_str())
                } else {
                    line.to_string()
                }
            })
            .collect();
        if !replaced {
            return refused(format!(
                "thread {id} has no status line of its own to change"
            ));
        }
        head.replace_range(yaml_start..yaml_end, &yaml);
    }
    Ok(format!(
        "{head}{line_break}{}{}",
        render_entry(entry),
        &file[insert_at..]
    ))
}

/// Where an anchor stands in its document now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorState {
    /// The passage is there; byte offsets within the section's text.
    Found { start: usize, end: usize },
    /// The section is there, the passage is not.
    TextChanged,
    /// The section is gone; the thread shows at the top of the document.
    SectionGone,
}

impl AnchorState {
    /// The wire word.
    pub fn as_str(self) -> &'static str {
        match self {
            AnchorState::Found { .. } => "found",
            AnchorState::TextChanged => "text_changed",
            AnchorState::SectionGone => "section_gone",
        }
    }
}

/// Resolve an anchor. `section_text` is the target's lookup: the text of
/// the section an anchor names, or `None` when it is gone.
pub fn resolve_anchor(
    anchor: &Anchor,
    section_text: &dyn Fn(&SectionRef) -> Option<String>,
) -> AnchorState {
    let Some(text) = section_text(&anchor.section) else {
        return AnchorState::SectionGone;
    };
    let Some(quote) = anchor.quote.as_deref().filter(|q| !q.is_empty()) else {
        return AnchorState::Found {
            start: 0,
            end: text.len(),
        };
    };
    let mut from = 0;
    for n in 1..=anchor.occurrence.max(1) {
        match text[from..].find(quote) {
            Some(at) if n == anchor.occurrence.max(1) => {
                let start = from + at;
                return AnchorState::Found {
                    start,
                    end: start + quote.len(),
                };
            }
            Some(at) => from += at + quote.len(),
            None => break,
        }
    }
    AnchorState::TextChanged
}

/// Who a thread waits on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waiting {
    /// An agent spoke last.
    People,
    /// A person spoke last.
    Agent,
}

impl Waiting {
    /// The wire word.
    pub fn as_str(self) -> &'static str {
        match self {
            Waiting::People => "people",
            Waiting::Agent => "agent",
        }
    }
}

/// An open thread waits on whoever did not write its last entry.
pub fn waiting_on(thread: &Thread) -> Waiting {
    match thread.entries.last() {
        Some(entry) if entry.author.agent => Waiting::People,
        _ => Waiting::Agent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn person(text: &str, kind: EntryKind, at: &str) -> Entry {
        Entry {
            at: at.into(),
            kind,
            author: Author {
                name: "jordi".into(),
                agent: false,
            },
            text: text.into(),
        }
    }

    fn agent(text: &str, kind: EntryKind, at: &str) -> Entry {
        Entry {
            at: at.into(),
            kind,
            author: Author {
                name: "claude-code".into(),
                agent: true,
            },
            text: text.into(),
        }
    }

    fn thread(quote: Option<&str>, occurrence: u32) -> Thread {
        Thread {
            id: "t-3f9a2c1b".into(),
            anchor: Anchor {
                section: SectionRef::Id("7f3a9c2e".into()),
                quote: quote.map(str::to_string),
                occurrence,
            },
            status: ThreadStatus::Open,
            entries: vec![person(
                "Is this still true?\nAfter the migration?",
                EntryKind::Comment,
                "2026-09-30T10:00:00Z",
            )],
        }
    }

    #[test]
    fn a_thread_file_round_trips_and_reads_in_a_file_browser() {
        let file = open_thread("", &thread(Some("Deploys run at night"), 2));
        assert!(
            file.starts_with("# Threads\n\n## t-3f9a2c1b\n\n```yaml\nsection: 7f3a9c2e\n"),
            "{file}"
        );
        assert!(file.contains("- 2026-09-30T10:00:00Z, comment by jordi (person): Is this still true?\n  After the migration?\n"));
        assert_eq!(
            parse_threads(&file),
            vec![thread(Some("Deploys run at night"), 2)]
        );
        let second = Thread {
            id: "t-00000abc".into(),
            ..thread(None, 1)
        };
        let both = open_thread(&file, &second);
        assert_eq!(parse_threads(&both).len(), 2);
        assert!(both.starts_with(&file), "opening a thread only appends");
        // A conventional comment (`<label> [decorations]: <subject>`)
        // keeps its label line whole; the entry header ends at the first "): ".
        let labelled = Thread {
            id: "t-0000c0de".into(),
            entries: vec![person(
                "issue (blocking): the batch window moved\nSee the runbook.",
                EntryKind::Comment,
                "2026-09-30T10:00:00Z",
            )],
            ..thread(None, 1)
        };
        assert_eq!(parse_threads(&open_thread("", &labelled)), vec![labelled]);
    }

    /// Target neutral: an anchor addressed by heading path (what an engram
    /// target will write) round-trips under its own key.
    #[test]
    fn a_heading_anchor_is_written_under_its_own_key() {
        let by_heading = Thread {
            anchor: Anchor {
                section: SectionRef::Heading("## API > ### Auth".into()),
                quote: None,
                occurrence: 1,
            },
            ..thread(None, 1)
        };
        let file = open_thread("", &by_heading);
        assert!(
            file.contains("heading: '## API > ### Auth'")
                || file.contains("heading: \"## API > ### Auth\""),
            "{file}"
        );
        assert!(!file.contains("section:"), "{file}");
        assert_eq!(parse_threads(&file), vec![by_heading]);
        assert_eq!(SectionRef::Id("7f3a9c2e".into()).key(), "7f3a9c2e");
        assert_eq!(SectionRef::Heading("Night".into()).id(), None);
    }

    #[test]
    fn resolving_changes_only_the_status_line_and_reopening_is_a_new_entry() {
        // Not in the form `open_thread` writes (the yaml keys in another
        // order, a blank line before the entries), so an append that
        // re-rendered the thread would change bytes.
        let file = "# Threads\n\n## t-3f9a2c1b\n\n```yaml\nstatus: open\nsection: 7f3a9c2e\nquote: 'status: open'\n```\n\n\n- 2026-09-30T10:00:00Z, comment by jordi (person): Is this still true?\n";
        let resolved = append_entry(
            file,
            "t-3f9a2c1b",
            &agent(
                "Still true; the engram says so.",
                EntryKind::Resolve,
                "2026-09-30T11:00:00Z",
            ),
        )
        .unwrap();
        let without_new_entry = resolved.replace("- 2026-09-30T11:00:00Z, resolve by claude-code (agent): Still true; the engram says so.\n", "");
        assert_eq!(
            without_new_entry.replacen("status: resolved", "status: open", 1),
            file,
            "the history is never rewritten: one appended line and the status"
        );
        assert!(
            resolved.contains("quote: 'status: open'"),
            "a quoted passage is never the status line: {resolved}"
        );
        assert_eq!(parse_threads(&resolved)[0].status, ThreadStatus::Resolved);

        let err = append_entry(
            &resolved,
            "t-3f9a2c1b",
            &person("more", EntryKind::Comment, "2026-09-30T12:00:00Z"),
        )
        .unwrap_err();
        assert!(
            matches!(err, ThreadError::Refused(_)) && err.to_string().contains("reopen"),
            "{err}"
        );
        assert!(
            append_entry(
                &resolved,
                "t-3f9a2c1b",
                &person("x", EntryKind::Resolve, "t")
            )
            .is_err()
        );

        let reopened = append_entry(
            &resolved,
            "t-3f9a2c1b",
            &person("", EntryKind::Reopen, "2026-09-30T12:00:00Z"),
        )
        .unwrap();
        assert!(reopened.contains("status: open\nsection: 7f3a9c2e"));
        assert!(reopened.contains("- 2026-09-30T11:00:00Z, resolve by claude-code (agent): Still true; the engram says so.\n- 2026-09-30T12:00:00Z, reopen by jordi (person)\n"));
        let t = &parse_threads(&reopened)[0];
        assert_eq!(t.status, ThreadStatus::Open);
        assert_eq!(t.entries.len(), 3, "the reopen is visible in the history");
        assert_eq!(t.entries[2].kind, EntryKind::Reopen);
        assert!(
            append_entry(
                &reopened,
                "t-3f9a2c1b",
                &person("x", EntryKind::Reopen, "t")
            )
            .is_err()
        );
        assert_eq!(
            append_entry(
                &reopened,
                "t-nothere",
                &person("x", EntryKind::Comment, "t")
            ),
            Err(ThreadError::NoThread("t-nothere".into())),
            "an unknown thread is its own error, so the engine answers it as not found"
        );
        let canonical = open_thread("", &thread(None, 1));
        assert!(
            append_entry(
                &canonical,
                "t-3f9a2c1b",
                &agent("", EntryKind::Resolve, "t")
            )
            .is_err(),
            "an outcome is required"
        );
    }

    /// A quoted passage ahead of the status line, and blank lines between
    /// two threads: the status line is the yaml key, and every other byte of
    /// the file, the blank lines included, stays where it was.
    #[test]
    fn the_status_key_changes_wherever_it_stands_and_the_spacing_is_kept() {
        let file = "# Threads\n\n## t-3f9a2c1b\n\n```yaml\nsection: 7f3a9c2e\nquote: |-\n  status: open\n  is what it says\nstatus: open\n```\n\n- 2026-09-30T10:00:00Z, comment by jordi (person): Is this still true?\n\n\n\n## t-00000abc\n\n```yaml\nsection: 0b1c2d3e\nstatus: open\n```\n\n- 2026-09-30T10:00:00Z, comment by jordi (person): Other.\n";
        let entry = "- 2026-09-30T11:00:00Z, resolve by claude-code (agent): Done.\n";
        let resolved = append_entry(
            file,
            "t-3f9a2c1b",
            &agent("Done.", EntryKind::Resolve, "2026-09-30T11:00:00Z"),
        )
        .unwrap();
        assert_eq!(
            resolved,
            file.replacen("status: open\n```", "status: resolved\n```", 1)
                .replacen("true?\n", &format!("true?\n{entry}"), 1)
        );
        let threads = parse_threads(&resolved);
        assert_eq!(
            threads[0].anchor.quote.as_deref(),
            Some("status: open\nis what it says")
        );
        assert_eq!(
            (threads[0].status, threads[1].status),
            (ThreadStatus::Resolved, ThreadStatus::Open)
        );
        let reopened =
            append_entry(&resolved, "t-3f9a2c1b", &person("", EntryKind::Reopen, "t")).unwrap();
        assert!(
            reopened.contains("quote: |-\n  status: open\n  is what it says\nstatus: open\n```"),
            "{reopened}"
        );
        let at_the_end = append_entry(
            file.trim_end_matches('\n'),
            "t-00000abc",
            &agent("Yes.", EntryKind::Comment, "t"),
        )
        .unwrap();
        assert!(
            at_the_end.ends_with("Other.\n- t, comment by claude-code (agent): Yes.\n"),
            "{at_the_end}"
        );
    }

    #[test]
    fn a_quote_with_a_fence_and_a_crlf_file_still_read() {
        let fenced = thread(Some("run ```make deploy``` at night"), 1);
        let file = open_thread("", &fenced);
        assert_eq!(
            parse_threads(&file),
            vec![fenced],
            "the block ends at its closing fence line: {file}"
        );
        let crlf = open_thread("", &thread(None, 1)).replace('\n', "\r\n");
        assert_eq!(
            parse_threads(&crlf).len(),
            1,
            "a CRLF file reads like an LF one"
        );
        assert!(append_entry(&crlf, "t-3f9a2c1b", &agent("Yes.", EntryKind::Comment, "t")).is_ok());
    }

    #[test]
    fn an_anchor_resolves_against_the_section_its_target_hands_it() {
        let night =
            "## Night deploys\n\nDeploys run at night, after the batch.\nDeploys run at night.\n"
                .to_string();
        let lookup = |section: &SectionRef| (section.key() == "7f3a9c2e").then(|| night.clone());
        let anchor = thread(Some("Deploys run at night"), 2).anchor;
        let AnchorState::Found { start, end } = resolve_anchor(&anchor, &lookup) else {
            panic!()
        };
        assert_eq!(&night[start..end], "Deploys run at night");
        assert!(
            start > night.find("Deploys run at night").unwrap(),
            "the second occurrence"
        );
        let rewritten = |_: &SectionRef| {
            Some("## Night deploys\n\nWe deploy in the morning now.\n".to_string())
        };
        assert_eq!(
            resolve_anchor(&anchor, &rewritten),
            AnchorState::TextChanged
        );
        assert_eq!(resolve_anchor(&anchor, &|_| None), AnchorState::SectionGone);
        let whole = Anchor {
            section: SectionRef::Id("7f3a9c2e".into()),
            quote: None,
            occurrence: 1,
        };
        assert!(matches!(
            resolve_anchor(&whole, &lookup),
            AnchorState::Found { .. }
        ));
    }

    #[test]
    fn a_thread_waits_on_whoever_did_not_speak_last() {
        let mut t = thread(None, 1);
        assert_eq!(waiting_on(&t), Waiting::Agent, "a person asked");
        t.entries.push(agent(
            "Answered.",
            EntryKind::Comment,
            "2026-09-30T11:00:00Z",
        ));
        assert_eq!(waiting_on(&t), Waiting::People);
        assert_eq!(t.opened_at(), "2026-09-30T10:00:00Z");
        assert_eq!(t.last_at(), "2026-09-30T11:00:00Z");
    }

    #[test]
    fn names_cannot_break_the_entry_line() {
        assert_eq!(sanitize_name("Ada (ops): lead\nx"), "Ada ops lead x");
        assert_eq!(sanitize_name("   "), "someone");
        let id = random_thread_id();
        assert!(
            id.starts_with("t-") && id.len() == 10 && id.as_bytes()[2].is_ascii_alphabetic(),
            "{id}"
        );
    }
}
