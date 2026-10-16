//! One writer per file domain on a shared database (F9): only the instance
//! that holds a file domain's host lock writes its engrams and attachments.
//! Another live host refuses a write and names itself; a lock whose holder
//! went silent is taken over by a write, never by a read.
//!
//! Postgres only: a Turso database belongs to one instance.

#![cfg(feature = "postgres")]

use std::sync::Arc;

use crystalline_core::config::{DomainEntry, GlobalConfig};
use crystalline_index::Store;
use crystalline_service::Scope;
use crystalline_service::engine::Engine;
use crystalline_service::params::*;
use serde_json::{Value, json};
use tokio::sync::Mutex;

fn manifest() -> String {
    "---\ntype: manifest\ntitle: Eng\npermalink: manifest\ntags:\n  - manifest\nstatus: current\nrecorded_at: 2026-01-01\n---\n\n# Eng\n\n## Scope\n\n- covers things\n\n## When to Use\n\n- when routing\n".to_string()
}

fn engram(title: &str, permalink: &str, body: &str) -> String {
    format!(
        "---\ntype: engram\ntitle: {title}\npermalink: {permalink}\ntags:\n  - t\nstatus: current\nrecorded_at: 2026-01-01\n---\n\n# {title}\n\n{body}\n"
    )
}

/// Two instances, `inst-a` and `inst-b`, each with its own copy of the file
/// domain `eng` on its own disk, over one Postgres schema. `inst-a` synced
/// first and hosts `eng`.
struct Pair {
    alpha: Arc<Engine>,
    beta: Arc<Engine>,
    b_root: std::path::PathBuf,
    _tmp: tempfile::TempDir,
    scratch: crystalline_index::ScratchSchema,
}

async fn store_on(scratch: &crystalline_index::ScratchSchema) -> Arc<Mutex<dyn Store>> {
    let pg = crystalline_index::PostgresStore::open_in_schema(scratch.url(), scratch.name())
        .await
        .expect("open the postgres test schema");
    Arc::new(Mutex::new(pg))
}

async fn instance(
    scratch: &crystalline_index::ScratchSchema,
    base: &std::path::Path,
    id: &str,
) -> (Arc<Engine>, std::path::PathBuf) {
    let root = base.join(id).join("eng");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("MANIFEST.md"), manifest()).unwrap();
    std::fs::write(
        root.join("alpha.md"),
        engram("Alpha", "alpha", "the body about turbines"),
    )
    .unwrap();
    let mut cfg = GlobalConfig::default();
    cfg.domains
        .insert("eng".to_string(), DomainEntry::file(root.clone()));
    let config = base.join(id).join("config.yaml");
    crystalline_core::config::save_yaml(&config, &cfg).unwrap();
    let engine = Engine::new(store_on(scratch).await, cfg, None, Some(config))
        .with_state_dir(base.join(id).join("state"))
        .with_instance_id(id.to_string());
    (Arc::new(engine), root)
}

async fn pair() -> Option<Pair> {
    let scratch = crate::support::scratch_schema("fh")?;
    let tmp = tempfile::tempdir().unwrap();
    let (alpha, _) = instance(&scratch, tmp.path(), "inst-a").await;
    alpha.sync(None).await.unwrap();
    let (beta, b_root) = instance(&scratch, tmp.path(), "inst-b").await;
    Some(Pair {
        alpha,
        beta,
        b_root,
        _tmp: tmp,
        scratch,
    })
}

impl Pair {
    /// Who holds `eng`'s host lock now, and its last heartbeat.
    async fn holder(&self) -> Option<crystalline_index::DomainHost> {
        let store = store_on(&self.scratch).await;
        let store = store.lock().await;
        let id = store.domain_id("eng").await.unwrap().unwrap();
        store.domain_host(id).await.unwrap()
    }

    /// Make `inst-a`'s heartbeat 91 seconds old: its laptop sleeps.
    async fn alpha_goes_silent(&self) {
        let store = store_on(&self.scratch).await;
        let store = store.lock().await;
        let id = store.domain_id("eng").await.unwrap().unwrap();
        let beat = crystalline_index::claim_window(91).1;
        store
            .claim_domain_host(id, "inst-a", "inst-a", &beat, &beat, true)
            .await
            .unwrap();
    }
}

fn params<T: serde::de::DeserializeOwned>(v: Value) -> T {
    serde_json::from_value(v).unwrap()
}

/// The refusal a write on `inst-b` meets while `inst-a` hosts `eng`.
fn refused(err: impl std::fmt::Display) {
    let text = err.to_string();
    assert!(
        text.contains("domain 'eng' is written by inst-a, the instance that hosts it")
            && text.contains("crystalline sync --domain eng --take-over"),
        "{text}"
    );
}

