//! Kept texts: what a co-editing room held when its last save could not land.
//!
//! When the last person leaves a room and the final save is refused or ends
//! in a conflict, nothing would ever save that text again. The server keeps
//! it as a file in its state folder instead of dropping it:
//!
//! ```text
//! <state>/kept/<domain>/<engram|reflection>/<path>.<YYYYMMDDTHHMMSSZ>.md
//! ```
//!
//! `<path>` is the engram's file path in its domain, or the page's path
//! inside `reflections/`. A second text kept under the same name in the same
//! second gets `-2`, `-3` and so on after the time. A room over somebody's
//! review draft keeps its text under `<domain>/draft/<owner>/` instead of
//! `<domain>/`, because a draft is private to its owner.
//!
//! A kept text is the last copy of somebody's work, so nothing here deletes
//! one on its own: [`remove`] runs only when a person asks for it. This
//! module is the one place that knows the layout; the room writes through
//! [`write`](fn@write), and `crystalline doctor`, `crystalline kept` and the JSON API
//! read through [`scan`].

use std::io::Write as _;
use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// The folder in the state directory that holds kept texts.
pub const KEPT_DIR: &str = "kept";

/// The time format of a kept file's name, in UTC.
const STAMP: &str = "%Y%m%dT%H%M%SZ";

/// How many hex characters of the path's hash make an id.
const ID_LEN: usize = 12;

/// The folder under a domain's folder that holds drafts' kept texts, one
/// folder per owner.
const DRAFT_DIR: &str = "draft";

/// Which kind of room a text was kept from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeptKind {
    /// An engram's room; the path is the engram's file in its domain.
    Engram,
    /// A Reflection page's room; the path is inside `reflections/`.
    Reflection,
}

impl KeptKind {
    /// The folder name under the domain's folder, and the wire word.
    pub fn as_str(self) -> &'static str {
        match self {
            KeptKind::Engram => "engram",
            KeptKind::Reflection => "reflection",
        }
    }

    fn from_folder(name: &str) -> Option<KeptKind> {
        match name {
            "engram" => Some(KeptKind::Engram),
            "reflection" => Some(KeptKind::Reflection),
            _ => None,
        }
    }
}

/// One kept text, as [`scan`] finds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KeptText {
    /// A short, stable id: the start of the hash of the file's path inside
    /// the kept folder. It never changes while the file is there.
    pub id: String,
    /// The domain the room belonged to.
    pub domain: String,
    /// Whose review draft the room was over, or `None` for the domain's own
    /// text. A draft's kept text is its owner's alone.
    pub owner: Option<String>,
    /// The kind of room.
    pub kind: KeptKind,
    /// The engram's file path in its domain, or the page's path inside
    /// `reflections/`.
    pub path: String,
    /// When the text was kept, from the file name.
    pub kept_at: DateTime<Utc>,
    /// The file's size in bytes.
    pub bytes: u64,
    /// The file on disk. Never sent over the JSON API.
    #[serde(skip)]
    pub file: PathBuf,
}

/// Keep `text` for `domain`'s `path` under `root` (the kept folder), named
/// for `at`; with `owner`, in that owner's draft folder. Never overwrites: a
/// name that is taken gets the next free `-N`. Returns the file written.
pub fn write(
    root: &Path,
    domain: &str,
    owner: Option<&str>,
    kind: KeptKind,
    path: &str,
    at: DateTime<Utc>,
    text: &str,
) -> std::io::Result<PathBuf> {
    let mut base = root.join(domain);
    if let Some(owner) = owner {
        if owner.is_empty() || matches!(owner, "." | "..") || owner.contains(['/', '\\', ':']) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("'{owner}' is not one folder name"),
            ));
        }
        base = base.join(DRAFT_DIR).join(owner);
    }
    let base = base.join(kind.as_str()).join(path);
    let stamp = at.format(STAMP).to_string();
    let name = base
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let parent = base.parent().unwrap_or(root).to_path_buf();
    // The text goes to a temporary name first, which `parse_name` never
    // takes for a kept text, so a listing never shows a file half written.
    // A `remove` of the folder's last text may prune the folder between its
    // creation and the open: then the folder is made again, a few times.
    let temp = parent.join(format!(".{name}.{stamp}.{}.keeping", std::process::id()));
    let mut attempt = 0;
    loop {
        std::fs::create_dir_all(&parent)?;
        #[cfg(test)]
        tests::before_open(&parent);
        match write_new(&temp, text) {
            Ok(()) => break,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound && attempt < OPEN_TRIES => {
                attempt += 1;
            }
            Err(err) => return Err(err),
        }
    }
    let placed = place(&temp, &base, &name, &stamp, text);
    let _ = std::fs::remove_file(&temp);
    placed
}

