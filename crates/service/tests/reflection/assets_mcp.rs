//! A Reflection's files over MCP: resource links in read_reflection and the
//! bytes through resources/read, under the Reflection right.

use base64::Engine as _;
use rmcp::RoleClient;
use rmcp::model::{CallToolRequestParams, ReadResourceRequestParams};
use rmcp::service::{Peer, RunningService};
use serde_json::{Value, json};

use crystalline_service::mcp::McpServer;

use crate::assets::PNG;
use crate::docs::{person, reflecting, write};

async fn connect(
    engine: std::sync::Arc<crystalline_service::Engine>,
) -> (
    RunningService<RoleClient, ()>,
    RunningService<rmcp::RoleServer, McpServer>,
) {
    let (client_io, server_io) = tokio::io::duplex(1 << 18);
    let server_task =
        tokio::spawn(async move { rmcp::serve_server(McpServer::new(engine), server_io).await });
    let client = rmcp::serve_client((), client_io).await.unwrap();
    (client, server_task.await.unwrap().unwrap())
}

async fn call(peer: &Peer<RoleClient>, tool: &str, args: Value) -> Value {
    let mut params = CallToolRequestParams::new(tool.to_string());
    if let Value::Object(map) = args {
        params = params.with_arguments(map);
    }
    serde_json::to_value(peer.call_tool(params).await.unwrap()).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_reflection_links_the_files_it_references_and_resources_read_serves_them() {
    let fx = reflecting().await;
    fx.engine
        .reflection_asset_write("eng", "assets/flow.png", PNG.to_vec(), &person())
        .await
        .unwrap();
    fx.engine
        .reflection_asset_write("eng", "assets/unused.png", PNG.to_vec(), &person())
        .await
        .unwrap();
    fx.engine
        .write_reflection(
            &write(
                "guides/a.md",
                "# A\n\n![flow](../assets/flow.png#right) ![gone](../assets/gone.png)\n",
            ),
            &person(),
        )
        .await
        .unwrap();
    let (client, _server) = connect(fx.engine.clone()).await;
    let result = call(
        client.peer(),
        "read_reflection",
        json!({ "domain": "eng", "path": "guides/a.md" }),
    )
    .await;
    let links: Vec<&Value> = result["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["type"] == "resource_link")
        .collect();
    assert_eq!(
        links.len(),
        1,
        "only a referenced file that is there: {result}"
    );
    assert_eq!(
        links[0]["uri"],
        "crystalline://eng/reflections/assets/flow.png"
    );
    assert_eq!(links[0]["mimeType"], "image/png");
    let read = client
        .peer()
        .read_resource(ReadResourceRequestParams::new(
            "crystalline://eng/reflections/assets/flow.png",
        ))
        .await
        .unwrap();
    let contents = serde_json::to_value(&read.contents[0]).unwrap();
    let blob = base64::engine::general_purpose::STANDARD
        .decode(contents["blob"].as_str().unwrap())
        .unwrap();
    assert_eq!(blob, PNG);
    let templates = client
        .peer()
        .list_resource_templates(Default::default())
        .await
        .unwrap()
        .resource_templates;
    assert!(
        templates
            .iter()
            .any(|t| t.uri_template == "crystalline://{domain}/reflections/assets/{+path}"),
        "{templates:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reflection_file_is_not_served_while_the_reflection_is_off() {
    let fx = crate::fixture::fixture(&[("reflections/assets/flow.png", "x")]).await;
    let (client, _server) = connect(fx.engine.clone()).await;
    let err = client
        .peer()
        .read_resource(ReadResourceRequestParams::new(
            "crystalline://eng/reflections/assets/flow.png",
        ))
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("Reflection is off"), "{err}");
}
