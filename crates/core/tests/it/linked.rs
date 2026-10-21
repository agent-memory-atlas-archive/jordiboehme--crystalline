//! The linked-file planner over the fixture tree in `tests/fixtures/linked`:
//! which files imported notes link to are taken, where each one lands under
//! `assets/` and how the links are rewritten.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crystalline_core::find_asset_refs;
use crystalline_core::linked::{
    DirSource, LinkedNote, LinkedOutcome, LinkedSource, Lookup, MemSource, NotTaken,
    NotTakenReason, TakenFile, take_linked_files,
};

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/linked")
}

/// Every `.md` file under `root`, in path order, as the import hands them over.
fn notes_under(root: &Path) -> Vec<LinkedNote> {
    let mut notes: Vec<LinkedNote> = walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "md"))
        .map(|e| {
            let rel = e
                .path()
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            LinkedNote {
                rel,
                text: std::fs::read_to_string(e.path()).unwrap(),
            }
        })
        .collect();
    notes.sort_by(|a, b| a.rel.cmp(&b.rel));
    notes
}

/// Plan the fixture tree with `held` answering the domain's assets.
fn plan(held: &dyn Fn(&str) -> Option<String>) -> (Vec<LinkedNote>, LinkedOutcome) {
    let root = fixture_root();
    let mut notes = notes_under(&root);
    let outcome = take_linked_files(&mut notes, &DirSource { root }, held);
    (notes, outcome)
}

fn nothing_held(_: &str) -> Option<String> {
    None
}

fn note<'a>(notes: &'a [LinkedNote], rel: &str) -> &'a str {
    &notes.iter().find(|n| n.rel == rel).unwrap().text
}

fn taken_from<'a>(outcome: &'a LinkedOutcome, source_rel: &str) -> &'a TakenFile {
    outcome
        .taken
        .iter()
        .find(|t| t.source_rel == source_rel)
        .unwrap_or_else(|| panic!("{source_rel} not taken: {:?}", outcome.taken))
}

#[test]
fn a_linked_picture_moves_under_the_notes_asset_folder() {
    let (notes, outcome) = plan(&nothing_held);
    let text = note(&notes, "report.pdf.md");
    assert!(
        text.contains("![p3](assets/report.pdf/page-3.png)"),
        "{text}"
    );
    // The title after the target is kept as written.
    assert!(
        text.contains("[a](assets/report.pdf/attachment-1.pdf \"First attachment\")"),
        "{text}"
    );
    // The frontmatter is not touched.
    assert!(text.starts_with("---\ntype: engram\nstatus: current\n---\n"));
    let page = taken_from(&outcome, "report.pdf.assets/page-3.png");
    assert_eq!(page.dest, "assets/report.pdf/page-3.png");
    assert!(!page.reused);
    assert_eq!(page.sha256.len(), 64);
    assert_eq!(
        find_asset_refs(text),
        [
            "assets/report.pdf/page-3.png",
            "assets/report.pdf/attachment-1.pdf"
        ]
    );
    assert!(
        outcome
            .linked_sources
            .contains("report.pdf.assets/page-3.png")
    );
}

#[test]
fn escaped_and_angle_bracket_targets_name_the_same_file() {
    let (notes, outcome) = plan(&nothing_held);
    let source = "Q3 report (final).pdf.assets/page-1.png";
    let taken: Vec<&TakenFile> = outcome
        .taken
        .iter()
        .filter(|t| t.source_rel == source)
        .collect();
    assert_eq!(taken.len(), 1, "{:?}", outcome.taken);
    assert_eq!(taken[0].dest, "assets/q3-report-final.pdf/page-1.png");
    let text = note(&notes, "Q3 report (final).pdf.md");
    assert_eq!(
        text,
        "# Q3 report\n\n![p](assets/q3-report-final.pdf/page-1.png)\n\nAgain: ![p](assets/q3-report-final.pdf/page-1.png)\n"
    );
}

#[test]
fn a_backslash_escaped_name_is_read_unescaped() {
    let (notes, outcome) = plan(&nothing_held);
    assert_eq!(
        taken_from(&outcome, "R&D.png").dest,
        "assets/notes/r-d/r-d.png"
    );
    assert!(note(&notes, "notes/r&d.md").contains("![x](assets/notes/r-d/r-d.png)"));
}

#[test]
fn an_encoded_percent_names_the_literal_file() {
    let (notes, outcome) = plan(&nothing_held);
    assert_eq!(
        taken_from(&outcome, "100%.pdf").dest,
        "assets/100-25/100.pdf"
    );
    assert!(note(&notes, "100%25.md").contains("[d](assets/100-25/100.pdf)"));
}

