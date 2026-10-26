//! The linked-file planner: which local files imported notes link to, where
//! each one goes under the domain's `assets/` and how the links are rewritten.
//!
//! An import brings Markdown notes from a folder or an archive. Their pictures
//! and documents sit beside them under whatever names the source gave them
//! (`report.pdf.assets/page-3.png`, `Q3 report (final).pdf`), and a Crystalline
//! domain keeps such files only under `assets/`, in names a link can carry.
//! This module settles, before a byte is written, which of those files are
//! taken, the clean asset path each one gets, and the note text with every
//! link pointing at it. It is pure: the files are reached through a
//! [`LinkedSource`], and what the domain already holds through a callback.
//!
//! The rules:
//!
//! - A target is read the way the rest of the crate reads one: an inline link
//!   or image outside inline code and fenced blocks (a table cell is ordinary
//!   text), or a reference definition, either markdown form, the `#fragment`
//!   split off, backslash escapes removed and percent-decoded. So `a%20b.png`
//!   and `<a b.png>` name one file.
//! - A URL (anything with a scheme), a bare `#anchor`, a note (`.md`) and a
//!   link already under `assets/` are not files and are left alone without a
//!   report. A target with a leading `/` is reported as outside.
//! - A target is resolved against the note's folder; one that climbs out of
//!   the source is outside. The checks then run in this order: the file must
//!   exist ([`NotTakenReason::Missing`], also for a folder or a file that
//!   cannot be read), carry an allowlisted extension
//!   ([`NotTakenReason::NotAllowed`]), be at most [`MAX_ATTACHMENT_BYTES`]
//!   ([`NotTakenReason::TooLarge`]), and both its name and the note's path
//!   must clean into a valid asset path ([`NotTakenReason::BadName`]).
//! - The dest is `assets/` + every segment of the note's path without `.md`,
//!   cleaned, + `/` + the cleaned file name. When that is longer than an asset
//!   path may be, the folder is the first 8 hex digits of the file's sha256.
//! - Files are deduplicated by sha256 across the whole run: the first note to
//!   link a file decides where its bytes are stored, and every link to the
//!   same bytes, under any name, points there.
//! - A dest the domain already holds with the same bytes is reused; one it
//!   holds with other bytes, or one an earlier file of this run claimed, gets
//!   the `-2`, `-3` suffix ([`suffixed_asset_path`]), up to 99. A file that
//!   finds no free name is reported as a bad name.
//! - A rewritten link keeps its alt text, its title and its `#fragment`; the
//!   dest is written bare, since a clean name never needs angle brackets. A
//!   link that is not taken is left exactly as written.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::attachment::{
    ASSETS_PREFIX, MAX_ATTACHMENT_BYTES, attachment_mime, clean_asset_segment, is_under_assets,
    suffixed_asset_path, validate_asset_path,
};
use crate::index::escape_link_url;
use crate::reflection::links::{
    code_spans, decode_target, ends_destination, read_destination, resolve,
};
use crate::relink::{BodyGate, rewrite_body_lines};

/// The most names a file is offered before it is given up, the same ceiling
/// a cross-domain move uses.
const MAX_SUFFIX: usize = 99;

/// What a [`LinkedSource`] finds at a source-relative path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lookup {
    /// A regular file of `len` bytes.
    File {
        /// Its size in bytes.
        len: u64,
    },
    /// Nothing, a folder, or something that cannot be read.
    Missing,
    /// A path that leaves the source: an absolute path, a `..` escape or a
    /// symlink that resolves outside it.
    Outside,
}

/// Where the files the notes link to are read from: a folder on disk or the
/// files of an archive held in memory. Paths are source-relative with forward
/// slashes.
pub trait LinkedSource {
    /// What lies at `rel`.
    fn lookup(&self, rel: &str) -> Lookup;
    /// The lowercase hex sha256 of the file at `rel`.
    fn sha256(&self, rel: &str) -> io::Result<String>;
}

