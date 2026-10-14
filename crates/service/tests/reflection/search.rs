//! Reflection search: the backlog, the tick and the nudge (Task 29), and the
//! search verb with its mode fallback and paging (Task 30).

use std::sync::Arc;
use std::time::Duration;

use crystalline_core::config::EvolveConfig;
use crystalline_index::embed::DEFAULT_MODEL_ID;
use crystalline_index::{ChunkTable, EmbeddingRow};
use crystalline_service::ReflectionCaller;
use crystalline_service::engine::ReflectionSearch;

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

fn search<'a>(query: &'a str, search_type: Option<&'a str>) -> ReflectionSearch<'a> {
    ReflectionSearch {
        query,
        search_type,
        limit: 10,
        page: 1,
    }
}

#[tokio::test]
async fn hybrid_is_the_default_and_answers_sections_best_first() {
    let fx = fixture_with_provider(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    // Bag-of-words vectors: the night section is made of the query's words,
    // so its cosine clears the 0.78 floor and the rollback section's does not.
    fx.engine
        .write_reflection(
            &write(
                "guides/deploying.md",
                "# Deploying\n\n## Night deploys\n\nNight deploys, night deploys.\n\n## Rollback\n\nRoll back with the script.\n",
            ),
            &person(),
        )
        .await
        .unwrap();
    fx.engine.embed_pending().await.unwrap();
    let answer = fx
        .engine
        .search_reflection("eng", &search("night deploys", None), &person())
        .await
        .unwrap();
    assert_eq!(answer["mode"], "hybrid", "{answer}");
    assert_eq!(answer["hits"][0]["heading"], "Night deploys");
    assert!(
        answer["hits"][0].get("score").is_none(),
        "no score leaves the engine"
    );
    let semantic = fx
        .engine
        .search_reflection("eng", &search("night deploys", Some("semantic")), &person())
        .await
        .unwrap();
    assert_eq!(semantic["mode"], "semantic");
    assert_eq!(
        semantic["hits"][0]["heading"], "Night deploys",
        "{semantic}"
    );
}

#[tokio::test]
async fn hybrid_answers_as_text_until_the_pages_are_embedded() {
    let fx = fixture_with_provider(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    fx.engine
        .write_reflection(
            &write("a.md", "# A\n\n## Night\n\nDeploys run at night.\n"),
            &person(),
        )
        .await
        .unwrap();
    let answer = fx
        .engine
        .search_reflection("eng", &search("night", None), &person())
        .await
        .unwrap();
    assert_eq!(
        (answer["mode"].as_str(), answer["total"].as_u64()),
        (Some("text"), Some(1)),
        "{answer}"
    );
    // Stale: the first page is embedded by the active model, a second page's
    // chunks carry vectors of another width, so the store refuses to compare
    // and the search answers as text instead of failing.
    fx.engine.embed_pending().await.unwrap();
    fx.engine
        .write_reflection(
            &write("b.md", "# B\n\n## Day\n\nDeploys run by day.\n"),
            &person(),
        )
        .await
        .unwrap();
    {
        let store = fx.engine.store();
        let store = store.lock().await;
        let jobs = store
            .chunks_needing_embedding_in(ChunkTable::Reflection, "fake", None, 100, None)
            .await
            .unwrap();
        assert!(!jobs.is_empty(), "precondition: the second page waits");
        let batch: Vec<EmbeddingRow> = jobs
            .iter()
            .map(|j| EmbeddingRow {
                chunk_id: j.chunk_id,
                embedding: vec![0.5; 4],
                dims: 4,
            })
            .collect();
        store
            .store_embeddings_in(ChunkTable::Reflection, &batch, "fake")
            .await
            .unwrap();
    }
    let answer = fx
        .engine
        .search_reflection("eng", &search("night", None), &person())
        .await
        .unwrap();
    assert_eq!(
        answer["mode"], "text",
        "stale vectors: text, never an error"
    );
    assert_eq!(answer["hits"][0]["path"], "a.md", "{answer}");
    let no_provider = fixture(&[
        ("MANIFEST.md", &manifest("reflection: on\n")),
        ("reflections/a.md", &page("A")),
    ])
    .await;
    let answer = no_provider
        .engine
        .search_reflection("eng", &search("text", Some("semantic")), &person())
        .await
        .unwrap();
    assert_eq!(answer["mode"], "text", "no provider: text, never an error");
}

#[tokio::test]
async fn the_provenance_block_never_matches_in_any_mode() {
    let fx = fixture_with_provider(&[
        ("MANIFEST.md", &manifest("reflection: on\n")),
        (
            "runbooks/deploy.md",
            &engram("Deploy runbook", "runbooks/deploy", "Night deploys."),
        ),
    ])
    .await;
    // A curated write names the source engram in the page's reflection: block.
    let mut p = write("a.md", "# A\n\n## Night\n\nDeploys run at night.\n");
    p.sources = std::collections::BTreeMap::from([
        ("_top".to_string(), Vec::new()),
        ("Night".to_string(), vec!["runbooks/deploy".to_string()]),
    ]);
    fx.engine
        .write_reflection(&p, &ReflectionCaller::owner())
        .await
        .unwrap();
    assert!(
        std::fs::read_to_string(fx.root.join("reflections/a.md"))
            .unwrap()
            .contains("runbooks/deploy"),
        "precondition: the block is on disk"
    );
    fx.engine.embed_pending().await.unwrap();
    for mode in ["text", "hybrid", "semantic"] {
        let answer = fx
            .engine
            .search_reflection(
                "eng",
                &search("runbooks", Some(mode)),
                &ReflectionCaller::owner(),
            )
            .await
            .unwrap();
        assert!(
            !answer.to_string().contains("runbooks/deploy"),
            "{mode}: {answer}"
        );
    }
}

#[tokio::test]
async fn a_search_takes_the_read_right_and_refuses_engram_only_modes() {
    let fx = fixture_with_provider(&[
        ("MANIFEST.md", &manifest("reflection: on\n")),
        ("reflections/a.md", &page("A")),
    ])
    .await;
    let err = fx
        .engine
        .search_reflection("eng", &search("text", Some("title")), &person())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("hybrid, text or semantic"), "{err}");
    let err = fx
        .engine
        .search_reflection("eng", &search("   ", None), &person())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("query"), "{err}");
    let paged = fx
        .engine
        .search_reflection(
            "eng",
            &ReflectionSearch {
                query: "text",
                search_type: Some("text"),
                limit: 1,
                page: 2,
            },
            &person(),
        )
        .await
        .unwrap();
    assert_eq!(
        (
            paged["page"].as_u64(),
            paged["limit"].as_u64(),
            paged["count"].as_u64()
        ),
        (Some(2), Some(1), Some(0)),
        "{paged}"
    );
}
