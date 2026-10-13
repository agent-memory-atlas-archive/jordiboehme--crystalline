//! Sections: a `##` heading and its body, the unit of provenance, each with
//! a hidden id on the line under its heading. Headings are read through the
//! one heading walker the engram section edits use, so a `#` inside a fence
//! means the same thing to both.

use std::collections::BTreeSet;

use crate::emit::{EditError, SectionEdit, SectionOp, apply_section_op};
use crate::headings::{HeadingSpan, heading_spans};

/// The pseudo-section holding the text before the first `##`.
pub const TOP_SECTION: &str = "_top";

/// One section of a reflection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    /// The id under the heading; `None` for a heading that has none yet;
    /// [`TOP_SECTION`] for the text before the first `##`.
    pub id: Option<String>,
    /// The heading text, empty for [`TOP_SECTION`].
    pub heading: String,
    /// One-based file line of the heading (of the first body line for the top).
    pub line: usize,
    /// The heading line and the body, without the id line, LF-joined.
    pub text: String,
}

/// The id on an id line, or `None`. The line is trimmed first; the id is 4
/// to 16 lowercase hex digits.
pub fn parse_id_line(line: &str) -> Option<&str> {
    let id = line.trim().strip_prefix("<!-- r:")?.strip_suffix(" -->")?;
    let ok = (4..=16).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    ok.then_some(id)
}

/// The id line for `id`, without a line ending.
pub fn id_line(id: &str) -> String {
    format!("<!-- r:{id} -->")
}

/// A fresh id: 8 lowercase hex digits starting with a letter, so YAML never
/// reads it back as a number (`1234e567` would be a float).
pub fn random_section_id() -> String {
    loop {
        let id = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
        if id.as_bytes()[0].is_ascii_alphabetic() {
            return id;
        }
    }
}

/// A section's text as the hash and the queue's diff see it: CR dropped,
/// trailing whitespace trimmed per line, trailing blank lines dropped.
pub fn normalize_section_text(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').map(|l| l.trim_end()).collect();
    let end = lines
        .iter()
        .rposition(|l| !l.is_empty())
        .map_or(0, |i| i + 1);
    lines[..end].join("\n")
}

/// SHA-256 hex of a section's normalized text.
pub fn section_hash(text: &str) -> String {
    crate::provision::receipt::sha256_hex(normalize_section_text(text).as_bytes())
}

/// Where the body starts: its byte offset and its one-based file line.
fn body_start(source: &str) -> (usize, usize) {
    let offset = crate::frontmatter::split_frontmatter(source)
        .map(|parts| source.len() - parts.body.len())
        .unwrap_or(0);
    (offset, line_at(source, offset))
}

/// The one-based line the byte at `offset` sits on.
fn line_at(source: &str, offset: usize) -> usize {
    source[..offset].bytes().filter(|b| *b == b'\n').count() + 1
}

/// The `##` headings outside fences, in order.
fn level_two(source: &str) -> Vec<HeadingSpan> {
    heading_spans(source)
        .into_iter()
        .filter(|h| h.level == 2)
        .collect()
}

/// The id on the line right under heading `h`, and the byte where the line
/// after that one starts.
fn id_under<'a>(source: &'a str, h: &HeadingSpan) -> Option<(&'a str, usize)> {
    let rest = &source[h.line_end..];
    let len = rest.find('\n').map_or(rest.len(), |i| i + 1);
    parse_id_line(rest[..len].trim_end_matches(['\n', '\r'])).map(|id| (id, h.line_end + len))
}

/// The lines of `source[start..end]`, CR dropped. A range that stops at the
/// next heading ends in that heading's line break, which is no line of its
/// own, so its last piece is dropped.
fn lines_of(source: &str, start: usize, end: usize, stops_at_heading: bool) -> Vec<&str> {
    let mut lines: Vec<&str> = source[start..end]
        .split('\n')
        .map(|l| l.trim_end_matches('\r'))
        .collect();
    if stops_at_heading {
        lines.pop();
    }
    lines
}

/// Split a reflection into its sections, the top first.
pub fn split_sections(source: &str) -> Vec<Section> {
    let (offset, first_line) = body_start(source);
    let headings = level_two(source);
    let first = headings.first().map_or(source.len(), |h| h.line_start);
    let mut sections = vec![Section {
        id: Some(TOP_SECTION.to_string()),
        heading: String::new(),
        line: first_line,
        text: lines_of(source, offset, first, !headings.is_empty()).join("\n"),
    }];
    for (k, h) in headings.iter().enumerate() {
        let next = headings.get(k + 1).map(|n| n.line_start);
        let mut lines = lines_of(
            source,
            h.line_start,
            next.unwrap_or(source.len()),
            next.is_some(),
        );
        let id = id_under(source, h).map(|(id, _)| id.to_string());
        if id.is_some() {
            lines.remove(1);
        }
        sections.push(Section {
            id,
            heading: h.text.trim().to_string(),
            line: line_at(source, h.line_start),
            text: lines.join("\n"),
        });
    }
    sections
}