/// A folder on disk. A path is resolved through every symlink, and one that
/// lands outside `root`, or is absolute, is [`Lookup::Outside`].
#[derive(Debug, Clone)]
pub struct DirSource {
    /// The folder the notes were imported from.
    pub root: PathBuf,
}

impl DirSource {
    /// The canonical path of the regular file at `rel`, or the lookup that
    /// says why there is none.
    fn locate(&self, rel: &str) -> Result<(PathBuf, u64), Lookup> {
        let path = Path::new(rel);
        if rel.is_empty() {
            return Err(Lookup::Missing);
        }
        if path.is_absolute()
            || rel.starts_with('/')
            || path
                .components()
                .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
        {
            return Err(Lookup::Outside);
        }
        let root = self.root.canonicalize().map_err(|_| Lookup::Missing)?;
        let file = self
            .root
            .join(path)
            .canonicalize()
            .map_err(|_| Lookup::Missing)?;
        if !file.starts_with(&root) {
            return Err(Lookup::Outside);
        }
        match std::fs::metadata(&file) {
            Ok(meta) if meta.is_file() => Ok((file, meta.len())),
            _ => Err(Lookup::Missing),
        }
    }
}

impl LinkedSource for DirSource {
    fn lookup(&self, rel: &str) -> Lookup {
        match self.locate(rel) {
            Ok((_, len)) => Lookup::File { len },
            Err(lookup) => lookup,
        }
    }

    fn sha256(&self, rel: &str) -> io::Result<String> {
        let (file, _) = self.locate(rel).map_err(|lookup| match lookup {
            Lookup::Outside => io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("{rel} lies outside the source"),
            ),
            _ => io::Error::new(io::ErrorKind::NotFound, format!("{rel} is not a file")),
        })?;
        let mut hasher = Sha256::new();
        let mut reader = std::fs::File::open(file)?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = io::Read::read(&mut reader, &mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(hex(&hasher.finalize()))
    }
}

/// Files held in memory, keyed by their source-relative path: the entries of
/// an uploaded archive.
#[derive(Debug, Clone, Default)]
pub struct MemSource {
    /// Every file by its path.
    pub files: BTreeMap<String, Vec<u8>>,
}

impl LinkedSource for MemSource {
    fn lookup(&self, rel: &str) -> Lookup {
        if rel.starts_with('/') || rel.split('/').any(|s| s == "..") {
            return Lookup::Outside;
        }
        match self.files.get(rel) {
            Some(bytes) => Lookup::File {
                len: bytes.len() as u64,
            },
            None => Lookup::Missing,
        }
    }

    fn sha256(&self, rel: &str) -> io::Result<String> {
        match self.files.get(rel) {
            Some(bytes) => Ok(hex(&Sha256::digest(bytes))),
            None => Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{rel} is not a file"),
            )),
        }
    }
}

/// One imported note: its source-relative path and its whole text. Only the
/// body is rewritten; the frontmatter is kept as it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedNote {
    /// The note's path in the source, forward slashes, ending in `.md`.
    pub rel: String,
    /// The note's text, frontmatter included.
    pub text: String,
}

/// What [`take_linked_files`] settled.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct LinkedOutcome {
    /// One entry per distinct content taken, in the order first linked.
    pub taken: Vec<TakenFile>,
    /// Every link to a local file that was not taken, once per note and target.
    pub not_taken: Vec<NotTaken>,
    /// Every source path that was taken, a deduplicated one included, so the
    /// import does not also copy it as it is.
    pub linked_sources: BTreeSet<String>,
}

/// One file taken into the domain's assets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TakenFile {
    /// The source path its bytes are read from.
    pub source_rel: String,
    /// The asset path it is stored at, `assets/...`.
    pub dest: String,
    /// The lowercase hex sha256 of its bytes.
    pub sha256: String,
    /// Whether the domain already holds these bytes at `dest`, so nothing is
    /// written.
    pub reused: bool,
}

/// One link to a local file that was not taken.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotTaken {
    /// The path of the note that links it.
    pub note: String,
    /// The target as the note names it, decoded, without a `#fragment`.
    pub target: String,
    /// Why it was not taken.
    pub reason: NotTakenReason,
}

