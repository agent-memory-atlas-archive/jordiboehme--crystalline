//! Folder names that are close to each other: the matcher behind the write
//! receipt's `close_folders` hint and the `V112` sweep rule.
//!
//! An ingest that files one topic under `projects/planview-work` and minutes
//! later under `projects/planview` has split one topic over two folders, and a
//! `build_context` glob on either one misses half of it. Nothing here refuses
//! or changes a write: the matcher only names the sibling folders whose names
//! read as the same topic, and the caller decides.
//!
//! Pure string math over domain-relative folder paths, no store and no I/O,
//! so the engine's write path and the index crate's sweep ask the same
//! question and get the same answer.

use std::collections::BTreeMap;

/// How many close folders a write receipt names at most.
pub const CLOSE_FOLDER_LIMIT: usize = 3;

/// The fixed sentence a write receipt carries beside `close_folders`.
pub const FOLDER_GUIDANCE: &str = "This write started a new folder next to existing folders with a close name. If it is the same topic, move the engram there with move_engram and keep one folder; if the topics differ, leave it.";

/// One existing folder whose name is close to the folder a write started.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct CloseFolder {
    /// The domain-relative folder path, the form `move_engram` takes.
    pub folder: String,
    /// How many engrams the folder holds, its subfolders included.
    pub engrams: usize,
}

/// Why two folder names read as close, ordered closest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Closeness {
    /// The names are equal once folded (`Planview` and `planview`,
    /// `plan_view` and `plan-view`).
    Equal,
    /// One name's words are a leading or trailing run of the other's
    /// (`planview` and `planview-work`).
    Words,
    /// A small Damerau-Levenshtein distance between the folded names
    /// (`note` and `notes`, `recieve` and `receive`), carried so a smaller
    /// distance sorts first.
    Distance(usize),
}

impl Closeness {
    /// A short phrase for a finding's evidence column.
    pub fn describe(self) -> String {
        match self {
            Closeness::Equal => "equal apart from case and separators".to_string(),
            Closeness::Words => "one name is the other plus a word".to_string(),
            Closeness::Distance(d) => format!("{d} edit apart"),
        }
    }
}

/// The last segment of a domain-relative folder path.
pub fn folder_name(folder: &str) -> &str {
    folder.rsplit('/').next().unwrap_or(folder)
}

/// The parent of a domain-relative folder path, `""` for a top-level folder.
pub fn folder_parent(folder: &str) -> &str {
    folder
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("")
}

/// A folder name in the form names compare in: lowercase, with `_`, `.`,
/// spaces and runs of hyphens read as one `-`, and no hyphen at either end.
///
/// ```
/// use crystalline_core::folders::fold_name;
///
/// assert_eq!(fold_name("Plan_View"), "plan-view");
/// assert_eq!(fold_name("plan view."), "plan-view");
/// ```
pub fn fold_name(name: &str) -> String {
    words(name).join("-")
}

/// The hyphen-separated words of a folded name.
fn words(name: &str) -> Vec<String> {
    name.to_lowercase()
        .split(['-', '_', '.', ' '])
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Whether two folder names read as one topic, and why. Only the last segment
/// of each path is compared; the caller decides which folders are siblings.
/// The same name twice is the same folder, never a close one.
///
/// ```
/// use crystalline_core::folders::{Closeness, closeness};
///
/// assert_eq!(closeness("projects/planview", "projects/planview-work"), Some(Closeness::Words));
/// assert_eq!(closeness("project", "projection"), None);
/// ```
pub fn closeness(a: &str, b: &str) -> Option<Closeness> {
    let (a, b) = (folder_name(a), folder_name(b));
    if a == b {
        return None;
    }
    let (wa, wb) = (words(a), words(b));
    let (fa, fb) = (wa.join("-"), wb.join("-"));
    if fa.is_empty() || fb.is_empty() {
        return None;
    }
    if fa == fb {
        return Some(Closeness::Equal);
    }
    let (short, long, short_folded) = if wa.len() <= wb.len() {
        (&wa, &wb, &fa)
    } else {
        (&wb, &wa, &fb)
    };
    if short.len() < long.len()
        && short_folded.chars().count() >= 3
        && (long.starts_with(short) || long.ends_with(short))
    {
        return Some(Closeness::Words);
    }
    let shorter = fa.chars().count().min(fb.chars().count());
    // A numbered series (`2025` and `2026`, `week-01` and `week-02`,
    // `v0.21` and `v0.22`) differs only in its digits, and that is a series
    // rather than a typo, so the distance rule never speaks about it.
    let without_digits = |s: &str| {
        s.chars()
            .filter(|c| !c.is_ascii_digit())
            .collect::<String>()
    };
    if shorter < 4 || without_digits(&fa) == without_digits(&fb) {
        return None;
    }
    let allowed = if shorter >= 8 { 2 } else { 1 };
    let distance = osa_distance(&fa, &fb);
    (distance <= allowed).then_some(Closeness::Distance(distance))
}

/// The existing folders whose names are close to `new_folder`, closest first
/// (equal once folded, then by words, then by distance), ties broken by more
/// engrams and then by path, at most [`CLOSE_FOLDER_LIMIT`].
///
/// `existing` is the caller's list of candidate folders with their engram
/// counts, which should be the siblings of `new_folder`; an entry naming
/// `new_folder` itself is skipped.
pub fn close_folders(new_folder: &str, existing: &[(String, usize)]) -> Vec<CloseFolder> {
    let mut found: Vec<(Closeness, &str, usize)> = existing
        .iter()
        .filter(|(folder, _)| folder != new_folder)
        .filter_map(|(folder, count)| {
            closeness(new_folder, folder).map(|c| (c, folder.as_str(), *count))
        })
        .collect();
    found.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| b.2.cmp(&a.2))
            .then_with(|| a.1.cmp(b.1))
    });
    found
        .into_iter()
        .take(CLOSE_FOLDER_LIMIT)
        .map(|(_, folder, engrams)| CloseFolder {
            folder: folder.to_string(),
            engrams,
        })
        .collect()
}

