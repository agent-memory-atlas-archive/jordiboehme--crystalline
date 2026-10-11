//! The CLI write verbs against a read-only domain: refused with the sentence,
//! nothing written. Embedded engine (no daemon), the way the tags tests run.

use std::path::{Path, PathBuf};

use assert_cmd::Command;
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;

const SENTENCE: &str =
    "'eng' is read-only; its owner switches read_only off in the domain policies";

const ALPHA: &str = "---\ntype: engram\ntitle: Alpha\npermalink: alpha\ntags:\n  - eng\nstatus: current\nrecorded_at: 2026-01-01\n---\n\n# Alpha\n\nBody.\n\n## Part\n\nA part to split off.\n";

/// A command isolated under `home`, with no `--config` and no `--db`: the
/// domain rename runs only against this machine's own index and
/// configuration, so every verb here uses the default paths of one home.
fn bin(home: &Path) -> Command {
    let mut cmd = crate::common::crystalline();
    crate::common::isolate(&mut cmd, home);
    cmd
}

/// `domain init` + one engram + `domain add`, then `read_only: on` in the MANIFEST.
fn seed(work: &Path) -> PathBuf {
    let domain_dir = work.join("kb");
    bin(work)
        .args(["domain", "init"])
        .arg(&domain_dir)
        .args(["--name", "eng"])
        .assert()
        .success();
    std::fs::write(domain_dir.join("alpha.md"), ALPHA).unwrap();
    bin(work)
        .args(["domain", "add", "eng"])
        .arg(&domain_dir)
        .assert()
        .success();
    let manifest = domain_dir.join("MANIFEST.md");
    let text = std::fs::read_to_string(&manifest).unwrap();
    std::fs::write(
        &manifest,
        text.replacen("\n---\n", "\nread_only: on\n---\n", 1),
    )
    .unwrap();
    domain_dir
}

#[test]
fn every_cli_write_verb_refuses_a_read_only_domain() {
    let work = tempfile::tempdir().unwrap();
    let dir = seed(work.path());
    let before = std::fs::read_to_string(dir.join("alpha.md")).unwrap();
    let manifest = std::fs::read_to_string(dir.join("MANIFEST.md")).unwrap();
    let verbs: [&[&str]; 6] = [
        &["write", "eng", "Beta", "--content", "Beta body."],
        &["edit", "alpha", "eng", "append", "--content", "More."],
        &["move", "alpha", "eng", "moved"],
        &["split", "alpha", "eng", "Part", "--section", "Part"],
        &["delete", "alpha", "eng", "--force"],
        &["domain", "rename", "eng", "attic"],
    ];
    for args in verbs {
        bin(work.path())
            .args(args)
            .assert()
            .failure()
            .stderr(contains(SENTENCE));
    }
    assert_eq!(
        std::fs::read_to_string(dir.join("alpha.md")).unwrap(),
        before
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("MANIFEST.md")).unwrap(),
        manifest
    );
    assert!(!dir.join("beta.md").exists());
}

/// A machine-local rename writes nothing into the domain, so it still works
/// on a read-only domain (decision D6).
#[test]
fn a_local_rename_still_works_on_a_read_only_domain() {
    let work = tempfile::tempdir().unwrap();
    let dir = seed(work.path());
    let manifest = std::fs::read_to_string(dir.join("MANIFEST.md")).unwrap();
    bin(work.path())
        .args(["domain", "rename", "eng", "attic", "--local"])
        .assert()
        .success();
    assert_eq!(
        std::fs::read_to_string(dir.join("MANIFEST.md")).unwrap(),
        manifest
    );
}

#[test]
fn a_cli_read_says_read_only() {
    let work = tempfile::tempdir().unwrap();
    seed(work.path());
    bin(work.path())
        .args(["read", "alpha", "--domain", "eng", "--json"])
        .assert()
        .success()
        .stdout(contains("\"read_only\": true").or(contains("\"read_only\":true")));
}

/// `domain add` writes the domain's name back into a MANIFEST that declares
/// none. A read-only folder keeps its MANIFEST exactly as the team wrote it.
#[test]
fn domain_add_leaves_a_read_only_manifest_byte_identical() {
    let work = tempfile::tempdir().unwrap();
    let dir = work.path().join("kb");
    std::fs::create_dir_all(&dir).unwrap();
    let manifest = "---\ntype: manifest\ntitle: kb\npermalink: manifest\ntags:\n  - manifest\nstatus: current\nrecorded_at: 2026-01-01\nread_only: on\n---\n\n# kb\n\n## Scope\n\n- x\n\n## When to Use\n\n- y\n";
    std::fs::write(dir.join("MANIFEST.md"), manifest).unwrap();
    bin(work.path())
        .args(["domain", "add", "eng"])
        .arg(&dir)
        .assert()
        .success();
    assert_eq!(
        std::fs::read_to_string(dir.join("MANIFEST.md")).unwrap(),
        manifest
    );
}
