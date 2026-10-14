//! Reflection search: the backlog, the tick and the nudge (Task 29).

use std::sync::Arc;
use std::time::Duration;

use crystalline_core::config::EvolveConfig;
use crystalline_index::embed::DEFAULT_MODEL_ID;

use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use crate::docs::{person, write};
use crate::fixture::*;
use crystalline_service::daemon::run_embed_tick;

/// Reflection on, the contradiction check on, both worker channels wired and
/// every engram chunk embedded under the default model; then one page is
/// written, so its chunks wait in the reflection backlog while the engram
/// backlog is empty. The default model keeps its line floor, which the
/// contradiction gate needs; the provider only stands in for it.
async fn wired() -> (Fx, UnboundedReceiver<()>, UnboundedReceiver<()>) {
    let (embed_tx, mut embed_rx) = unbounded_channel();
    let (contra_tx, mut contra_rx) = unbounded_channel();
    let fx = fixture_wired_with(
        &[("MANIFEST.md", &manifest("reflection: on\n"))],
        |cfg, _| {
            cfg.evolve = Some(EvolveConfig {
                contradictions: Some("full".into()),
            });
        },
        Some(Arc::new(BagOfWords::new(DEFAULT_MODEL_ID))),
        Some(embed_tx),
        Some(contra_tx),
    )
    .await;
    fx.engine.embed_pending().await.unwrap();
    fx.engine
        .write_reflection(&write("a.md", &page("A")), &person())
        .await
        .unwrap();
    while embed_rx.try_recv().is_ok() {}
    while contra_rx.try_recv().is_ok() {}
    (fx, embed_rx, contra_rx)
}

#[tokio::test]
async fn a_reflection_write_leaves_chunks_the_next_pass_embeds() {
    let fx = fixture_with_provider(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    fx.engine
        .write_reflection(
            &write("guides/a.md", "# A\n\n## Night\n\nDeploys run at night.\n"),
            &person(),
        )
        .await
        .unwrap();
    assert_eq!(
        fx.engine.embedding_backlog().await.unwrap(),
        0,
        "the engram backlog never counts a page (R55)"
    );
    assert!(fx.engine.reflection_embedding_backlog().await.unwrap() > 0);
    fx.engine.embed_pending().await.unwrap();
    assert_eq!(fx.engine.reflection_embedding_backlog().await.unwrap(), 0);
    let status = fx.engine.status_report().await.unwrap();
    assert!(
        status["embeddings"]["reflection_chunks"].as_u64().unwrap() > 0,
        "{status}"
    );
    assert_eq!(
        status["embeddings"]["reflection_chunks"],
        status["embeddings"]["reflection_embedded_chunks"],
        "{status}"
    );
}

/// R55: `activity.embedding_backlog` is the engram backlog plus the
/// reflection backlog, while `embedding_backlog()` stays engram only.
#[tokio::test]
async fn status_backlog_adds_the_reflection_backlog() {
    let fx = fixture_with_provider(&[
        ("MANIFEST.md", &manifest("reflection: on\n")),
        ("ops.md", &engram("Ops", "ops", "Deploys run at noon.")),
    ])
    .await;
    // One engram and one page waiting at once, so a sum that dropped either
    // term reads differently.
    std::fs::write(
        fx.root.join("ops.md"),
        engram("Ops", "ops", "Deploys run at night, never at noon."),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    fx.engine
        .write_reflection(
            &write("guides/a.md", "# A\n\n## Night\n\nDeploys run at night.\n"),
            &person(),
        )
        .await
        .unwrap();
    let engram_backlog = fx.engine.embedding_backlog().await.unwrap();
    let reflection_backlog = fx.engine.reflection_embedding_backlog().await.unwrap();
    assert!(engram_backlog > 0, "precondition: an engram chunk waits");
    assert!(reflection_backlog > 0, "precondition: a page chunk waits");
    let status = fx.engine.status_report().await.unwrap();
    assert_eq!(
        status["activity"]["embedding_backlog"],
        serde_json::json!(engram_backlog + reflection_backlog),
        "{status}"
    );
}

#[tokio::test]
async fn status_without_a_reflection_carries_no_reflection_keys() {
    let fx = fixture_with_provider(&[]).await;
    let status = fx.engine.status_report().await.unwrap();
    assert!(
        status["embeddings"].get("reflection_chunks").is_none(),
        "{status}"
    );
    assert!(
        status["embeddings"]
            .get("reflection_embedded_chunks")
            .is_none(),
        "{status}"
    );
}

#[tokio::test]
async fn a_reflection_write_wakes_the_embed_worker() {
    let (fx, mut embed_rx, _contra) = wired().await;
    while embed_rx.try_recv().is_ok() {}
    fx.engine
        .write_reflection(&write("b.md", "# B\n\n## Part\n\nText.\n"), &person())
        .await
        .unwrap();
    assert!(
        embed_rx.try_recv().is_ok(),
        "a reflection write nudges the worker (R56)"
    );
}

#[tokio::test]
async fn tick_refires_the_worker_for_a_reflection_backlog_alone() {
    let (fx, mut embed_rx, _contra) = wired().await;
    while embed_rx.try_recv().is_ok() {}
    assert_eq!(fx.engine.embedding_backlog().await.unwrap(), 0);
    assert!(fx.engine.reflection_embedding_backlog().await.unwrap() > 0);
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let handle = tokio::spawn(run_embed_tick(
        fx.engine.clone(),
        Duration::from_millis(25),
        shutdown_rx,
    ));
    let signal = tokio::time::timeout(Duration::from_secs(1), embed_rx.recv()).await;
    assert!(
        signal.is_ok_and(|v| v.is_some()),
        "a reflection backlog alone re-fires the worker"
    );
    shutdown_tx.send(true).unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(1), handle).await;
}

#[tokio::test]
async fn a_reflection_backlog_never_holds_back_the_contradiction_pass() {
    let (fx, _embed, mut contra_rx) = wired().await;
    while contra_rx.try_recv().is_ok() {}
    assert_eq!(
        fx.engine.embedding_backlog().await.unwrap(),
        0,
        "precondition: no engram chunk waits"
    );
    assert!(fx.engine.reflection_embedding_backlog().await.unwrap() > 0);
    // A fresh engine with the check on asks for a pass while its pending
    // count is unknown.
    assert!(fx.engine.contradictions_wanted(), "precondition");
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let handle = tokio::spawn(run_embed_tick(
        fx.engine.clone(),
        Duration::from_millis(25),
        shutdown_rx,
    ));
    let signal = tokio::time::timeout(Duration::from_secs(1), contra_rx.recv()).await;
    assert!(
        signal.is_ok_and(|v| v.is_some()),
        "the engram backlog is empty, so the tick asks for the contradiction pass whatever the pages wait for"
    );
    shutdown_tx.send(true).unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(1), handle).await;
}