/// A section by id, else by heading (case-insensitive, first match).
pub fn find_section<'a>(sections: &'a [Section], key: &str) -> Option<&'a Section> {
    let wanted = key.trim().to_lowercase();
    sections
        .iter()
        .find(|s| s.id.as_deref() == Some(key))
        .or_else(|| {
            sections
                .iter()
                .find(|s| !s.heading.is_empty() && s.heading.to_lowercase() == wanted)
        })
}

/// Give every `##` heading without an id (or with an id an earlier heading
/// already holds) a fresh one on the line under it, minted by `mint` and
/// never one in `taken` or already on the page. Every other byte is kept.
/// Answers the new source and the minted ids in page order.
pub fn assign_ids(
    source: &str,
    taken: &BTreeSet<String>,
    mint: &mut dyn FnMut() -> String,
) -> (String, Vec<String>) {
    let headings = level_two(source);
    let mut in_page: BTreeSet<String> = headings
        .iter()
        .filter_map(|h| id_under(source, h).map(|(id, _)| id.to_string()))
        .collect();
    in_page.extend(taken.iter().cloned());
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut minted = Vec::new();
    let mut out = String::with_capacity(source.len() + 32);
    let mut at = 0;
    for h in &headings {
        let existing = id_under(source, h);
        // The first heading to carry an id keeps it.
        if let Some((id, _)) = existing
            && seen.insert(id.to_string())
        {
            continue;
        }
        // No id line, or a copy of one an earlier heading holds: a fresh id
        // goes on the line under the heading, in place of the copy.
        let heading = &source[..h.line_end];
        out.push_str(&source[at..h.line_end]);
        if !heading.ends_with('\n') {
            out.push('\n');
        }
        let id = loop {
            let id = mint();
            if in_page.insert(id.clone()) {
                break id;
            }
        };
        out.push_str(&id_line(&id));
        out.push_str(if heading.ends_with("\r\n") {
            "\r\n"
        } else {
            "\n"
        });
        seen.insert(id.clone());
        minted.push(id);
        at = existing.map_or(h.line_end, |(_, next)| next);
    }
    out.push_str(&source[at..]);
    (out, minted)
}

/// Give a heading that lost its id line (an editor or an agent that does
/// not keep HTML comments) the id `previous` holds under the same heading
/// text, unless `incoming` already carries that id. First match wins, and
/// an id is given back once. Every other byte is kept.
pub fn reattach_ids(incoming: &str, previous: &str) -> String {
    let mut spare: Vec<(String, String)> = split_sections(previous)
        .into_iter()
        .filter(|s| !s.heading.is_empty())
        .filter_map(|s| Some((s.heading.clone(), s.id?)))
        .collect();
    let headings = level_two(incoming);
    let present: BTreeSet<&str> = headings
        .iter()
        .filter_map(|h| id_under(incoming, h).map(|(id, _)| id))
        .collect();
    spare.retain(|(_, id)| !present.contains(id.as_str()));
    let mut out = String::with_capacity(incoming.len() + 64);
    let mut at = 0;
    for h in &headings {
        if id_under(incoming, h).is_some() {
            continue;
        }
        let Some(k) = spare
            .iter()
            .position(|(heading, _)| heading == h.text.trim())
        else {
            continue;
        };
        let (_, id) = spare.remove(k);
        let heading = &incoming[..h.line_end];
        out.push_str(&incoming[at..h.line_end]);
        if !heading.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&id_line(&id));
        out.push_str(if heading.ends_with("\r\n") {
            "\r\n"
        } else {
            "\n"
        });
        at = h.line_end;
    }
    out.push_str(&incoming[at..]);
    out
}

/// One section edit on a reflection, through the edit the engram section
/// operations run, keeping every id line: the id lines are lifted off, the
/// edit runs on the page without them (so a replace cannot erase one and an
/// insert after the heading lands under its id, never between), and each
/// heading gets its id back by its text. A heading the edit
/// added stays without an id until the write assigns one.
pub fn edit_section(
    source: &str,
    op: SectionOp,
    path: &str,
    content: &str,
) -> Result<SectionEdit, EditError> {
    let bare = without_id_lines(source);
    let mut edit = apply_section_op(&bare, op, path, content)?;
    edit.text = reattach_ids(&edit.text, source);
    Ok(edit)
}

