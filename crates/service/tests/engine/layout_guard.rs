//! Source guards over the walks of a domain's folder.
//!
//! A source scan rather than a behavioural test, for the reason the overlay
//! census guards are one (`crates/service/tests/overlay/overlay_domains.rs`,
//! `call_sites`): the failure is a walk added later that filters by hand,
//! which no request can be written to provoke in advance. A walk that does
//! not ask `DomainLayout` is how a new kind of document leaks into the
//! engram side.

use std::path::{Path, PathBuf};

/// The source roots of every crate whose code walks a domain.
fn roots() -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    [
        "../core/src",
        "../index/src",
        "../identity/src",
        "../engine/src",
        "../rest/src",
        "../remote/src",
        "src",
        "../cli/src",
    ]
    .iter()
    .map(|dir| manifest.join(dir))
    .collect()
}

/// The name a line declares a function under, if it declares one.
fn declared_fn(line: &str) -> Option<&str> {
    let rest = line.trim_start();
    let rest = rest
        .strip_prefix("pub(crate) ")
        .or_else(|| rest.strip_prefix("pub(super) "))
        .or_else(|| rest.strip_prefix("pub "))
        .unwrap_or(rest);
    let rest = rest.strip_prefix("async ").unwrap_or(rest);
    let rest = rest.strip_prefix("fn ")?;
    let end = rest.find(|c: char| !c.is_alphanumeric() && c != '_')?;
    Some(&rest[..end])
}

/// Every function of every source file as `(crate-relative file, fn name,
/// body text)`, the body running from its declaration to the next
/// declaration in the file. Coarse on purpose: a nested `fn` ends the
/// enclosing body early, which only ever makes the guard stricter.
pub(crate) fn fn_bodies() -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    for root in roots() {
        let crate_dir = root.parent().unwrap().to_path_buf();
        for entry in walkdir::WalkDir::new(&root).into_iter().flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let file = entry
                .path()
                .strip_prefix(crate_dir.parent().unwrap())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let text = std::fs::read_to_string(entry.path()).unwrap();
            let lines: Vec<&str> = text.lines().collect();
            let starts: Vec<(usize, &str)> = lines
                .iter()
                .enumerate()
                .filter_map(|(i, l)| declared_fn(l).map(|n| (i, n)))
                .collect();
            for (k, (start, name)) in starts.iter().enumerate() {
                let end = starts.get(k + 1).map(|(i, _)| *i).unwrap_or(lines.len());
                out.push((
                    file.clone(),
                    name.to_string(),
                    lines[*start..end].join("\n"),
                ));
            }
        }
    }
    out
}

/// Every function that walks a folder with `WalkDir` either asks
/// `DomainLayout` what each path is, or is listed here with the reason it
/// walks something that is not a domain's own folder.
#[test]
fn every_domain_walk_asks_the_layout() {
    let allowed: &[(&str, &str)] = &[
        // Walks a folder that is about to be imported, before it is a domain.
        ("core/src/import.rs", "collect_entries"),
        // A `#[cfg(test)]` unit test of the walk error a missing folder gives.
        (
            "remote/src/changes.rs",
            "the_walk_keeps_the_os_code_the_4395_check_reads",
        ),
    ];
    let mut strays: Vec<(String, String)> = fn_bodies()
        .into_iter()
        .filter(|(_, _, body)| body.contains("WalkDir::new("))
        .filter(|(_, _, body)| !body.contains("DomainLayout"))
        .filter(|(file, name, _)| !allowed.contains(&(file.as_str(), name.as_str())))
        .map(|(file, name, _)| (file, name))
        .collect();
    strays.sort();
    assert!(
        strays.is_empty(),
        "these walk a folder and filter by hand; ask crystalline_core::DomainLayout what each path is, \
         or list the walk with the reason it is not a domain's folder: {strays:?}"
    );
    // The two walks that classify without a directory walk.
    for (file, name) in [
        ("index/src/sync.rs", "scan_paths"),
        ("service/src/daemon.rs", "classify_in_root"),
    ] {
        let body = fn_bodies()
            .into_iter()
            .find(|(f, n, _)| f == file && n == name)
            .unwrap_or_else(|| {
                panic!("{file}::{name} is gone; point this guard at what replaced it")
            })
            .2;
        assert!(
            body.contains("DomainLayout"),
            "{file}::{name} classifies paths without DomainLayout"
        );
    }
    for (file, name) in allowed {
        assert!(
            fn_bodies()
                .iter()
                .any(|(f, n, b)| f == file && n == name && b.contains("WalkDir::new(")),
            "{file}::{name} is allow-listed but no longer walks; drop it"
        );
    }
}

/// The Reflection's rows and variants stay in the modules that serve the
/// Reflection: an engram reader that
/// named one would be the one missed filter that leaks a reflection into the
/// engram side. Each needle may appear only in the files listed for it; a
/// task that adds a caller adds its file here in the same commit.
#[test]
fn reflection_variants_stay_in_their_modules() {
    let allowed: &[(&str, &[&str])] = &[(
        "list_reflections(",
        &[
            "index/src/store.rs",
            "index/src/turso/mod.rs",
            "index/src/postgres/mod.rs",
            "index/src/sync.rs",
        ],
    )];
    let mut strays: Vec<(String, String, &str)> = Vec::new();
    for (file, name, body) in fn_bodies() {
        for (needle, files) in allowed {
            if body.contains(needle) && !files.contains(&file.as_str()) {
                strays.push((file.clone(), name.clone(), needle));
            }
        }
    }
    strays.sort();
    strays.dedup();
    assert!(
        strays.is_empty(),
        "these name a Reflection row or variant outside the modules that serve the Reflection: {strays:?}"
    );
}