/// How many times [`write`] makes a pruned folder again before it gives up.
const OPEN_TRIES: u32 = 5;

/// Write `text` to a new file at `file`; fails when something is there.
fn write_new(file: &Path, text: &str) -> std::io::Result<()> {
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file)?;
    out.write_all(text.as_bytes())?;
    out.sync_all()
}

/// Give the complete file at `temp` its kept name next to `base`, never over
/// another file: a hard link fails on a taken name, so the next `-N` is
/// tried. A file system without hard links gets the text written straight
/// to the free name instead.
fn place(
    temp: &Path,
    base: &Path,
    name: &str,
    stamp: &str,
    text: &str,
) -> std::io::Result<PathBuf> {
    for n in 1u32.. {
        let file = base.with_file_name(match n {
            1 => format!("{name}.{stamp}.md"),
            n => format!("{name}.{stamp}-{n}.md"),
        });
        match std::fs::hard_link(temp, &file) {
            Ok(()) => return Ok(file),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => match write_new(&file, text) {
                Ok(()) => return Ok(file),
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            },
        }
    }
    unreachable!("a free name is found before the counter runs out")
}

/// Every kept text under `root`, oldest first (then by domain, kind and
/// path). A missing folder holds none. A file whose name does not follow the
/// layout, a symbolic link and anything that cannot be read are skipped: the
/// scan never fails, so a report that lists kept texts always runs.
pub fn scan(root: &Path) -> Vec<KeptText> {
    let mut found = Vec::new();
    for domain in dir_entries(root) {
        if !domain.is_dir {
            continue;
        }
        for entry in dir_entries(&domain.path) {
            if entry.is_dir && entry.name == DRAFT_DIR {
                for owner in dir_entries(&entry.path) {
                    if owner.is_dir {
                        scan_kinds(&domain.name, Some(&owner.name), &owner.path, &mut found);
                    }
                }
            }
        }
        scan_kinds(&domain.name, None, &domain.path, &mut found);
    }
    found.sort_by(|a, b| {
        (a.kept_at, &a.domain, &a.owner, a.kind, &a.path, &a.file)
            .cmp(&(b.kept_at, &b.domain, &b.owner, b.kind, &b.path, &b.file))
    });
    found
}

/// The kept text with `id` under `root`. An id is only ever matched against
/// what [`scan`] finds, never joined onto a path.
pub fn find(root: &Path, id: &str) -> Option<KeptText> {
    scan(root).into_iter().find(|kept| kept.id == id)
}

/// The text of `kept`.
pub fn read(kept: &KeptText) -> std::io::Result<String> {
    std::fs::read_to_string(&kept.file)
}

