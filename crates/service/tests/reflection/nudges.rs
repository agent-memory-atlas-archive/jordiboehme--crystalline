//! The write-receipt trailer (share, then evolve, then reflect) and the
//! counts the daemon records for the hooks.

use std::collections::BTreeMap;

use crystalline_service::nudge::{MCP_EVOLVE_NUDGE, MCP_REFLECT_NUDGE, write_verb_trailer};
use crystalline_service::{ReflectionCaller, Scope};

use crate::queue::curated_with_a_feedback_item;

#[tokio::test]
async fn the_write_trailer_asks_for_reflect_and_then_keeps_quiet() {
    let _state = crate::support::ScratchStateDir::acquire();
    let fx = curated_with_a_feedback_item().await;
    assert_eq!(
        write_verb_trailer(&fx.engine, None, &Scope::Unrestricted).await,
        None,
        "no record yet, no live count"
    );
    fx.engine.record_reflect_counts().await.unwrap();
    assert_eq!(
        write_verb_trailer(&fx.engine, None, &Scope::Unrestricted)
            .await
            .as_deref(),
        Some(MCP_REFLECT_NUDGE)
    );
    assert_eq!(
        write_verb_trailer(&fx.engine, None, &Scope::Unrestricted).await,
        None,
        "the cooldown holds"
    );
}

#[tokio::test]
async fn evolve_goes_before_reflect_in_the_trailer() {
    let _state = crate::support::ScratchStateDir::acquire();
    let fx = curated_with_a_feedback_item().await;
    let hooks = fx.tmp.path().join("state").join("hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    std::fs::write(
        hooks.join("maintenance.json"),
        r#"{"v":1,"pending_domains":["eng"],"reflect_open":{"eng":1}}"#,
    )
    .unwrap();
    assert_eq!(
        write_verb_trailer(&fx.engine, None, &Scope::Unrestricted)
            .await
            .as_deref(),
        Some(MCP_EVOLVE_NUDGE)
    );
    assert_eq!(
        write_verb_trailer(&fx.engine, None, &Scope::Unrestricted)
            .await
            .as_deref(),
        Some(MCP_REFLECT_NUDGE),
        "reflect on the next receipt"
    );
}

/// What the daemon's tick records is the owner's live count, and the record
/// keeps every field the hooks and the recorders own.
#[tokio::test]
async fn the_recorded_counts_are_the_owners_live_counts() {
    let _state = crate::support::ScratchStateDir::acquire();
    let fx = curated_with_a_feedback_item().await;
    let hooks = fx.tmp.path().join("state").join("hooks");
    std::fs::create_dir_all(&hooks).unwrap();
    std::fs::write(
        hooks.join("maintenance.json"),
        r#"{"v":1,"last_nudge_at":"2026-09-30T10:00:00Z"}"#,
    )
    .unwrap();
    let live: BTreeMap<String, u64> = fx
        .engine
        .reflect_open_counts(&[], &ReflectionCaller::owner())
        .await
        .unwrap()
        .into_iter()
        .map(|(domain, n)| (domain, n as u64))
        .collect();
    assert!(live.get("eng").is_some_and(|n| *n >= 1), "{live:?}");
    assert_eq!(fx.engine.record_reflect_counts().await.unwrap(), live);
    let on_disk: serde_json::Value =
        serde_json::from_slice(&std::fs::read(hooks.join("maintenance.json")).unwrap()).unwrap();
    assert_eq!(
        on_disk["reflect_open"],
        serde_json::to_value(&live).unwrap()
    );
    assert!(
        on_disk["last_nudge_at"].is_string(),
        "every other field survives: {on_disk}"
    );
    assert_eq!(
        fx.engine
            .curated_reflections(&ReflectionCaller::owner())
            .await
            .unwrap(),
        ["eng".to_string()].into(),
    );
}