/// `source` without the id line under any `##` heading.
fn without_id_lines(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut at = 0;
    for h in &level_two(source) {
        if let Some((_, next)) = id_under(source, h) {
            out.push_str(&source[at..h.line_end]);
            at = next;
        }
    }
    out.push_str(&source[at..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::emit::SectionOp;

    const PAGE: &str = "---\ntitle: Deploying\n---\n\n# Deploying\n\nIntro.\n\n## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run at night.\n\n```\n## not a heading\n```\n\n## Rollback\n<!-- r:0b1c2d3e -->\n\nRoll back with the script.\n";

    #[test]
    fn sections_split_at_level_two_outside_fences() {
        let sections = split_sections(PAGE);
        let ids: Vec<Option<&str>> = sections.iter().map(|s| s.id.as_deref()).collect();
        assert_eq!(ids, [Some(TOP_SECTION), Some("7f3a9c2e"), Some("0b1c2d3e")]);
        assert_eq!(sections[1].heading, "Night deploys");
        assert_eq!(
            sections[1].line, 9,
            "the heading's file line, the opening --- is line 1"
        );
        assert!(
            sections[1].text.contains("## not a heading"),
            "a fenced heading stays in its section"
        );
        assert!(
            !sections[1].text.contains("<!-- r:"),
            "the id line is not text"
        );
        assert!(sections[0].text.contains("# Deploying") && sections[0].text.contains("Intro."));
        assert_eq!(
            sections[1].text,
            "## Night deploys\n\nDeploys run at night.\n\n```\n## not a heading\n```\n",
            "the heading line and the body up to the next heading, one blank line kept"
        );
        assert_eq!(
            sections[2].text,
            "## Rollback\n\nRoll back with the script.\n"
        );
    }

    #[test]
    fn a_heading_rename_keeps_the_id_and_the_hash_follows_the_text() {
        let renamed = PAGE.replace("## Night deploys", "## Deploys at night");
        let before = split_sections(PAGE);
        let after = split_sections(&renamed);
        assert_eq!(after[1].id, before[1].id);
        assert_ne!(section_hash(&after[1].text), section_hash(&before[1].text));
        let trailing = PAGE.replace("Deploys run at night.", "Deploys run at night.   \r");
        assert_eq!(
            section_hash(&split_sections(&trailing)[1].text),
            section_hash(&before[1].text),
            "trailing spaces and CR do not count as a change"
        );
    }

    #[test]
    fn a_heading_without_an_id_is_addressed_by_heading_and_gets_one_on_the_next_write() {
        let edited = PAGE.replace(
            "## Rollback",
            "## Added by hand\n\nA person typed this.\n\n## Rollback",
        );
        let sections = split_sections(&edited);
        let added = find_section(&sections, "added by hand").expect("addressed by heading");
        assert_eq!(added.id, None);
        let mut next = ["aaaa1111", "bbbb2222"].into_iter().map(str::to_string);
        let (written, minted) = assign_ids(&edited, &BTreeSet::new(), &mut || next.next().unwrap());
        assert_eq!(minted, vec!["aaaa1111".to_string()]);
        assert!(written.contains("## Added by hand\n<!-- r:aaaa1111 -->\n"));
        assert_eq!(
            written.replace("<!-- r:aaaa1111 -->\n", ""),
            edited,
            "nothing else moved"
        );
        let mut never = || -> String { unreachable!("every heading has an id now") };
        assert_eq!(
            assign_ids(&written, &BTreeSet::new(), &mut never).1,
            Vec::<String>::new()
        );
        assert!(
            find_section(&sections, "ÄDDED BY HAND").is_none()
                && find_section(&sections, "ADDED BY HAND").is_some()
        );
    }

    #[test]
    fn a_page_resubmitted_without_its_id_lines_gets_them_back_by_heading() {
        let bare = "# Deploying\n\nIntro.\n\n## Night deploys\n\nDeploys run at dawn now.\n\n## Brand new\n\nNew.\n\n## Rollback\n\nRoll back.\n";
        let back = reattach_ids(bare, PAGE);
        assert!(
            back.contains("## Night deploys\n<!-- r:7f3a9c2e -->\n"),
            "{back}"
        );
        assert!(back.contains("## Rollback\n<!-- r:0b1c2d3e -->\n"));
        assert!(
            back.contains("## Brand new\n\nNew."),
            "a new heading stays without an id"
        );
        let twice = "## Night deploys\n\nA.\n\n## Night deploys\n\nB.\n";
        let once = reattach_ids(twice, PAGE);
        assert_eq!(
            once.matches("<!-- r:7f3a9c2e -->").count(),
            1,
            "an id is given back once"
        );
        let carried = "## Renamed\n<!-- r:7f3a9c2e -->\n\nA.\n\n## Night deploys\n\nB.\n";
        let kept = reattach_ids(carried, PAGE);
        assert_eq!(
            kept.matches("<!-- r:7f3a9c2e -->").count(),
            1,
            "an id the page carries is not given again"
        );
        assert!(kept.contains("## Night deploys\n\nB."), "{kept}");
    }

    #[test]
    fn a_copied_id_and_a_taken_id_are_replaced() {
        let copied = PAGE.replace("<!-- r:0b1c2d3e -->", "<!-- r:7f3a9c2e -->");
        let taken: BTreeSet<String> = ["cccc3333".to_string()].into();
        let mut next = ["cccc3333", "dddd4444"].into_iter().map(str::to_string);
        let (written, minted) = assign_ids(&copied, &taken, &mut || next.next().unwrap());
        assert_eq!(
            minted,
            vec!["dddd4444".to_string()],
            "a taken id is never minted"
        );
        assert!(
            written.contains("## Night deploys\n<!-- r:7f3a9c2e -->"),
            "the first keeps it"
        );
        assert!(written.contains("## Rollback\n<!-- r:dddd4444 -->"));
        assert!(
            !written.contains("## Rollback\n<!-- r:7f3a9c2e -->"),
            "the copy is replaced, not doubled"
        );
        // An id the caller lists as taken is kept where the page carries it:
        // `taken` bars minting only.
        let reflected: BTreeSet<String> = ["7f3a9c2e".to_string()].into();
        let mut never = || -> String { unreachable!("nothing is new") };
        assert_eq!(
            assign_ids(PAGE, &reflected, &mut never),
            (PAGE.to_string(), Vec::new())
        );
    }

    #[test]
    fn crlf_pages_get_crlf_id_lines_and_minted_ids_start_with_a_letter() {
        let crlf = "# T\r\n\r\n## A\r\nText\r\n";
        let (written, _) = assign_ids(crlf, &BTreeSet::new(), &mut || "abcd0123".into());
        assert_eq!(
            written,
            "# T\r\n\r\n## A\r\n<!-- r:abcd0123 -->\r\nText\r\n"
        );
        for _ in 0..200 {
            let id = random_section_id();
            assert_eq!(id.len(), 8);
            assert!(
                id.as_bytes()[0].is_ascii_alphabetic(),
                "{id} could read as a number"
            );
            assert!(parse_id_line(&id_line(&id)).is_some());
        }
        assert_eq!(parse_id_line("<!-- r:XYZ -->"), None);
        assert_eq!(parse_id_line("  <!-- r:abcd -->  "), Some("abcd"));
    }

    /// Open point 1 (approved): a section edit keeps the section's id line,
    /// whichever of the three operations it is, and reports a dropped repeat
    /// of the heading the way the engram edit does.
    #[test]
    fn a_section_edit_keeps_every_id_line() {
        let replaced = edit_section(
            PAGE,
            SectionOp::Replace {
                include_subsections: false,
            },
            "## Night deploys",
            "Deploys run at dawn.",
        )
        .unwrap();
        assert!(
            replaced
                .text
                .contains("## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run at dawn.\n"),
            "{}",
            replaced.text
        );
        assert!(!replaced.text.contains("Deploys run at night."));
        let after = edit_section(
            PAGE,
            SectionOp::InsertAfter,
            "## Rollback",
            "First, stop the batch.",
        )
        .unwrap();
        assert!(
            after
                .text
                .contains("## Rollback\n<!-- r:0b1c2d3e -->\n\nFirst, stop the batch.\n"),
            "under the id line: {}",
            after.text
        );
        let before = edit_section(
            PAGE,
            SectionOp::InsertBefore,
            "## Rollback",
            "## Checks\n\nLook first.",
        )
        .unwrap();
        assert!(
            before
                .text
                .contains("## Checks\n\nLook first.\n\n## Rollback\n<!-- r:0b1c2d3e -->"),
            "{}",
            before.text
        );
        let stripped = edit_section(
            PAGE,
            SectionOp::Replace {
                include_subsections: false,
            },
            "## Rollback",
            "## Rollback\n\nNew.",
        )
        .unwrap();
        assert_eq!(stripped.heading_stripped.as_deref(), Some("## Rollback"));
        assert!(edit_section(PAGE, SectionOp::InsertAfter, "## Nowhere", "x").is_err());
        for edit in [replaced, after, before, stripped] {
            let ids: Vec<Option<String>> = split_sections(&edit.text)
                .into_iter()
                .map(|s| s.id)
                .collect();
            assert!(
                ids.contains(&Some("7f3a9c2e".into())) && ids.contains(&Some("0b1c2d3e".into())),
                "{ids:?}"
            );
            // An id line the edit left in a body would be read as text and
            // copied on: every id line stands under its heading, once.
            assert_eq!(
                edit.text.matches("<!-- r:").count(),
                2,
                "no stray id line: {}",
                edit.text
            );
        }
    }
}