/// Every folder the given domain-relative engram paths sit in, with how many
/// engrams each holds, its subfolders included. Root-level files add to no
/// folder, and the reserved files (`index.md`, `log.md`) are not engrams.
pub fn folder_counts<'a>(paths: impl IntoIterator<Item = &'a str>) -> BTreeMap<String, usize> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for path in paths {
        if crate::is_reserved_path(path) {
            continue;
        }
        let Some((folder, _)) = path.rsplit_once('/') else {
            continue;
        };
        let mut end = 0;
        for segment in folder.split('/') {
            end += segment.len();
            *counts.entry(folder[..end].to_string()).or_default() += 1;
            end += 1;
        }
    }
    counts
}

/// The first folder level an engram at `path` created: the topmost folder
/// above it that holds no engram but this one, by `counts` taken with the
/// engram included. `None` when every folder above it held something before.
pub fn created_folder(path: &str, counts: &BTreeMap<String, usize>) -> Option<String> {
    let (folder, _) = path.rsplit_once('/')?;
    let mut end = 0;
    for segment in folder.split('/') {
        end += segment.len();
        let level = &folder[..end];
        if counts.get(level).copied() == Some(1) {
            return Some(level.to_string());
        }
        end += 1;
    }
    None
}

/// The folders directly under `parent` (`""` for the domain root) with their
/// counts, `folder` itself left out.
pub fn sibling_folders(folder: &str, counts: &BTreeMap<String, usize>) -> Vec<(String, usize)> {
    let parent = folder_parent(folder);
    counts
        .iter()
        .filter(|(f, _)| f.as_str() != folder && folder_parent(f) == parent)
        .map(|(f, n)| (f.clone(), *n))
        .collect()
}