/// Why a linked file was not taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotTakenReason {
    /// No file is there, or it is a folder or cannot be read.
    Missing,
    /// The target leaves the source.
    Outside,
    /// The file's extension is not on the attachment allowlist.
    NotAllowed,
    /// The file is larger than an attachment may be.
    TooLarge,
    /// No valid asset path could be made from its name and the note's path.
    BadName,
}

/// Settle the files `notes` link to: rewrite each note's links to the asset
/// path its file takes, and answer what was taken and what was not. `held`
/// answers the sha256 of an asset the domain already holds at a dest, or
/// `None` when the dest is free. Notes are read in slice order, so the first
/// note to link a file decides where it is stored.
pub fn take_linked_files(
    notes: &mut [LinkedNote],
    source: &dyn LinkedSource,
    held: &dyn Fn(&str) -> Option<String>,
) -> LinkedOutcome {
    let mut planner = Planner {
        source,
        held,
        files: HashMap::new(),
        by_sha: HashMap::new(),
        claimed: HashMap::new(),
        outcome: LinkedOutcome::default(),
    };
    for note in notes.iter_mut() {
        let mut dests: HashMap<String, String> = HashMap::new();
        for target in note_targets(&note.text) {
            if let Some(dest) = planner.target(&note.rel, &target) {
                dests.insert(target, dest);
            }
        }
        if dests.is_empty() {
            continue;
        }
        let (text, changed) = rewrite_body_lines(&note.text, BodyGate::Split, &|line| {
            map_targets(line, &|path| dests.get(path).cloned())
        });
        if changed > 0 {
            note.text = text;
        }
    }
    planner.outcome
}

/// What one source file turned out to be, kept so a file linked from several
/// notes is looked up and hashed once.
#[derive(Clone)]
enum Source {
    File { sha256: String, name: String },
    Refused(NotTakenReason),
}

struct Planner<'a> {
    source: &'a dyn LinkedSource,
    held: &'a dyn Fn(&str) -> Option<String>,
    /// Every resolved source path seen, by what it turned out to be.
    files: HashMap<String, Source>,
    /// The dest every content taken was stored at.
    by_sha: HashMap<String, String>,
    /// Every dest this run claimed, by the content it holds.
    claimed: HashMap<String, String>,
    outcome: LinkedOutcome,
}

