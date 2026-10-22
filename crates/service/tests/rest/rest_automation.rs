//! `GET /api/v1/domains/{domain}/automation`: when the loops last ran, what
//! waits for a person and whether the trigger webhook works, read with the
//! session cookie by the Fluid pages.
//!
//! Driven over a live listener through the production router. The runs are
//! recorded through the engine, the way a runner's lease and record verbs do.

use std::sync::Arc;
use std::sync::atomic::AtomicUsize;

use crystalline_core::automation::{Loop, RunOutcome, RunReport};
use crystalline_core::config::{
    AuthConfig, AutomationConfig, DomainEntry, GlobalConfig, WebhookConfig,
};
use crystalline_index::TursoStore;
use crystalline_service::daemon::http_router;
use crystalline_service::rest::{AuthStore, Role};
use crystalline_service::{Engine, Scope};
use serde_json::Value;
use tokio::sync::Mutex;

struct Fixture {
    addr: std::net::SocketAddr,
    engine: Arc<Engine>,
    _state: crate::support::ScratchStateDir,
    _tmp: tempfile::TempDir,
}

fn manifest(extra: &str) -> String {
    format!(
        "---\ntype: manifest\ntitle: eng\npermalink: manifest\ntags:\n  - manifest\nstatus: stable\nrecorded_at: 2026-01-01\n{extra}---\n\n# eng\n\n## Scope\n\n- Everything about eng\n\n## When to Use\n\n- Route here for eng questions\n"
    )
}

/// `eng` with the evolve webhook trigger on and a webhook URL without a
/// secret, and a viewer `ada`.
async fn serve() -> Fixture {
    let state = crate::support::ScratchStateDir::acquire();
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let dir = root.join("eng");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("MANIFEST.md"),
        manifest("evolve_trigger: webhook\n"),
    )
    .unwrap();
    let mut cfg = GlobalConfig {
        domains_root: Some(root.join("domains-root")),
        auth: Some(AuthConfig {
            trusted_header: None,
            proxy_headers: None,
            anonymous: Some(false),
            mcp: None,
            oauth: None,
            max_users: None,
            oidc: None,
            login: None,
        }),
        automation: Some(AutomationConfig {
            webhook: Some(WebhookConfig {
                url: Some("https://hooks.example.test/crystalline".to_string()),
                secret: None,
            }),
            evolve_threshold: None,
        }),
        ..GlobalConfig::default()
    };
    cfg.domains
        .insert("eng".to_string(), DomainEntry::file(dir));
    let config_path = root.join("config.yaml");
    crystalline_core::config::save_yaml(&config_path, &cfg).unwrap();
    let store = TursoStore::open_in_memory().await.unwrap();
    let engine = Arc::new(Engine::new(
        Arc::new(Mutex::new(store)),
        cfg,
        None,
        Some(config_path),
    ));
    engine.sync(None).await.unwrap();
    let auth = Arc::new(
        AuthStore::open(&tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    auth.add_user("ada", "Ada", None, Role::Viewer, "s3cret")
        .await
        .unwrap();
    let router = http_router(
        engine.clone(),
        Arc::new(AtomicUsize::new(0)),
        &[],
        auth,
        None,
    )
    .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    Fixture {
        addr,
        engine,
        _state: state,
        _tmp: tmp,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

async fn login(addr: std::net::SocketAddr) -> String {
    let resp = client()
        .post(format!("http://{addr}/api/v1/auth/login"))
        .json(&serde_json::json!({ "name": "ada", "password": "s3cret" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    resp.headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("fluid_session="))
        .and_then(|v| v.split(';').next())
        .and_then(|v| v.strip_prefix("fluid_session="))
        .unwrap()
        .to_string()
}

async fn read(addr: std::net::SocketAddr, cookie: Option<&str>, domain: &str) -> (u16, Value) {
    let mut req = client().get(format!("http://{addr}/api/v1/domains/{domain}/automation"));
    if let Some(cookie) = cookie {
        req = req.header("cookie", format!("fluid_session={cookie}"));
    }
    let resp = req.send().await.unwrap();
    let status = resp.status().as_u16();
    (status, resp.json().await.unwrap_or(Value::Null))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_loop_that_never_ran_has_no_last_run() {
    let fx = serve().await;
    let cookie = login(fx.addr).await;
    let (status, body) = read(fx.addr, Some(&cookie), "eng").await;
    assert_eq!(status, 200, "{body}");
    for lp in ["reflect", "evolve"] {
        assert!(body[lp]["last_run"].is_null(), "{lp}: {body}");
        assert!(body[lp]["running"].is_null(), "{lp}: {body}");
        assert_eq!(body[lp]["left_for_person"], 0, "{lp}: {body}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_recorded_run_shows_counts_and_never_the_items() {
    let fx = serve().await;
    let owner = Scope::Unrestricted;
    let token = fx
        .engine
        .automation_lease_take(Loop::Evolve, "eng", "n8n", &owner)
        .await
        .unwrap()["token"]
        .as_str()
        .unwrap()
        .to_string();
    fx.engine
        .automation_run_record(
            Loop::Evolve,
            "eng",
            &token,
            &RunReport {
                started_at: String::new(),
                outcome: RunOutcome::Done,
                done: 2,
                summary: "fixed two".to_string(),
            },
            &owner,
        )
        .await
        .unwrap();
    let cookie = login(fx.addr).await;
    let (status, body) = read(fx.addr, Some(&cookie), "eng").await;
    assert_eq!(status, 200, "{body}");
    let run = &body["evolve"]["last_run"];
    assert_eq!(run["runner"], "n8n", "{body}");
    assert_eq!(run["outcome"], "done", "{body}");
    assert_eq!(run["done"], 2, "{body}");
    assert_eq!(run["summary"], "fixed two", "{body}");
    assert!(run.get("left_items").is_none(), "{body}");
    assert!(body["reflect"]["last_run"].is_null(), "{body}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_delivery_shows_where_the_manifest_turns_the_trigger_on() {
    let fx = serve().await;
    fx.engine.record_delivery(
        "eng",
        Loop::Evolve,
        Err("the webhook secret is not set".to_string()),
    );
    let cookie = login(fx.addr).await;
    let (_, body) = read(fx.addr, Some(&cookie), "eng").await;
    assert!(body["reflect"]["delivery"].is_null(), "off: {body}");
    let delivery = &body["evolve"]["delivery"];
    assert_eq!(delivery["configured"], false, "{body}");
    assert_eq!(
        delivery["last_error"], "the webhook secret is not set",
        "{body}"
    );
    assert!(delivery["last_sent"].is_null(), "{body}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_caller_without_a_session_or_an_unknown_domain_gets_the_same_refusal() {
    let fx = serve().await;
    let cookie = login(fx.addr).await;
    let (unknown, _) = read(fx.addr, Some(&cookie), "nope").await;
    assert_eq!(unknown, 404);
    let (anonymous, _) = read(fx.addr, None, "eng").await;
    assert_eq!(anonymous, 401);
}