/// Every family of engram write on an instance that does not host the
/// domain is refused while its host is live, names the host, and changes
/// neither this disk nor the shared rows.
#[tokio::test]
async fn a_live_host_refuses_every_engram_write_on_postgres() {
    let Some(p) = pair().await else { return };
    let beta = &p.beta;
    refused(
        beta.write_engram(&params(json!({
            "domain": "eng", "title": "New", "content": "Typed on beta."
        })))
        .await
        .unwrap_err(),
    );
    assert!(!p.b_root.join("new.md").exists(), "nothing written here");
    refused(
        beta.edit_engram(&params(json!({
            "identifier": "alpha", "domain": "eng", "operation": "append",
            "content": "More from beta."
        })))
        .await
        .unwrap_err(),
    );
    refused(
        beta.delete_engram(&params(json!({ "identifier": "alpha", "domain": "eng" })))
            .await
            .unwrap_err(),
    );
    refused(
        beta.move_engram(
            &params(json!({
                "identifier": "alpha", "domain": "eng", "destination": "moved/alpha"
            })),
            &Scope::Unrestricted,
        )
        .await
        .unwrap_err(),
    );
    refused(
        beta.retire_engram(&params(json!({
            "identifier": "alpha", "domain": "eng", "status": "deprecated"
        })))
        .await
        .unwrap_err(),
    );
    refused(
        beta.attachment_write("eng", "assets/flow.png", b"\x89PNG".to_vec())
            .await
            .unwrap_err(),
    );
    let src = p._tmp.path().join("import");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("imported.md"), engram("Imported", "imported", "x")).unwrap();
    refused(
        beta.import_domain("eng", &src, false, false)
            .await
            .unwrap_err(),
    );
    assert!(
        std::fs::read_to_string(p.b_root.join("alpha.md"))
            .unwrap()
            .contains("the body about turbines")
            && !std::fs::read_to_string(p.b_root.join("alpha.md"))
                .unwrap()
                .contains("More from beta")
    );
    assert_eq!(p.holder().await.unwrap().instance_id, "inst-a");
    // A read is served from the shared rows, as before.
    let read = beta
        .read_engram(
            &params(json!({ "identifier": "alpha", "domain": "eng" })),
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    assert!(read.to_string().contains("turbines"), "{read}");
}

/// A lock whose holder sent no heartbeat for 90 seconds is not moved by a
/// read; the next write takes it over, as a sync takes it, and marks the
/// host move.
#[tokio::test]
async fn a_stale_host_is_taken_over_by_a_write_never_by_a_read_on_postgres() {
    let Some(p) = pair().await else { return };
    p.alpha_goes_silent().await;
    let beta = &p.beta;
    beta.read_engram(
        &params(json!({ "identifier": "alpha", "domain": "eng" })),
        &Scope::Unrestricted,
    )
    .await
    .unwrap();
    beta.list_domains(&ListDomainsParams::default(), &Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(
        p.holder().await.unwrap().instance_id,
        "inst-a",
        "no read moved the lock"
    );
    beta.write_engram(&params(json!({
        "domain": "eng", "title": "Taken", "content": "Written once alpha went silent."
    })))
    .await
    .unwrap();
    assert_eq!(p.holder().await.unwrap().instance_id, "inst-b");
    assert!(p.b_root.join("taken.md").exists());
    let store = store_on(&p.scratch).await;
    let store = store.lock().await;
    let id = store.domain_id("eng").await.unwrap().unwrap();
    let mark = store.host_move(id).await.unwrap().expect("a host move");
    assert_eq!(mark.claimant.as_deref(), Some("inst-b"));
    drop(store);
    // The old host refuses from its next write, naming the new one.
    let err = p
        .alpha
        .write_engram(&params(json!({
            "domain": "eng", "title": "Late", "content": "Alpha woke up."
        })))
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("domain 'eng' is written by inst-b, the instance that hosts it"),
        "{err}"
    );
}

/// The MCP tools meet the same rule: each write tool on the instance that
/// does not host the domain answers the refusal naming the host.
#[tokio::test]
async fn the_write_tools_refuse_on_an_instance_that_does_not_host_on_postgres() {
    let Some(p) = pair().await else { return };
    for (tool, args) in [
        (
            "write_engram",
            json!({ "domain": "eng", "title": "New", "content": "x" }),
        ),
        (
            "edit_engram",
            json!({ "identifier": "alpha", "domain": "eng", "operation": "append", "content": "x" }),
        ),
        (
            "delete_engram",
            json!({ "identifier": "alpha", "domain": "eng" }),
        ),
        (
            "move_engram",
            json!({ "identifier": "alpha", "domain": "eng", "destination": "moved/alpha" }),
        ),
    ] {
        let err = crystalline_service::route::run_tool_routed(
            &p.beta,
            tool,
            args,
            &crystalline_remote::ForwardedAgent::default(),
            None,
        )
        .await
        .unwrap_err();
        refused(format!("{tool}: {err:#}"));
    }
}