impl Planner<'_> {
    /// The dest the link `target` of the note at `note` is rewritten to, or
    /// `None` when it is left alone (reported when it names a local file).
    fn target(&mut self, note: &str, target: &str) -> Option<String> {
        if !names_a_file(target) {
            return None;
        }
        match self.settle(note, target) {
            Ok(dest) => Some(dest),
            Err(reason) => {
                let report = NotTaken {
                    note: note.to_string(),
                    target: target.to_string(),
                    reason,
                };
                if !self.outcome.not_taken.contains(&report) {
                    self.outcome.not_taken.push(report);
                }
                None
            }
        }
    }

    fn settle(&mut self, note: &str, target: &str) -> Result<String, NotTakenReason> {
        if target.starts_with('/') {
            return Err(NotTakenReason::Outside);
        }
        let rel = resolve(note, target).ok_or(NotTakenReason::Outside)?;
        let (sha256, name) = match self.inspect(&rel) {
            Source::File { sha256, name } => (sha256, name),
            Source::Refused(reason) => return Err(reason),
        };
        if let Some(dest) = self.by_sha.get(&sha256) {
            let dest = dest.clone();
            self.outcome.linked_sources.insert(rel);
            return Ok(dest);
        }
        let base = base_dest(note, &name, &sha256).ok_or(NotTakenReason::BadName)?;
        let (dest, reused) = self
            .free_dest(&base, &sha256)
            .ok_or(NotTakenReason::BadName)?;
        self.by_sha.insert(sha256.clone(), dest.clone());
        self.claimed.insert(dest.clone(), sha256.clone());
        self.outcome.linked_sources.insert(rel.clone());
        self.outcome.taken.push(TakenFile {
            source_rel: rel,
            dest: dest.clone(),
            sha256,
            reused,
        });
        Ok(dest)
    }

    /// The source file at `rel`, looked up and hashed once.
    fn inspect(&mut self, rel: &str) -> Source {
        if let Some(seen) = self.files.get(rel) {
            return seen.clone();
        }
        let found = self.inspect_uncached(rel);
        self.files.insert(rel.to_string(), found.clone());
        found
    }

    fn inspect_uncached(&self, rel: &str) -> Source {
        let len = match self.source.lookup(rel) {
            Lookup::File { len } => len,
            Lookup::Missing => return Source::Refused(NotTakenReason::Missing),
            Lookup::Outside => return Source::Refused(NotTakenReason::Outside),
        };
        let file_name = rel.rsplit('/').next().unwrap_or(rel);
        if attachment_mime(file_name).is_none() {
            return Source::Refused(NotTakenReason::NotAllowed);
        }
        if len > MAX_ATTACHMENT_BYTES {
            return Source::Refused(NotTakenReason::TooLarge);
        }
        let Some(name) = clean_asset_segment(file_name) else {
            return Source::Refused(NotTakenReason::BadName);
        };
        match self.source.sha256(rel) {
            Ok(sha256) => Source::File { sha256, name },
            Err(_) => Source::Refused(NotTakenReason::Missing),
        }
    }

    /// The first name from `base` on that holds these bytes already or is
    /// free, and whether it is reused. A name the domain holds with other
    /// bytes, or one this run gave other bytes, gets the next suffix.
    fn free_dest(&self, base: &str, sha256: &str) -> Option<(String, bool)> {
        for attempt in 1..=MAX_SUFFIX {
            let candidate = if attempt == 1 {
                base.to_string()
            } else {
                suffixed_asset_path(base, attempt)?
            };
            if self.claimed.contains_key(&candidate) {
                continue;
            }
            match (self.held)(&candidate) {
                Some(held) if held == sha256 => return Some((candidate, true)),
                Some(_) => {}
                None => return Some((candidate, false)),
            }
        }
        None
    }
}

/// The asset path a file named `name` (cleaned) linked from the note at `note`
/// is stored at before any suffix: under the note's own folder, or under a
/// folder named by its hash when that is too long. `None` when a segment of
/// the note's path has nothing keepable.
fn base_dest(note: &str, name: &str, sha256: &str) -> Option<String> {
    // `.md` in any letter case, as the import reads a note.
    let stem = match note.len().checked_sub(3) {
        Some(cut) if note.is_char_boundary(cut) && note[cut..].eq_ignore_ascii_case(".md") => {
            &note[..cut]
        }
        _ => note,
    };
    let folder = stem
        .split('/')
        .map(clean_asset_segment)
        .collect::<Option<Vec<_>>>()?
        .join("/");
    let dest = format!("{ASSETS_PREFIX}{folder}/{name}");
    if validate_asset_path(&dest).is_ok() {
        return Some(dest);
    }
    let dest = format!("{ASSETS_PREFIX}{}/{name}", &sha256[..8]);
    validate_asset_path(&dest).is_ok().then_some(dest)
}

/// Whether a decoded link target names a local file: not empty, no URL
/// scheme, not a note and not already under `assets/`.
fn names_a_file(target: &str) -> bool {
    let plain = target.strip_prefix("./").unwrap_or(target);
    if plain.is_empty() || is_under_assets(plain) {
        return false;
    }
    // `https:`, `mailto:`, `data:`, `crystalline:`: a colon before the first
    // slash opens a scheme. An asset path never holds a colon.
    let head = plain.split('/').next().unwrap_or(plain);
    if head.contains(':') {
        return false;
    }
    let last = plain.rsplit('/').next().unwrap_or(plain);
    !last.to_ascii_lowercase().ends_with(".md")
}