/// The optimal string alignment distance: insertions, deletions,
/// substitutions and transpositions of two adjacent characters, each costing
/// one, with no substring edited twice.
fn osa_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (n, m) = (a.len(), b.len());
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut best = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(d[i - 2][j - 2] + 1);
            }
            d[i][j] = best;
        }
    }
    d[n][m]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &str, b: &str) -> bool {
        closeness(a, b).is_some()
    }

    #[test]
    fn folded_equal_names_are_close() {
        assert_eq!(closeness("Planview", "planview"), Some(Closeness::Equal));
        assert_eq!(closeness("plan_view", "plan-view"), Some(Closeness::Equal));
        assert_eq!(closeness("plan view", "plan.view"), Some(Closeness::Equal));
        // Short names match only this way.
        assert_eq!(closeness("ai", "AI"), Some(Closeness::Equal));
    }

    #[test]
    fn a_leading_or_trailing_word_run_is_close() {
        assert_eq!(
            closeness("planview", "planview-work"),
            Some(Closeness::Words)
        );
        assert_eq!(
            closeness("planview", "work-planview"),
            Some(Closeness::Words)
        );
        assert_eq!(
            closeness("planview-work", "planview"),
            Some(Closeness::Words)
        );
        assert_eq!(
            closeness("crystal", "crystal-notes"),
            Some(Closeness::Words)
        );
        // A run in the middle is not a leading or trailing one.
        assert!(!close("plan", "big-plan-view"));
        // The shorter name needs three characters.
        assert!(!close("ai", "ai-tools"));
    }

    #[test]
    fn a_small_edit_distance_is_close() {
        assert_eq!(closeness("note", "notes"), Some(Closeness::Distance(1)));
        assert_eq!(
            closeness("meetings", "meeting"),
            Some(Closeness::Distance(1))
        );
        assert_eq!(
            closeness("recieve", "receive"),
            Some(Closeness::Distance(1))
        );
        assert_eq!(closeness("notes", "nodes"), Some(Closeness::Distance(1)));
        // Eight characters and up allow two edits.
        assert_eq!(
            closeness("architecture", "architektur"),
            Some(Closeness::Distance(2))
        );
        assert_eq!(
            closeness("decisions", "decisoin"),
            Some(Closeness::Distance(2))
        );
    }

    #[test]
    fn the_shorter_name_picks_the_allowed_distance() {
        // `meeting` is seven characters, so one edit is the most allowed even
        // though the other name is longer.
        assert!(!close("meeting", "meetingxx"));
        // Eight on both sides allows two.
        assert!(close("meetings", "meetingxx"));
    }

    #[test]
    fn names_that_are_not_close() {
        assert!(!close("ai", "email"));
        assert!(!close("project", "projection"));
        assert!(!close("crystal", "crystalline-notes"));
        assert!(!close("2025", "2026"));
        // Any numbered series, not only all-digit names.
        assert!(!close("week-01", "week-02"));
        assert!(!close("sprint-1", "sprint-2"));
        assert!(!close("v0.21", "v0.22"));
        assert!(!close("2025-q1", "2026-q1"));
        assert!(!close("a", "b"));
        assert!(!close("abc", "abd"));
        // The same folder is not close to itself.
        assert!(!close("planview", "planview"));
    }

    #[test]
    fn only_the_last_segment_is_compared() {
        assert_eq!(
            closeness("projects/planview", "projects/planview-work"),
            Some(Closeness::Words)
        );
        assert!(!close("planview/x", "planview/y"));
    }

    #[test]
    fn close_folders_ranks_equal_then_words_then_distance() {
        let existing = vec![
            ("p/planvew".to_string(), 9),
            ("p/planview-work".to_string(), 2),
            ("p/PlanView".to_string(), 1),
            ("p/other".to_string(), 50),
        ];
        let found = close_folders("p/planview", &existing);
        let names: Vec<&str> = found.iter().map(|c| c.folder.as_str()).collect();
        assert_eq!(names, vec!["p/PlanView", "p/planview-work", "p/planvew"]);
        assert_eq!(found[1].engrams, 2);
    }

    #[test]
    fn close_folders_breaks_ties_by_count_then_name_and_caps_at_three() {
        let existing = vec![
            ("notex".to_string(), 1),
            ("notez".to_string(), 1),
            ("notey".to_string(), 5),
            ("noted".to_string(), 1),
        ];
        let found = close_folders("notes", &existing);
        let names: Vec<&str> = found.iter().map(|c| c.folder.as_str()).collect();
        assert_eq!(names, vec!["notey", "noted", "notex"]);
    }

    #[test]
    fn close_folders_is_empty_without_candidates_or_matches() {
        assert!(close_folders("planview", &[]).is_empty());
        assert!(close_folders("planview", &[("billing".to_string(), 3)]).is_empty());
        assert!(close_folders("planview", &[("planview".to_string(), 3)]).is_empty());
    }

    #[test]
    fn folder_counts_are_recursive_and_skip_reserved_and_root_files() {
        let counts = folder_counts([
            "root.md",
            "a/one.md",
            "a/b/two.md",
            "a/b/three.md",
            "a/index.md",
            "c/log.md",
        ]);
        assert_eq!(counts.get("a"), Some(&3));
        assert_eq!(counts.get("a/b"), Some(&2));
        assert_eq!(counts.get("c"), None);
        assert_eq!(counts.len(), 2);
    }

    #[test]
    fn created_folder_is_the_topmost_level_holding_only_the_new_engram() {
        let counts = folder_counts(["a/one.md", "a/b/c/new.md"]);
        assert_eq!(created_folder("a/b/c/new.md", &counts), Some("a/b".into()));
        let counts = folder_counts(["x/new.md"]);
        assert_eq!(created_folder("x/new.md", &counts), Some("x".into()));
        let counts = folder_counts(["x/old.md", "x/new.md"]);
        assert_eq!(created_folder("x/new.md", &counts), None);
        assert_eq!(created_folder("root.md", &counts), None);
    }

    #[test]
    fn siblings_are_the_folders_under_the_same_parent() {
        let counts = folder_counts([
            "p/planview/a.md",
            "p/planview-work/b.md",
            "p/planview/deep/c.md",
            "q/planview/d.md",
        ]);
        let mut sib = sibling_folders("p/planview-work", &counts);
        sib.sort();
        assert_eq!(sib, vec![("p/planview".to_string(), 2)]);
        let top = sibling_folders("q", &counts);
        assert_eq!(top, vec![("p".to_string(), 3)]);
    }

    #[test]
    fn osa_counts_a_transposition_as_one_edit() {
        assert_eq!(osa_distance("recieve", "receive"), 1);
        assert_eq!(osa_distance("project", "projection"), 3);
        assert_eq!(osa_distance("", "abc"), 3);
    }
}