/// Delete `kept`'s file, then every folder it leaves empty up to (not
/// including) `root`. Only ever on a person's request.
pub fn remove(root: &Path, kept: &KeptText) -> std::io::Result<()> {
    std::fs::remove_file(&kept.file)?;
    let mut dir = kept.file.parent();
    while let Some(d) = dir {
        if d == root || !d.starts_with(root) {
            break;
        }
        // Fails on a folder that still holds something, which ends the walk.
        if std::fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
    Ok(())
}

/// The two kind folders under `dir` (a domain's folder, or one owner's
/// draft folder), walked into `found`.
fn scan_kinds(domain: &str, owner: Option<&str>, dir: &Path, found: &mut Vec<KeptText>) {
    for kind_dir in dir_entries(dir) {
        let Some(kind) = KeptKind::from_folder(&kind_dir.name) else {
            continue;
        };
        if kind_dir.is_dir {
            let place = Place {
                domain,
                owner,
                kind,
            };
            walk(&place, &kind_dir.path, "", found);
        }
    }
}

/// Which kind folder a walk is in.
struct Place<'a> {
    domain: &'a str,
    owner: Option<&'a str>,
    kind: KeptKind,
}

impl Place<'_> {
    /// The file at `rel` inside this kind folder, as a path inside the kept
    /// folder, `/`-separated.
    fn rel(&self, rel: &str) -> String {
        match self.owner {
            Some(owner) => format!(
                "{}/{DRAFT_DIR}/{owner}/{}/{rel}",
                self.domain,
                self.kind.as_str()
            ),
            None => format!("{}/{}/{rel}", self.domain, self.kind.as_str()),
        }
    }
}

/// Every kept file under `dir`, the folder `rel` inside `place`, into
/// `found`.
fn walk(place: &Place<'_>, dir: &Path, rel: &str, found: &mut Vec<KeptText>) {
    for entry in dir_entries(dir) {
        let child = if rel.is_empty() {
            entry.name.clone()
        } else {
            format!("{rel}/{}", entry.name)
        };
        if entry.is_dir {
            walk(place, &entry.path, &child, found);
            continue;
        }
        if !entry.is_file {
            continue;
        }
        let Some((name, kept_at)) = parse_name(&entry.name) else {
            continue;
        };
        let path = if rel.is_empty() {
            name.to_string()
        } else {
            format!("{rel}/{name}")
        };
        found.push(KeptText {
            id: id_of(&place.rel(&child)),
            domain: place.domain.to_string(),
            owner: place.owner.map(str::to_string),
            kind: place.kind,
            path,
            kept_at,
            bytes: entry.len,
            file: entry.path,
        });
    }
}