#[test]
fn the_same_bytes_are_stored_once() {
    let (notes, outcome) = plan(&nothing_held);
    let twins: Vec<&TakenFile> = outcome
        .taken
        .iter()
        .filter(|t| t.dest.starts_with("assets/twin-"))
        .collect();
    assert_eq!(twins.len(), 1, "{:?}", outcome.taken);
    assert_eq!(twins[0].dest, "assets/twin-a/same.png");
    assert_eq!(twins[0].source_rel, "same.png");
    for rel in ["twin-a.md", "twin-b.md"] {
        assert_eq!(
            find_asset_refs(note(&notes, rel)),
            ["assets/twin-a/same.png"],
            "{rel}"
        );
    }
    // Both source files were taken, so neither is copied as it is.
    assert!(outcome.linked_sources.contains("same.png"));
    assert!(outcome.linked_sources.contains("sub/same-copy.png"));
}

#[test]
fn every_target_not_taken_is_reported_with_its_reason() {
    let tree = tempfile::tempdir().unwrap();
    let fixture = fixture_root();
    for entry in walkdir::WalkDir::new(&fixture) {
        let entry = entry.unwrap();
        let to = tree
            .path()
            .join(entry.path().strip_prefix(&fixture).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&to).unwrap();
        } else {
            std::fs::copy(entry.path(), &to).unwrap();
        }
    }
    let big = vec![7u8; (crystalline_core::MAX_ATTACHMENT_BYTES + 1) as usize];
    std::fs::write(tree.path().join("big.png"), big).unwrap();

    let mut notes = notes_under(tree.path());
    let outcome = take_linked_files(
        &mut notes,
        &DirSource {
            root: tree.path().to_path_buf(),
        },
        &nothing_held,
    );
    let reason = |note: &str, target: &str| {
        outcome
            .not_taken
            .iter()
            .find(|n| n.note == note && n.target == target)
            .map(|n| n.reason)
    };
    assert_eq!(
        reason("notes/gone.md", "missing.png"),
        Some(NotTakenReason::Missing)
    );
    assert_eq!(
        reason("notes/up.md", "../../outside.png"),
        Some(NotTakenReason::Outside)
    );
    assert_eq!(
        reason("blob.md", "blob.bin"),
        Some(NotTakenReason::NotAllowed)
    );
    assert_eq!(reason("big.md", "big.png"), Some(NotTakenReason::TooLarge));
    assert_eq!(outcome.not_taken.len(), 4, "{:?}", outcome.not_taken);
    // A link that was not taken is left exactly as written.
    assert!(note(&notes, "notes/gone.md").contains("![x](missing.png)"));
    assert!(note(&notes, "blob.md").contains("[b](blob.bin)"));
    assert!(!outcome.linked_sources.contains("blob.bin"));
    assert!(!outcome.linked_sources.contains("big.png"));
    let json = serde_json::to_value(&outcome.not_taken[0]).unwrap();
    assert!(json["reason"].is_string());
    assert_eq!(
        serde_json::to_value(NotTakenReason::NotAllowed).unwrap(),
        "not_allowed"
    );
}

#[test]
fn code_is_left_alone_and_table_cells_are_not() {
    let (notes, outcome) = plan(&nothing_held);
    let text = note(&notes, "code.md");
    assert!(text.contains("`![c](code-span.png)`"), "{text}");
    assert!(text.contains("```\n![f](fenced.png)\n```"), "{text}");
    assert!(
        text.contains("| ![t](assets/code/table.png) | in a cell |"),
        "{text}"
    );
    assert_eq!(
        taken_from(&outcome, "table.png").dest,
        "assets/code/table.png"
    );
    for untouched in ["code-span.png", "fenced.png"] {
        assert!(!outcome.linked_sources.contains(untouched), "{untouched}");
        assert!(
            outcome.not_taken.iter().all(|n| n.target != untouched),
            "{untouched}"
        );
    }
}

#[test]
fn a_reference_definition_is_rewritten_and_a_footnote_is_not_a_link() {
    let (notes, outcome) = plan(&nothing_held);
    assert_eq!(
        taken_from(&outcome, "ref pic.png").dest,
        "assets/refs/ref-pic.png"
    );
    let text = note(&notes, "refs.md");
    assert!(
        text.contains("[d]: assets/refs/ref-pic.png \"Diagram\"\n"),
        "{text}"
    );
    assert!(text.contains("[^1]: See the report\n"), "{text}");
    assert!(outcome.not_taken.iter().all(|n| n.note != "refs.md"));
}

#[test]
fn a_held_asset_with_the_same_bytes_is_reused_and_a_different_one_gets_a_suffix() {
    let source = DirSource {
        root: fixture_root(),
    };
    let sha = source.sha256("report.pdf.assets/page-3.png").unwrap();

    let same = sha.clone();
    let (notes, outcome) =
        plan(&move |dest: &str| (dest == "assets/report.pdf/page-3.png").then(|| same.clone()));
    let page = taken_from(&outcome, "report.pdf.assets/page-3.png");
    assert_eq!(page.dest, "assets/report.pdf/page-3.png");
    assert!(page.reused);
    assert!(note(&notes, "report.pdf.md").contains("(assets/report.pdf/page-3.png)"));

    let other = "0".repeat(64);
    let (notes, outcome) =
        plan(&move |dest: &str| (dest == "assets/report.pdf/page-3.png").then(|| other.clone()));
    let page = taken_from(&outcome, "report.pdf.assets/page-3.png");
    assert_eq!(page.dest, "assets/report.pdf/page-3-2.png");
    assert!(!page.reused);
    assert!(note(&notes, "report.pdf.md").contains("(assets/report.pdf/page-3-2.png)"));
}