/// Every distinct decoded link target in the body of `text`, in order.
fn note_targets(text: &str) -> Vec<String> {
    let found: RefCell<Vec<String>> = RefCell::new(Vec::new());
    rewrite_body_lines(text, BodyGate::Split, &|line| {
        map_targets(line, &|path| {
            let mut found = found.borrow_mut();
            if !found.iter().any(|p| p == path) {
                found.push(path.to_string());
            }
            None
        });
        (String::new(), 0)
    });
    found.into_inner()
}

/// One body line with every link target outside inline code put through
/// `map`, which is handed the decoded path and answers the new one or `None`
/// to keep it. A reference definition line has its one target mapped; any
/// other line has every inline link and image mapped. A mapped target keeps
/// its `#fragment` and whatever follows it.
fn map_targets(line: &str, map: &dyn Fn(&str) -> Option<String>) -> (String, usize) {
    if let Some((start, end, raw)) = reference_definition(line) {
        let (path, fragment) = decode_target(raw);
        return match map(&path) {
            Some(dest) => (
                format!(
                    "{}{}{}",
                    &line[..start],
                    written(dest, fragment),
                    &line[end..]
                ),
                1,
            ),
            None => (line.to_string(), 0),
        };
    }
    if !line.contains("](") {
        return (line.to_string(), 0);
    }
    let spans = code_spans(line);
    let in_code = |at: usize| spans.iter().any(|(s, e)| (*s..*e).contains(&at));
    let mut out = String::with_capacity(line.len());
    let mut changed = 0;
    let mut cursor = 0;
    while let Some(found) = line[cursor..].find("](") {
        let open = cursor + found + 2;
        out.push_str(&line[cursor..open]);
        cursor = open;
        let Some(dest) = read_destination(line, open) else {
            continue;
        };
        let replacement = if in_code(open - 2) {
            None
        } else {
            map(&dest.path)
        };
        match replacement {
            Some(target) => {
                out.push_str(&written(target, dest.fragment));
                out.push_str(dest.rest);
                changed += 1;
            }
            None => out.push_str(&line[open..dest.close]),
        }
        cursor = dest.close;
    }
    out.push_str(&line[cursor..]);
    (out, changed)
}

/// A dest as a link target, with the `#fragment` the link carried.
fn written(mut dest: String, fragment: Option<&str>) -> String {
    if let Some(fragment) = fragment {
        dest.push('#');
        dest.push_str(fragment);
    }
    escape_link_url(&dest)
}

/// A reference definition (`[label]: target "title"`, up to three spaces of
/// indent): the byte range of its target as written, angle brackets
/// included, and the target inside them. A footnote (`[^1]: text`) is not one,
/// and neither is a line where more than a title follows the target: as
/// CommonMark reads it, `[Note]: remember the pump` is prose.
fn reference_definition(line: &str) -> Option<(usize, usize, &str)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = line[indent..].strip_prefix('[')?;
    let label_end = rest.find(']')?;
    let label = &rest[..label_end];
    if label.trim().is_empty() || label.starts_with('^') || label.contains('[') {
        return None;
    }
    let after = rest[label_end + 1..].strip_prefix(':')?;
    let start = line.len() - after.trim_start_matches([' ', '\t']).len();
    let tail = &line[start..];
    let (end, target) = if let Some(inner) = tail.strip_prefix('<') {
        let gt = inner.find('>')?;
        (start + gt + 2, &inner[..gt])
    } else {
        let len = tail.find(ends_destination).unwrap_or(tail.len());
        if len == 0 {
            return None;
        }
        (start + len, &tail[..len])
    };
    only_a_title(&line[end..]).then_some((start, end, target))
}

/// Whether `rest`, what follows a reference definition's target, is nothing
/// or one title: `"..."`, `'...'` or `(...)`, after at least one space or
/// tab, with nothing but spaces and tabs after it. Only ASCII spaces and tabs
/// separate here, as only they end the target (`ends_destination`).
fn only_a_title(rest: &str) -> bool {
    let trimmed = rest.trim_matches([' ', '\t']);
    if trimmed.is_empty() {
        return true;
    }
    if !rest.starts_with([' ', '\t']) {
        return false;
    }
    let close = match trimmed.chars().next() {
        Some('"') => '"',
        Some('\'') => '\'',
        Some('(') => ')',
        _ => return false,
    };
    trimmed.len() >= 2 && trimmed.ends_with(close) && !trimmed[1..trimmed.len() - 1].contains(close)
}

