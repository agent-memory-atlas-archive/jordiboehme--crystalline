//! The shared Reflection link corpus: one fixture, two sets of link rules.
//!
//! fluid/src/reflectionAssets.test.ts runs the same file through
//! `reflectionAssetRefs` and `engramAttachmentEmbeds`, so a change to what
//! `classify_target` answers that the TypeScript side does not mirror fails
//! one of the two suites instead of shipping as a silent divergence.

use crystalline_core::reflection::{engram_attachment_embeds, reflection_asset_refs};

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    page: String,
    body: String,
    refs: Vec<String>,
    engram: Vec<String>,
}

#[test]
fn the_reflection_link_rules_agree_with_the_shared_corpus() {
    let raw = include_str!("../fixtures/reflection_asset_corpus.json");
    let cases: Vec<Case> = serde_json::from_str(raw).expect("corpus parses");
    assert!(cases.len() >= 16, "corpus lost cases");
    for case in cases {
        assert_eq!(
            reflection_asset_refs(&case.body, &case.page),
            case.refs,
            "case '{}' diverged in refs",
            case.name
        );
        assert_eq!(
            engram_attachment_embeds(&case.body, &case.page),
            case.engram,
            "case '{}' diverged in engram embeds",
            case.name
        );
    }
}
