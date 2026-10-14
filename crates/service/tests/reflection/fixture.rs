//! A file domain `eng` on a temporary root, an in-memory index, a scratch
//! state directory, and helpers to write engrams and reflections.

// Later tasks use the helpers; until then some are unused.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;

use crystalline_core::config::{DomainEntry, GlobalConfig};
use crystalline_index::TursoStore;
use crystalline_service::Engine;
use crystalline_service::params::{DeleteParams, MoveParams, WriteParams};
use tokio::sync::Mutex;

pub struct Fx {
    pub tmp: tempfile::TempDir,
    pub engine: Arc<Engine>,
    /// The `eng` domain root.
    pub root: PathBuf,
}

/// A MANIFEST for `eng` with extra frontmatter lines (each ending in `\n`).
pub fn manifest(extra: &str) -> String {
    format!(
        "---\ntype: manifest\ntitle: eng\npermalink: manifest\ntags:\n  - manifest\nstatus: stable\nrecorded_at: 2026-01-01\n{extra}---\n\n# eng\n\n## Scope\n\n- Everything about eng\n\n## When to Use\n\n- Route here for eng questions\n"
    )
}

/// An engram file.
pub fn engram(title: &str, permalink: &str, body: &str) -> String {
    format!(
        "---\ntype: engram\ntitle: {title}\npermalink: {permalink}\ntags:\n  - eng\nstatus: stable\nrecorded_at: 2026-09-01\n---\n\n# {title}\n\n{body}\n"
    )
}

/// A reflection page: a section with an id line, the page marker that keeps
/// the file the Reflection's rather than an engram waiting to move out.
pub fn page(title: &str) -> String {
    format!("# {title}\n\nFor people.\n\n## Part\n<!-- r:aaaa1111 -->\n\nText.\n")
}

pub fn write_params(title: &str, folder: Option<&str>, content: &str) -> WriteParams {
    WriteParams {
        domain: "eng".into(),
        title: title.into(),
        content: content.into(),
        folder: folder.map(str::to_string),
        engram_type: None,
        tags: Vec::new(),
        status: None,
        metadata: None,
        overwrite: false,
        model: None,
        share_link: None,
    }
}

pub fn move_params(identifier: &str, destination: &str) -> MoveParams {
    MoveParams {
        identifier: identifier.into(),
        domain: "eng".into(),
        destination: destination.into(),
        destination_domain: None,
        permalink: None,
        update_links: None,
    }
}

pub fn delete_params(identifier: &str) -> DeleteParams {
    DeleteParams {
        identifier: identifier.into(),
        domain: "eng".into(),
        expected_checksum: None,
    }
}

/// `files` are domain-relative paths and contents; a `MANIFEST.md` among
/// them replaces the default (Reflection off).
pub async fn fixture(files: &[(&str, &str)]) -> Fx {
    fixture_with(files, |_, _| {}).await
}

pub async fn fixture_with(
    files: &[(&str, &str)],
    tweak: impl FnOnce(&mut GlobalConfig, &std::path::Path),
) -> Fx {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().to_path_buf();
    let root = base.join("eng");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("MANIFEST.md"), manifest("")).unwrap();
    for (rel, body) in files {
        let abs = root.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(abs, body).unwrap();
    }
    let mut cfg = GlobalConfig::default();
    cfg.domains
        .insert("eng".to_string(), DomainEntry::file(root.clone()));
    tweak(&mut cfg, &base);
    let config_path = base.join("config.yaml");
    crystalline_core::config::save_yaml(&config_path, &cfg).unwrap();
    let store = TursoStore::open_in_memory().await.unwrap();
    let engine = Arc::new(
        Engine::new(Arc::new(Mutex::new(store)), cfg, None, Some(config_path))
            .with_state_dir(base.join("state"))
            // Origin state (base snapshots, the backup state) lands in the
            // temp dir, never in the developer's own state directory.
            .with_origins_dir(base.join("origins")),
    );
    engine.sync(None).await.unwrap();
    Fx { tmp, engine, root }
}