/// Lowercase hex of a digest.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reference_definition_is_read_in_both_forms() {
        assert_eq!(
            reference_definition("[d]: <a b.png> \"T\""),
            Some((5, 14, "a b.png"))
        );
        assert_eq!(
            reference_definition("   [d]:   x.png"),
            Some((10, 15, "x.png"))
        );
        assert_eq!(reference_definition("[^1]: See the report"), None);
        assert_eq!(reference_definition("    [d]: x.png"), None);
        assert_eq!(reference_definition("[d]:"), None);
        assert_eq!(reference_definition("[d] x.png"), None);
        assert_eq!(
            reference_definition("[d]: x.png 'T'"),
            Some((5, 10, "x.png"))
        );
        assert_eq!(
            reference_definition("[d]: x.png (T)  "),
            Some((5, 10, "x.png"))
        );
    }

    /// The target of a definition ends at an ASCII space or control
    /// character, as an inline destination does: a U+3000 or U+00A0 inside
    /// a file name is part of it.
    #[test]
    fn a_definition_target_ends_only_at_an_ascii_space_or_control() {
        assert_eq!(
            reference_definition("[d]: a\u{3000}b.md"),
            Some((5, 13, "a\u{3000}b.md"))
        );
        assert_eq!(
            reference_definition("[d]: a\u{a0}b.md \"T\""),
            Some((5, 12, "a\u{a0}b.md"))
        );
        assert_eq!(reference_definition("[d]: a.md\t'T'"), Some((5, 9, "a.md")));
        // Unicode space before the target is no separator either: it opens
        // the target.
        assert_eq!(
            reference_definition("[d]:\u{3000}a.md"),
            Some((4, 11, "\u{3000}a.md"))
        );
    }

    /// A line that reads like a definition but carries more than a title
    /// after the target is prose, as CommonMark reads it.
    #[test]
    fn prose_after_a_label_is_no_reference_definition() {
        assert_eq!(reference_definition("[Note]: remember the pump"), None);
        assert_eq!(reference_definition("[d]: x.png \"T\" more"), None);
        assert_eq!(reference_definition("[d]: <a b.png> then"), None);
    }

    /// `x.Md` is a note to the import, so its pictures go under `assets/x/`.
    #[test]
    fn a_notes_extension_is_dropped_in_any_case() {
        let sha = "0123456789abcdef";
        assert_eq!(
            base_dest("notes/x.Md", "p.png", sha).as_deref(),
            Some("assets/notes/x/p.png")
        );
        assert_eq!(
            base_dest("y.MD", "p.png", sha).as_deref(),
            Some("assets/y/p.png")
        );
    }

    #[test]
    fn urls_notes_and_assets_name_no_file() {
        for target in [
            "https://example.test/a.png",
            "mailto:a@example.test",
            "data:image/png;base64,AAAA",
            "crystalline://ops/x",
            "other.md",
            "Pumps/P-12.MD",
            "assets/held.png",
            "./assets/held.png",
            "",
        ] {
            assert!(!names_a_file(target), "{target}");
        }
        for target in ["pic.png", "../pic.png", "sub/a:b.png", "blob.bin", "folder"] {
            assert!(names_a_file(target), "{target}");
        }
    }

    #[test]
    fn a_fragment_and_a_title_survive_a_rewrite() {
        let (out, n) = map_targets("![x](<a b.png#right> \"T\") and `[y](a b.png)`", &|p| {
            (p == "a b.png").then(|| "assets/n/a-b.png".to_string())
        });
        assert_eq!(n, 1);
        assert_eq!(out, "![x](assets/n/a-b.png#right \"T\") and `[y](a b.png)`");
    }
}
