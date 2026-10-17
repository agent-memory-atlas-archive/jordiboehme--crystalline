//! `sources` on a reflection write, keyed by section id or heading: a
//! heading this same write creates is found once its id is minted, a key
//! that names no single `##` section is refused with the sections the page
//! has, and nothing is written.

use std::collections::BTreeMap;

use crate::docs::{agent, reflecting, write};
use crate::fixture::Fx;

fn sourced(
    path: &str,
    markdown: &str,
    keys: &[&str],
) -> crystalline_service::params::WriteReflectionParams {
    let mut p = write(path, markdown);
    p.sources = keys
        .iter()
        .map(|k| (k.to_string(), vec!["runbooks/deploy".to_string()]))
        .collect::<BTreeMap<_, _>>();
    p
}

async fn sources_of(fx: &Fx, path: &str) -> Vec<(String, String)> {
    let doc = fx
        .engine
        .read_reflection("eng", path, &agent())
        .await
        .unwrap();
    doc["sections"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|s| {
            let source = s["sources"][0]["permalink"].as_str()?;
            Some((s["heading"].as_str()?.to_string(), source.to_string()))
        })
        .collect()
}

fn exists(fx: &Fx, path: &str) -> bool {
    fx.root.join("reflections").join(path).exists()
}

#[tokio::test]
async fn a_create_keys_sources_by_the_headings_it_creates() {
    let fx = reflecting().await;
    let page = "# Deploying\n\nFor new people.\n\n## Night deploys\n\nAt night.\n\n## Rollback\n\nRoll back.\n";
    let written = fx
        .engine
        .write_reflection(
            &sourced("a.md", page, &["Night deploys", "## Rollback"]),
            &agent(),
        )
        .await
        .unwrap();
    assert_eq!(written["curated"], true, "{written}");
    assert_eq!(
        sources_of(&fx, "a.md").await,
        vec![
            ("Night deploys".to_string(), "runbooks/deploy".to_string()),
            ("Rollback".to_string(), "runbooks/deploy".to_string()),
        ],
        "a key written with its ## marks finds the section too"
    );
}

#[tokio::test]
async fn an_update_keys_sources_by_the_heading_of_a_section_it_adds() {
    let fx = reflecting().await;
    let page = "# Deploying\n\n## Night deploys\n\nAt night.\n";
    fx.engine
        .write_reflection(&write("a.md", page), &agent())
        .await
        .unwrap();
    let stored = std::fs::read_to_string(fx.root.join("reflections/a.md")).unwrap();
    let grown = format!("{}\n## Rollback\n\nRoll back.\n", stored.trim_end());
    let written = fx
        .engine
        .write_reflection(&sourced("a.md", &grown, &["Rollback"]), &agent())
        .await
        .unwrap();
    assert_eq!(written["ids_assigned"].as_array().unwrap().len(), 1);
    assert_eq!(
        sources_of(&fx, "a.md").await,
        vec![("Rollback".to_string(), "runbooks/deploy".to_string())]
    );
}

#[tokio::test]
async fn a_heading_two_sections_share_is_refused_with_both_headings_and_the_way_out() {
    let fx = reflecting().await;
    let page = "# Deploying\n\n## Example\n\nA.\n\n## Rollback\n\nB.\n\n## Example\n\nC.\n";
    let err = fx
        .engine
        .write_reflection(&sourced("a.md", page, &["Example"]), &agent())
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("'Example' names 2 sections in 'a.md' ('Example', 'Example')"),
        "{err}"
    );
    assert!(err.contains("write it again with sources"), "{err}");
    assert!(err.contains("ids_assigned"), "asks for the ids: {err}");
    assert!(!exists(&fx, "a.md"), "nothing written");
}

#[tokio::test]
async fn a_key_that_names_the_title_is_refused_with_the_sections_the_page_has() {
    let fx = reflecting().await;
    let page = "# Removing a tenant\n\nFor good.\n\n## Before you purge\n\nExport.\n\n## The purge\n\nGone.\n";
    let err = fx
        .engine
        .write_reflection(&sourced("a.md", page, &["Removing a tenant"]), &agent())
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("no section 'Removing a tenant' in 'a.md' to set sources on"),
        "{err}"
    );
    assert!(err.contains("'Before you purge', 'The purge'"), "{err}");
    assert!(
        err.contains("not sections"),
        "says why the title is not: {err}"
    );
    assert!(!exists(&fx, "a.md"), "nothing written");
}