/// `<name>.<stamp>.md` or `<name>.<stamp>-<n>.md`: the original file name
/// and the time.
fn parse_name(file: &str) -> Option<(&str, DateTime<Utc>)> {
    let stem = file.strip_suffix(".md")?;
    let (name, tail) = stem.rsplit_once('.')?;
    if name.is_empty() {
        return None;
    }
    let (stamp, counter) = match tail.split_once('-') {
        Some((stamp, n)) => (stamp, Some(n)),
        None => (tail, None),
    };
    if let Some(n) = counter
        && (n.is_empty() || !n.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let at = NaiveDateTime::parse_from_str(stamp, STAMP).ok()?;
    Some((name, at.and_utc()))
}

/// The id of the file at `full`, its path inside the kept folder: the
/// start of its SHA-256.
fn id_of(full: &str) -> String {
    let digest = Sha256::digest(full.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    hex[..ID_LEN].to_string()
}

struct Entry {
    name: String,
    path: PathBuf,
    is_dir: bool,
    is_file: bool,
    len: u64,
}

/// The entries of `dir` with UTF-8 names, by name, without following
/// symbolic links. Empty for a folder that cannot be read.
fn dir_entries(dir: &Path) -> Vec<Entry> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<Entry> = read
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let meta = std::fs::symlink_metadata(e.path()).ok()?;
            Some(Entry {
                name,
                path: e.path(),
                is_dir: meta.is_dir(),
                is_file: meta.is_file(),
                len: meta.len(),
            })
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::cell::Cell;

    thread_local! {
        /// How many more times [`before_open`] removes the folder it is given.
        static PRUNES: Cell<u32> = const { Cell::new(0) };
    }

    /// The test seam in [`write`]: right after the folder is made, remove it
    /// again while [`PRUNES`] says so, as a concurrent `remove` would.
    pub(super) fn before_open(dir: &Path) {
        PRUNES.with(|left| {
            if left.get() > 0 {
                left.set(left.get() - 1);
                std::fs::remove_dir(dir).unwrap();
            }
        });
    }

    /// A drop that prunes the folder between its creation and the open does
    /// not lose the text: the folder is made again and the text kept. One
    /// prune more than the tries is an error, never a silent loss. No
    /// temporary file stays behind.
    #[test]
    fn a_folder_pruned_under_a_keep_is_made_again() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        PRUNES.with(|left| left.set(2));
        let file = write(root, "eng", None, KeptKind::Engram, "a.md", at(8), "kept").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "kept");
        assert_eq!(
            std::fs::read_dir(file.parent().unwrap()).unwrap().count(),
            1
        );
        PRUNES.with(|left| left.set(OPEN_TRIES + 1));
        let err = write(root, "ops", None, KeptKind::Engram, "a.md", at(8), "x").unwrap_err();
        PRUNES.with(|left| left.set(0));
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    }

    /// The temporary name a keep writes first is never listed.
    #[test]
    fn a_text_being_written_is_not_listed() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("eng/engram");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(".a.md.20261015T080000Z.42.keeping"), "half").unwrap();
        assert!(scan(dir.path()).is_empty());
    }

    fn at(h: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 15, h, 0, 0).unwrap()
    }

    /// Two refusals that map to one kept name both keep their text: the
    /// second never overwrites the first.
    #[test]
    fn a_second_kept_text_under_the_same_name_does_not_overwrite_the_first() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let kind = KeptKind::Reflection;
        let first = write(root, "eng", None, kind, "guides/a.md", at(8), "first").unwrap();
        let second = write(root, "eng", None, kind, "guides/a.md", at(8), "second").unwrap();
        assert_ne!(first, second);
        assert_eq!(
            first,
            root.join("eng/reflection/guides/a.md.20261015T080000Z.md")
        );
        assert_eq!(second.file_name().unwrap(), "a.md.20261015T080000Z-2.md");
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "second");
    }

    /// What `write` keeps, `scan` lists: domain, kind, the original path,
    /// the time from the name and the size; oldest first.
    #[test]
    fn scan_lists_what_write_kept() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(
            root,
            "eng",
            None,
            KeptKind::Engram,
            "runbooks/deploy.md",
            at(9),
            "abc",
        )
        .unwrap();
        write(
            root,
            "eng",
            None,
            KeptKind::Reflection,
            "a.md",
            at(8),
            "hello",
        )
        .unwrap();
        write(root, "ops", None, KeptKind::Reflection, "a.md", at(8), "x").unwrap();
        write(
            root,
            "eng",
            None,
            KeptKind::Reflection,
            "a.md",
            at(8),
            "again",
        )
        .unwrap();
        let found = scan(root);
        let rows: Vec<(&str, KeptKind, &str, DateTime<Utc>, u64)> = found
            .iter()
            .map(|k| {
                (
                    k.domain.as_str(),
                    k.kind,
                    k.path.as_str(),
                    k.kept_at,
                    k.bytes,
                )
            })
            .collect();
        assert_eq!(
            rows,
            vec![
                ("eng", KeptKind::Reflection, "a.md", at(8), 5),
                ("eng", KeptKind::Reflection, "a.md", at(8), 5),
                ("ops", KeptKind::Reflection, "a.md", at(8), 1),
                ("eng", KeptKind::Engram, "runbooks/deploy.md", at(9), 3),
            ]
        );
        assert_eq!(read(&found[3]).unwrap(), "abc");
    }

    /// Every file has its own id, and the id stays the same between scans.
    #[test]
    fn ids_are_short_distinct_and_stable() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(
            root,
            "eng",
            None,
            KeptKind::Reflection,
            "guides/a.md",
            at(8),
            "1",
        )
        .unwrap();
        write(
            root,
            "eng",
            None,
            KeptKind::Reflection,
            "ops/a.md",
            at(8),
            "2",
        )
        .unwrap();
        write(
            root,
            "ops",
            None,
            KeptKind::Reflection,
            "guides/a.md",
            at(8),
            "3",
        )
        .unwrap();
        write(
            root,
            "eng",
            None,
            KeptKind::Engram,
            "guides/a.md",
            at(8),
            "4",
        )
        .unwrap();
        let first: Vec<String> = scan(root).into_iter().map(|k| k.id).collect();
        let again: Vec<String> = scan(root).into_iter().map(|k| k.id).collect();
        assert_eq!(first, again);
        let unique: std::collections::HashSet<&String> = first.iter().collect();
        assert_eq!(unique.len(), 4, "{first:?}");
        assert!(
            first
                .iter()
                .all(|id| id.len() == ID_LEN && id.bytes().all(|b| b.is_ascii_hexdigit()))
        );
        let one = &first[1];
        assert_eq!(find(root, one).unwrap().id, *one);
        assert!(find(root, "000000000000").is_none());
    }

    /// A draft room's text is kept in its owner's folder and listed with the
    /// owner; the same path in the domain's own text is another entry with
    /// another id. An owner that is not one folder name is refused.
    #[test]
    fn a_drafts_text_is_kept_under_its_owner() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let kind = KeptKind::Engram;
        let file = write(root, "eng", Some("ada"), kind, "a.md", at(8), "draft").unwrap();
        assert_eq!(
            file,
            root.join("eng/draft/ada/engram/a.md.20261015T080000Z.md")
        );
        write(root, "eng", None, kind, "a.md", at(8), "folder").unwrap();
        let found = scan(root);
        let rows: Vec<(Option<&str>, &str, u64)> = found
            .iter()
            .map(|k| (k.owner.as_deref(), k.path.as_str(), k.bytes))
            .collect();
        assert_eq!(rows, vec![(None, "a.md", 6), (Some("ada"), "a.md", 5)]);
        assert_ne!(found[0].id, found[1].id);
        for owner in ["", ".", "..", "a/b", "a\\b", "c:"] {
            assert!(
                write(root, "eng", Some(owner), kind, "a.md", at(8), "x").is_err(),
                "{owner}"
            );
        }
    }

    /// Names outside the layout, unknown kind folders and loose files are
    /// not kept texts.
    #[test]
    fn scan_skips_what_is_not_a_kept_text() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let folder = root.join("eng/reflection");
        std::fs::create_dir_all(&folder).unwrap();
        for name in [
            "a.md",
            "a.md.20261015T080000Z.txt",
            "a.md.2026-10-15.md",
            ".20261015T080000Z.md",
            "a.md.20261015T080000Z-.md",
            "a.md.20261015T080000Z-x.md",
        ] {
            std::fs::write(folder.join(name), "x").unwrap();
        }
        std::fs::create_dir_all(root.join("eng/other")).unwrap();
        std::fs::write(root.join("eng/other/a.md.20261015T080000Z.md"), "x").unwrap();
        std::fs::write(root.join("loose.md.20261015T080000Z.md"), "x").unwrap();
        assert!(scan(root).is_empty(), "{:?}", scan(root));
        assert!(scan(&root.join("missing")).is_empty());
    }

    /// `remove` deletes the one file and the folders it leaves empty, never
    /// the kept folder itself and never a neighbour.
    #[test]
    fn remove_deletes_one_file_and_its_empty_folders() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(
            root,
            "eng",
            None,
            KeptKind::Reflection,
            "guides/deep/a.md",
            at(8),
            "1",
        )
        .unwrap();
        write(root, "eng", None, KeptKind::Reflection, "b.md", at(9), "2").unwrap();
        let found = scan(root);
        remove(root, &found[0]).unwrap();
        assert!(!root.join("eng/reflection/guides").exists());
        assert!(root.join("eng/reflection").is_dir());
        let left = scan(root);
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].path, "b.md");
        remove(root, &left[0]).unwrap();
        assert!(root.is_dir(), "the kept folder stays");
        assert!(!root.join("eng").exists());
    }
}
