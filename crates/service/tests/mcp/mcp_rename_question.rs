//! **A pending rename question is named to agents once per session.**
//!
//! When a sync saw an explicit domain's MANIFEST `domain_name` change, this
//! instance holds a question for a person: finish the rename, or keep the
//! links as they are. No MCP tool answers it, so an agent is only told about
//! it: one guidance line on the first tool answer about that domain in a
//! session, never again in the same session, and again in the next one.

use std::sync::Arc;

use crystalline_core::config::{
    DomainEntry, GlobalConfig, NameOrigin, RenameQuestion, ResponseFormat, ServiceConfig,
};
use crystalline_index::TursoStore;
use crystalline_service::Engine;
use crystalline_service::mcp::McpServer;
use rmcp::RoleClient;
use rmcp::model::CallToolRequestParams;
use rmcp::service::RunningService;
use serde_json::{Value, json};
use tokio::sync::Mutex;

const LINE: &str = "This domain was renamed from eng to platform in its MANIFEST. Tell the person they can finish the rename in Fluid (the banner on the domain) or with `crystalline doctor --fix`; if nobody is there to ask, leave it.";

const NOTE: &str = "---\ntype: engram\ntitle: Note\npermalink: note\ntags:\n  - eng\nstatus: stable\nrecorded_at: 2026-01-01\n---\n\n# Note\n\nA note.\n";

struct Harness {
    _tmp: tempfile::TempDir,
    engine: Arc<Engine>,
}

impl Harness {
    /// An explicit domain `eng` whose MANIFEST now declares `platform`, with
    /// the question the adoption recorded for it, and a plain domain `ops`.
    async fn new() -> Harness {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let mut cfg = GlobalConfig::default();
        for (name, declared) in [("eng", "platform"), ("ops", "ops")] {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("MANIFEST.md"),
                crystalline_core::manifest_template(declared, "2026-01-01"),
            )
            .unwrap();
            std::fs::write(dir.join("note.md"), NOTE).unwrap();
            let mut entry = DomainEntry::file(dir).with_name_origin(NameOrigin::Explicit);
            entry.canonical_seen = Some(declared.to_string());
            if name == "eng" {
                entry.rename_question = Some(RenameQuestion {
                    from: "eng".to_string(),
                    to: "platform".to_string(),
                    seen_at: "2026-01-01T00:00:00+00:00".to_string(),
                    answered: None,
                });
            }
            cfg.domains.insert(name.to_string(), entry);
        }
        cfg.service = Some(ServiceConfig {
            response_format: Some(ResponseFormat::Json),
            ..ServiceConfig::default()
        });
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
        Harness { _tmp: tmp, engine }
    }

    /// One stdio session: a real rmcp client over a duplex pair.
    async fn connect(
        &self,
    ) -> (
        RunningService<RoleClient, ()>,
        RunningService<rmcp::RoleServer, McpServer>,
    ) {
        let (client_io, server_io) = tokio::io::duplex(1 << 18);
        let engine = self.engine.clone();
        let server_task =
            tokio::spawn(
                async move { rmcp::serve_server(McpServer::new(engine), server_io).await },
            );
        let client = rmcp::serve_client((), client_io).await.unwrap();
        let server = server_task.await.unwrap().unwrap();
        (client, server)
    }
}

/// The first text block of a `read_engram` answer for `note` in `domain`.
async fn read_text(client: &RunningService<RoleClient, ()>, domain: &str) -> String {
    let mut params = CallToolRequestParams::new("read_engram");
    if let Value::Object(map) = json!({ "identifier": "note", "domain": domain }) {
        params = params.with_arguments(map);
    }
    let result = client.call_tool(params).await.unwrap();
    let value = serde_json::to_value(result).unwrap();
    value["content"][0]["text"]
        .as_str()
        .expect("a text block")
        .to_string()
}

#[tokio::test]
async fn the_rename_guidance_appears_once_per_session_and_domain() {
    let harness = Harness::new().await;
    let (first, _server) = harness.connect().await;

    let answer = read_text(&first, "eng").await;
    assert!(answer.ends_with(&format!("\n\n---\n{LINE}")), "{answer}");
    let receipt = answer.split("\n\n---\n").next().unwrap();
    let receipt: Value = serde_json::from_str(receipt).unwrap();
    assert_eq!(receipt["domain"], "eng");

    let again = read_text(&first, "eng").await;
    assert!(!again.contains(LINE), "once per session: {again}");

    let other = read_text(&first, "ops").await;
    assert!(
        !other.contains("renamed from"),
        "a domain with no question: {other}"
    );

    let (second, _server) = harness.connect().await;
    let fresh = read_text(&second, "eng").await;
    assert!(fresh.contains(LINE), "a new session is told again: {fresh}");
}