#[test]
fn note_links_and_urls_are_not_files() {
    let (notes, outcome) = plan(&nothing_held);
    let root = fixture_root();
    for rel in ["overview.md", "pumps/p-12.md"] {
        assert_eq!(
            note(&notes, rel),
            std::fs::read_to_string(root.join(rel)).unwrap(),
            "{rel} is unchanged"
        );
        assert!(outcome.not_taken.iter().all(|n| n.note != rel), "{rel}");
    }
    assert!(
        outcome
            .linked_sources
            .iter()
            .all(|s| !s.ends_with(".md") && !s.starts_with("assets/"))
    );
}

#[test]
fn a_dest_over_the_path_limit_falls_back_to_a_hash_folder() {
    let rel = format!(
        "{}/{}/{}/note.md",
        "a".repeat(96),
        "b".repeat(96),
        "c".repeat(98)
    );
    assert_eq!(rel.len(), 300);
    let pic = format!(
        "{}/{}/{}/Pic.png",
        "a".repeat(96),
        "b".repeat(96),
        "c".repeat(98)
    );
    let source = MemSource {
        files: BTreeMap::from([(pic, b"a picture".to_vec())]),
    };
    let mut notes = vec![LinkedNote {
        rel,
        text: "![p](Pic.png)\n".to_string(),
    }];
    let outcome = take_linked_files(&mut notes, &source, &nothing_held);
    let sha = &outcome.taken[0].sha256;
    let dest = format!("assets/{}/pic.png", &sha[..8]);
    assert_eq!(outcome.taken[0].dest, dest);
    assert_eq!(notes[0].text, format!("![p]({dest})\n"));
}

#[test]
fn a_note_name_with_nothing_keepable_is_a_bad_name() {
    let source = MemSource {
        files: BTreeMap::from([("pic.png".to_string(), b"bytes".to_vec())]),
    };
    let mut notes = vec![LinkedNote {
        rel: "###.md".to_string(),
        text: "![p](pic.png)\n".to_string(),
    }];
    let outcome = take_linked_files(&mut notes, &source, &nothing_held);
    assert_eq!(
        outcome.not_taken,
        [NotTaken {
            note: "###.md".to_string(),
            target: "pic.png".to_string(),
            reason: NotTakenReason::BadName,
        }]
    );
    assert_eq!(notes[0].text, "![p](pic.png)\n");
}

#[test]
fn two_files_claiming_one_dest_in_one_run_get_a_suffix() {
    let source = MemSource {
        files: BTreeMap::from([
            ("a/pic.png".to_string(), b"one".to_vec()),
            ("b/Pic.png".to_string(), b"two".to_vec()),
        ]),
    };
    let mut notes = vec![LinkedNote {
        rel: "note.md".to_string(),
        text: "![a](a/pic.png) ![b](b/Pic.png)\n".to_string(),
    }];
    let outcome = take_linked_files(&mut notes, &source, &nothing_held);
    let dests: Vec<&str> = outcome.taken.iter().map(|t| t.dest.as_str()).collect();
    assert_eq!(dests, ["assets/note/pic.png", "assets/note/pic-2.png"]);
    assert_eq!(
        notes[0].text,
        "![a](assets/note/pic.png) ![b](assets/note/pic-2.png)\n"
    );
}

#[test]
fn the_dir_source_refuses_what_lies_outside_its_root() {
    let source = DirSource {
        root: fixture_root().join("notes"),
    };
    assert_eq!(source.lookup("../R&D.png"), Lookup::Outside);
    assert_eq!(source.lookup("/etc/hosts"), Lookup::Outside);
    assert_eq!(source.lookup("missing.png"), Lookup::Missing);
    // A folder is not a file.
    let root = DirSource {
        root: fixture_root(),
    };
    assert_eq!(root.lookup("sub"), Lookup::Missing);
    assert!(matches!(root.lookup("same.png"), Lookup::File { len: 11 }));
    assert!(source.sha256("../R&D.png").is_err());
}

#[cfg(unix)]
#[test]
fn the_dir_source_refuses_a_symlink_out_of_its_root() {
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.png"), b"secret").unwrap();
    let root = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("secret.png"),
        root.path().join("link.png"),
    )
    .unwrap();
    let source = DirSource {
        root: root.path().to_path_buf(),
    };
    assert_eq!(source.lookup("link.png"), Lookup::Outside);
    assert!(source.sha256("link.png").is_err());
}
