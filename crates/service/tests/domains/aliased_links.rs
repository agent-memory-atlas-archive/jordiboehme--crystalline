//! A wikilink with display text (`[[target|text]]`), end to end: the sweep's
//! repair quotes the bracket text exactly as the file holds it, so following
//! the fix replaces real text and keeps the author's words.

use std::sync::Arc;

use crystalline_core::config::{DomainEntry, GlobalConfig};
use crystalline_index::TursoStore;
use crystalline_service::Engine;
use crystalline_service::Scope;
use crystalline_service::params::EvolveParams;
use tokio::sync::Mutex;

const TODAY: &str = "2026-08-02";

fn note(title: &str, permalink: &str, body: &str) -> String {
    format!(
        "---\ntype: engram\ntitle: {title}\npermalink: {permalink}\ntags:\n  - ops\nstatus: stable\nrecorded_at: 2026-07-01\n---\n\n# {title}\n\n{body}\n"
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_v102_repair_of_an_aliased_link_quotes_the_file_exactly() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("ops");
    let linker = note(
        "Linker",
        "linker",
        "Before a release, read [[Incident Runbok|the runbook]] once.\n\n- relates_to [[Incident Runbook]]",
    );
    let files = [
        (
            "MANIFEST.md",
            "---\ntype: manifest\ntitle: ops\npermalink: manifest\ntags:\n  - manifest\nstatus: stable\nrecorded_at: 2026-07-25\n---\n\n# ops\n\n## Scope\n\n- Operations\n\n## When to Use\n\n- Route here for operations\n".to_string(),
        ),
        (
            "runbook.md",
            note("Incident Runbook", "runbook", "Steps for the person on call."),
        ),
        ("linker.md", linker.clone()),
    ];
    for (rel, body) in files {
        let abs = dir.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(&abs, body).unwrap();
    }
    let mut cfg = GlobalConfig::default();
    cfg.domains
        .insert("ops".to_string(), DomainEntry::file(dir));
    let config_path = tmp.path().join("config.yaml");
    crystalline_core::config::save_yaml(&config_path, &cfg).unwrap();
    let store = TursoStore::open_in_memory().await.unwrap();
    let engine = Arc::new(
        Engine::new(Arc::new(Mutex::new(store)), cfg, None, Some(config_path))
            .with_state_dir(tmp.path().join("state")),
    );
    engine.sync(None).await.unwrap();

    let v = engine
        .evolve_detect(
            &EvolveParams {
                today: Some(TODAY.to_string()),
                ..EvolveParams::default()
            },
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    let queue = v["queue"].as_array().unwrap();
    let broken: Vec<_> = queue.iter().filter(|r| r["rule"] == "V102").collect();
    assert_eq!(broken.len(), 1, "{v}");
    let fix = broken[0]["fix"].as_str().unwrap();
    assert_eq!(
        fix, "[[Incident Runbok|the runbook]] -> [[Incident Runbook|the runbook]]",
        "{v}"
    );
    let (left, _) = fix.split_once(" -> ").unwrap();
    assert!(linker.contains(left), "{left} is in the file");
}
