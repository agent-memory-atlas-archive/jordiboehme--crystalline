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

/// The address of an engram in the second domain `scotty`.
const TEAM: &str = "crystalline://scotty/team/scotty-team";

/// `eng` with Reflection on and its deploy runbook, beside `scotty` with
/// three engrams a page of `eng` can cite.
pub async fn crossing() -> Fx {
    crate::fixture::beside(
        &[(
            "runbooks/deploy.md",
            &crate::fixture::engram("Deploy", "runbooks/deploy", "- [fact] deploys run at night"),
        )],
        "scotty",
        &[
            (
                "team/scotty-team.md",
                &crate::fixture::engram("Scotty team", "team/scotty-team", "- [fact] five people"),
            ),
            (
                "team/rota.md",
                &crate::fixture::engram("Rota", "team/rota", "- [fact] weekly"),
            ),
            (
                "team/pager.md",
                &crate::fixture::engram("Pager", "team/pager", "- [fact] one pager"),
            ),
        ],
    )
    .await
}

fn sources_by_heading(doc: &serde_json::Value, heading: &str) -> serde_json::Value {
    doc["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["heading"] == heading)
        .unwrap()["sources"]
        .clone()
}

/// A source in another domain is named by its address, keyed by heading or
/// by id. It is stored with the domain's name and read in its own domain;
/// an address of the page's own domain is the bare permalink, and one
/// engram named both ways is one source.
#[tokio::test]
async fn a_source_in_another_domain_is_named_by_its_address() {
    let fx = crossing().await;
    let mut p = write(
        "overview.md",
        "# Overview\n\nFor people.\n\n## Team\n\nFive people.\n\n## Deploys\n\nAt night.\n",
    );
    p.sources = BTreeMap::from([
        ("Team".to_string(), vec![TEAM.to_string()]),
        (
            "Deploys".to_string(),
            vec![
                "runbooks/deploy".to_string(),
                "crystalline://eng/runbooks/deploy".to_string(),
            ],
        ),
    ]);
    let written = fx.engine.write_reflection(&p, &agent()).await.unwrap();
    assert_eq!(written["curated"], true, "{written}");
    let doc = fx
        .engine
        .read_reflection("eng", "overview.md", &agent())
        .await
        .unwrap();
    assert_eq!(
        sources_by_heading(&doc, "Team"),
        serde_json::json!([{ "permalink": "team/scotty-team", "domain": "scotty",
            "title": "Scotty team", "state": "current" }]),
        "{doc}"
    );
    assert_eq!(
        sources_by_heading(&doc, "Deploys"),
        serde_json::json!([{ "permalink": "runbooks/deploy", "title": "Deploy",
            "state": "current" }]),
        "{doc}"
    );
    let stored = std::fs::read_to_string(fx.root.join("reflections/overview.md")).unwrap();
    assert_eq!(stored.matches("domain: scotty").count(), 1, "{stored}");
    assert!(!stored.contains("domain: eng"), "{stored}");

    // By id: the section's sources are replaced, again by address.
    let team_id = doc["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["heading"] == "Team")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let mut by_id = crystalline_service::params::WriteReflectionParams {
        domain: "eng".into(),
        path: "overview.md".into(),
        ..Default::default()
    };
    by_id.sources = BTreeMap::from([(team_id, vec!["crystalline://scotty/team/rota".to_string()])]);
    fx.engine.write_reflection(&by_id, &agent()).await.unwrap();
    let doc = fx
        .engine
        .read_reflection("eng", "overview.md", &agent())
        .await
        .unwrap();
    assert_eq!(
        sources_by_heading(&doc, "Team")[0]["permalink"],
        "team/rota",
        "{doc}"
    );
}

/// An engram the other domain lacks is refused by its address, and an
/// address that names no single engram is refused with what a source is.
/// Nothing is written either way.
#[tokio::test]
async fn a_source_another_domain_lacks_is_refused_by_its_address() {
    let fx = crossing().await;
    for (source, words) in [
        (
            "crystalline://scotty/team/nobody",
            "no engram 'crystalline://scotty/team/nobody' to name as a source",
        ),
        ("crystalline://scotty/team/*", "a source is one engram"),
        ("crystalline://scotty", "a source is one engram"),
    ] {
        let mut p = write("b.md", "# B\n\nFor people.\n\n## Only\n\nText.\n");
        p.sources = BTreeMap::from([("Only".to_string(), vec![source.to_string()])]);
        let err = fx
            .engine
            .write_reflection(&p, &agent())
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains(words), "{source}: {err}");
        assert!(!exists(&fx, "b.md"), "{source}");
    }
}
