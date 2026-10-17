//! The reflect queue.

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};

use crystalline_service::ReflectionCaller;
use crystalline_service::params::{DiscussParams, ReflectParams};

use crate::docs::{agent, person, write};
use crate::fixture::{Fx, engram, fixture, manifest};

async fn curated(extra: &[(&str, &str)]) -> Fx {
    let mut files = vec![
        ("MANIFEST.md", manifest("reflection: on\n")),
        (
            "runbooks/deploy.md",
            engram("Deploy", "runbooks/deploy", "- [fact] deploys run at night"),
        ),
        (
            "runbooks/rollback.md",
            engram(
                "Rollback",
                "runbooks/rollback",
                "- [fact] roll back with the script",
            ),
        ),
    ];
    files.extend(extra.iter().map(|(p, c)| (*p, c.to_string())));
    let refs: Vec<(&str, &str)> = files.iter().map(|(p, c)| (*p, c.as_str())).collect();
    let fx = fixture(&refs).await;
    let mut p = write(
        "guides/deploying.md",
        "# Deploying\n\n## Night deploys\n\nDeploys run at night.\n\n## Rollback\n\nRoll back with the script.\n",
    );
    // `_top` with no sources curates the title and intro too, so the queue
    // starts empty.
    p.sources = BTreeMap::from([
        ("_top".to_string(), Vec::new()),
        (
            "Night deploys".to_string(),
            vec!["runbooks/deploy".to_string()],
        ),
        (
            "Rollback".to_string(),
            vec!["runbooks/rollback".to_string()],
        ),
    ]);
    fx.engine.write_reflection(&p, &agent()).await.unwrap();
    if extra.is_empty() {
        let empty = fx
            .engine
            .reflect(&ReflectParams::default(), &agent())
            .await
            .unwrap();
        assert_eq!(
            empty["total"], 0,
            "a freshly curated reflection owes nothing: {empty}"
        );
    }
    fx
}

/// A curated reflection with one person's change waiting as a feedback item.
pub async fn curated_with_a_feedback_item() -> Fx {
    let fx = curated(&[]).await;
    let text = edit_page(&fx, "Deploys run at night.", "Deploys run at dawn.");
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();
    fx
}

fn age_file(fx: &Fx, rel: &str, days: u64) {
    let file = std::fs::File::options()
        .write(true)
        .open(fx.root.join(rel))
        .unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(days * 86_400))
        .unwrap();
}

fn rows(queue: &serde_json::Value) -> Vec<(String, String, String)> {
    queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["kind"].as_str().unwrap().into(),
                r["what"].as_str().unwrap().into(),
                r["heading"].as_str().unwrap_or("").into(),
            )
        })
        .collect()
}

fn edit_page(fx: &Fx, from: &str, to: &str) -> String {
    let path = fx.root.join("reflections/guides/deploying.md");
    std::fs::read_to_string(&path).unwrap().replace(from, to)
}

#[tokio::test]
async fn feedback_comes_before_update_within_a_section_and_the_oldest_group_first() {
    let fx = curated(&[]).await;
    // The engram behind Night deploys changed ten days ago.
    std::fs::write(
        fx.root.join("runbooks/deploy.md"),
        engram(
            "Deploy",
            "runbooks/deploy",
            "- [fact] deploys run in the evening",
        ),
    )
    .unwrap();
    age_file(&fx, "runbooks/deploy.md", 10);
    fx.engine.sync(None).await.unwrap();
    // A person changed both sections just now.
    let text = edit_page(
        &fx,
        "Deploys run at night.",
        "Deploys run at night, after the batch.",
    );
    let text = text.replace(
        "Roll back with the script.",
        "Roll back with the new script.",
    );
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();

    let queue = fx
        .engine
        .reflect(&ReflectParams::default(), &agent())
        .await
        .unwrap();
    assert_eq!(
        rows(&queue),
        [
            ("feedback".into(), "changed".into(), "Night deploys".into()),
            (
                "update".into(),
                "source_changed".into(),
                "Night deploys".into()
            ),
            ("feedback".into(), "changed".into(), "Rollback".into()),
        ],
        "{queue}"
    );
    assert!(
        queue["queue"][0]["diff"]
            .as_str()
            .unwrap()
            .contains("+Deploys run at night, after the batch.")
    );
    assert_eq!(queue["queue"][0]["changed_by"][0], "jordi");
    assert!(queue["queue"][1]["age_secs"].as_i64().unwrap() >= 9 * 86_400);
}

#[tokio::test]
async fn every_update_trigger() {
    let pact = "# Pact\n\n## Structure\n\n- guides/*.md\n";
    let fx = curated(&[(
        "notes/loose.md",
        &engram("Loose", "notes/loose", "- [fact] nobody reflected this"),
    )])
    .await;
    fx.engine
        .write_reflection(&write("PACT.md", pact), &agent())
        .await
        .unwrap();
    let pact_ids: Vec<String> = crystalline_core::reflection::split_sections(
        &std::fs::read_to_string(fx.root.join("reflections/PACT.md")).unwrap(),
    )
    .into_iter()
    .filter_map(|s| s.id)
    .collect();
    fx.engine
        .settle_reflection("eng", "PACT.md", &pact_ids, "kept", &agent())
        .await
        .unwrap();
    // Retire one source, change nothing about the other yet.
    std::fs::write(
        fx.root.join("runbooks/rollback.md"),
        engram(
            "Rollback",
            "runbooks/rollback",
            "- [fact] roll back with the script",
        )
        .replace("status: stable", "status: deprecated"),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    // A page off the structure, and a change to the pact.
    fx.engine
        .write_reflection(&write("misc/stray.md", "# Stray\n"), &person())
        .await
        .unwrap();
    let edited_pact = std::fs::read_to_string(fx.root.join("reflections/PACT.md")).unwrap()
        + "\n## Audience\n\nNew people.\n";
    fx.engine
        .write_reflection(&write("PACT.md", &edited_pact), &person())
        .await
        .unwrap();

    let queue = fx
        .engine
        .reflect(
            &ReflectParams {
                kinds: vec!["update".into()],
                ..Default::default()
            },
            &agent(),
        )
        .await
        .unwrap();
    let whats: Vec<String> = rows(&queue).into_iter().map(|(_, w, _)| w).collect();
    for want in [
        "source_retired",
        "unreflected",
        "off_structure",
        "pact_changed",
    ] {
        assert!(whats.contains(&want.to_string()), "{want} missing: {queue}");
    }
    let unreflected = queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["what"] == "unreflected")
        .unwrap();
    assert_eq!(unreflected["folder"], "notes");
    assert_eq!(unreflected["engrams"][0], "notes/loose");
    let pact_changed = queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["what"] == "pact_changed")
        .unwrap();
    let diff = pact_changed["diff"].as_str().unwrap();
    assert!(diff.contains("+## Audience"), "{diff}");
    assert!(
        !diff.contains("-# Pact") && !diff.contains("-## Structure"),
        "only the added section is a hunk: {diff}"
    );
}

/// The home's summary counts what the review's queue counts, on a domain
/// that owes every kind of work at once: a person's edit (feedback), a
/// changed and a retired source, a page off the pact's structure, a pact
/// edit, an unreflected engram and an open thread. `updates` is the queue's
/// `kinds.update`, and `pages_to_update` the distinct pages of those rows.
#[tokio::test]
async fn the_summary_counts_the_updates_the_review_queues() {
    let pact = "# Pact\n\n## Structure\n\n- guides/*.md\n";
    let fx = curated(&[(
        "notes/loose.md",
        &engram("Loose", "notes/loose", "- [fact] nobody reflected this"),
    )])
    .await;
    fx.engine
        .write_reflection(&write("PACT.md", pact), &agent())
        .await
        .unwrap();
    let pact_ids: Vec<String> = crystalline_core::reflection::split_sections(
        &std::fs::read_to_string(fx.root.join("reflections/PACT.md")).unwrap(),
    )
    .into_iter()
    .filter_map(|s| s.id)
    .collect();
    fx.engine
        .settle_reflection("eng", "PACT.md", &pact_ids, "kept", &agent())
        .await
        .unwrap();
    // One source changes, the other retires.
    std::fs::write(
        fx.root.join("runbooks/deploy.md"),
        engram("Deploy", "runbooks/deploy", "- [fact] deploys run at dawn"),
    )
    .unwrap();
    std::fs::write(
        fx.root.join("runbooks/rollback.md"),
        engram(
            "Rollback",
            "runbooks/rollback",
            "- [fact] roll back with the script",
        )
        .replace("status: stable", "status: deprecated"),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    // A person's edit of the page, a page off the structure, a pact edit.
    let page = std::fs::read_to_string(fx.root.join("reflections/guides/deploying.md"))
        .unwrap()
        .replace(
            "Deploys run at night.",
            "Deploys run at night, after the batch.",
        );
    fx.engine
        .write_reflection(&write("guides/deploying.md", &page), &person())
        .await
        .unwrap();
    fx.engine
        .write_reflection(&write("misc/stray.md", "# Stray\n"), &person())
        .await
        .unwrap();
    let edited_pact = std::fs::read_to_string(fx.root.join("reflections/PACT.md")).unwrap()
        + "\n## Audience\n\nNew people.\n";
    fx.engine
        .write_reflection(&write("PACT.md", &edited_pact), &person())
        .await
        .unwrap();
    fx.engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                path: Some("guides/deploying.md".into()),
                section: Some("Rollback".into()),
                text: Some("Which script?".into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();

    for caller in [agent(), person()] {
        let review = fx.engine.reflection_review("eng", &caller).await.unwrap();
        let summary = fx.engine.reflection_summary("eng", &caller).await.unwrap();
        let rows = review["queue"]["queue"].as_array().unwrap();
        let whats: Vec<&str> = rows.iter().filter_map(|r| r["what"].as_str()).collect();
        for want in [
            "changed",
            "source_changed",
            "source_retired",
            "off_structure",
            "pact_changed",
            "unreflected",
            "thread",
        ] {
            assert!(whats.contains(&want), "{want} missing: {review}");
        }
        assert_eq!(
            rows.len() as u64,
            review["queue"]["total"].as_u64().unwrap(),
            "one page holds the whole queue"
        );
        let mut pages: Vec<&str> = rows
            .iter()
            .filter(|r| r["kind"] == "update")
            .filter_map(|r| r["path"].as_str())
            .filter(|p| !p.is_empty())
            .collect();
        pages.sort_unstable();
        pages.dedup();
        assert_eq!(
            pages,
            ["PACT.md", "guides/deploying.md", "misc/stray.md"],
            "{review}"
        );
        assert_eq!(
            summary["updates"], review["queue"]["kinds"]["update"],
            "{summary}"
        );
        assert_eq!(summary["pages_to_update"], pages.len(), "{summary}");
        assert_eq!(summary["waiting_for_the_agent"], 1, "{summary}");
    }
}

#[tokio::test]
async fn a_deleted_source_is_an_update_item_not_an_error() {
    let fx = curated(&[]).await;
    std::fs::remove_file(fx.root.join("runbooks/deploy.md")).unwrap();
    fx.engine.sync(None).await.unwrap();
    let queue = fx
        .engine
        .reflect(&ReflectParams::default(), &agent())
        .await
        .unwrap();
    let missing = queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["what"] == "source_missing")
        .expect("reported");
    assert_eq!(missing["heading"], "Night deploys");
    assert_eq!(missing["sources"][0]["state"], "missing");
    let doc = fx
        .engine
        .read_reflection("eng", "guides/deploying.md", &agent())
        .await
        .unwrap();
    assert_eq!(
        doc["sections"][0]["sources"][0]["state"], "missing",
        "the read does not fail either"
    );
}

#[tokio::test]
async fn a_section_added_in_a_plain_editor_is_a_feedback_item_addressed_by_heading() {
    let fx = curated(&[]).await;
    let path = fx.root.join("reflections/guides/deploying.md");
    let text = std::fs::read_to_string(&path).unwrap()
        + "\n## Typed by hand\n\nA person wrote this outside Crystalline.\n";
    std::fs::write(&path, text).unwrap();
    fx.engine.sync(None).await.unwrap();
    let queue = fx
        .engine
        .reflect(
            &ReflectParams {
                kinds: vec!["feedback".into()],
                ..Default::default()
            },
            &agent(),
        )
        .await
        .unwrap();
    let item = queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["heading"] == "Typed by hand")
        .expect("reported");
    assert_eq!(item["what"], "new");
    assert!(item["section"].is_null(), "no id yet: addressed by heading");
    assert_eq!(
        item["changed_by"].as_array().unwrap().len(),
        0,
        "written outside Crystalline"
    );
}

/// A thread a person opens on a heading with no id anchors on the heading;
/// its review item joins the feedback item of that section, both addressed
/// by heading.
#[tokio::test]
async fn a_thread_on_a_heading_without_an_id_joins_that_sections_group() {
    let fx = curated(&[]).await;
    let path = fx.root.join("reflections/guides/deploying.md");
    let text = std::fs::read_to_string(&path).unwrap()
        + "\n## Typed by hand\n\nA person wrote this outside Crystalline.\n";
    std::fs::write(&path, text).unwrap();
    fx.engine.sync(None).await.unwrap();
    fx.engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                path: Some("guides/deploying.md".into()),
                section: Some("Typed by hand".into()),
                text: Some("Who wrote this?".into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();
    let queue = fx
        .engine
        .reflect(&ReflectParams::default(), &agent())
        .await
        .unwrap();
    assert_eq!(
        rows(&queue),
        [
            ("feedback".into(), "new".into(), "Typed by hand".into()),
            ("review".into(), "thread".into(), "Typed by hand".into()),
        ],
        "{queue}"
    );
    assert!(queue["queue"][1]["section"].is_null(), "{queue}");
    let counts = fx.engine.reflect_open_counts(&[], &agent()).await.unwrap();
    assert_eq!(counts, vec![("eng".to_string(), 2)]);
    let review = fx.engine.reflection_review("eng", &agent()).await.unwrap();
    let waiting = &review["waiting_for_the_agent"][0]["threads"][0];
    assert_eq!(waiting["anchor"]["section"], "Typed by hand", "{review}");
    assert_eq!(waiting["anchor"]["state"], "found", "{review}");
}

#[tokio::test]
async fn an_answered_feedback_item_waits_while_its_thread_is_open() {
    let fx = curated(&[]).await;
    let text = edit_page(&fx, "Deploys run at night.", "Deploys run at dawn.");
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();
    let id = crystalline_core::reflection::split_sections(&text)[1]
        .id
        .clone()
        .unwrap();
    let before = fx
        .engine
        .reflect(
            &ReflectParams {
                kinds: vec!["feedback".into()],
                ..Default::default()
            },
            &agent(),
        )
        .await
        .unwrap();
    assert_eq!(before["total"], 1);
    let opened = fx
        .engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                path: Some("guides/deploying.md".into()),
                section: Some(id),
                text: Some("Dawn? The batch still runs at night.".into()),
                answers_feedback: true,
                ..Default::default()
            },
            &agent(),
        )
        .await
        .unwrap();
    let after = fx
        .engine
        .reflect(
            &ReflectParams {
                kinds: vec!["feedback".into()],
                ..Default::default()
            },
            &agent(),
        )
        .await
        .unwrap();
    assert_eq!(after["total"], 0, "answered, waiting on people");
    let review = fx.engine.reflection_review("eng", &agent()).await.unwrap();
    assert_eq!(
        review["waiting_for_people"][0]["threads"][0]["id"],
        opened["id"]
    );
    assert!(
        review["waiting_for_the_agent"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn the_queue_strips_engram_names_for_a_caller_who_cannot_read_engrams() {
    let (fx, ann) = crate::rights::contributor_engine().await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    let mut p = write("a.md", "# A\n\n## Night\n\nDeploys run at night.\n");
    p.sources = BTreeMap::from([("Night".to_string(), vec!["runbooks/deploy".to_string()])]);
    fx.engine
        .write_reflection(&p, &ReflectionCaller::owner())
        .await
        .unwrap();
    std::fs::write(
        fx.root.join("runbooks/deploy.md"),
        engram("Deploy", "runbooks/deploy", "- [fact] evening"),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    let queue = fx
        .engine
        .reflect_queue("eng", None, None, &ReflectionCaller::person(ann, "ann"))
        .await
        .unwrap();
    let text = queue.to_string();
    assert!(queue["total"].as_u64().unwrap() >= 1);
    assert!(
        !text.contains("runbooks/deploy"),
        "no engram name reaches a contributor: {text}"
    );
}

#[tokio::test]
async fn open_counts_name_only_the_domains_the_caller_curates() {
    let fx = curated(&[]).await;
    let text = edit_page(&fx, "Deploys run at night.", "Deploys run at dawn.");
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();
    let counts = fx.engine.reflect_open_counts(&[], &agent()).await.unwrap();
    assert_eq!(counts, vec![("eng".to_string(), 1)]);
    // A caller who may read the Reflection but not curate it gets no count.
    let (fx, ann) = crate::rights::contributor_engine().await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    fx.engine
        .write_reflection(
            &write("a.md", "# A\n\n## Night\n\nDeploys run at night.\n"),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap();
    let reader = ReflectionCaller::person(ann, "ann");
    assert!(
        fx.engine
            .reflect_queue("eng", None, None, &reader)
            .await
            .unwrap()["total"]
            .as_u64()
            .unwrap()
            >= 1,
        "the reader sees the queue"
    );
    assert!(
        fx.engine
            .reflect_open_counts(&[], &reader)
            .await
            .unwrap()
            .is_empty(),
        "and is not nudged"
    );
}

#[tokio::test]
async fn an_unnamed_queue_leaves_a_read_only_domain_out() {
    let fx = crate::docs::reflecting().await;
    std::fs::write(
        fx.root.join("MANIFEST.md"),
        crate::fixture::manifest("reflection: on\nread_only: on\n"),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    let unnamed = fx
        .engine
        .reflect(&ReflectParams::default(), &crate::docs::agent())
        .await
        .unwrap();
    assert_eq!(
        unnamed["scope"]["domains"],
        serde_json::json!([]),
        "{unnamed}"
    );
    let named = ReflectParams {
        domains: vec!["eng".into()],
        ..Default::default()
    };
    let named = fx
        .engine
        .reflect(&named, &crate::docs::agent())
        .await
        .unwrap();
    assert_eq!(
        named["scope"]["domains"],
        serde_json::json!(["eng"]),
        "a named domain still answers"
    );
}

/// While `reflection: on` waits for `reflections/` to empty, the write
/// receipt's close-folder hint never names that folder.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_close_folder_hint_leaves_the_reflections_folder_alone() {
    let fx = fixture(&[
        (
            "reflections/kept.md",
            &engram("Kept", "reflections/kept", "- [fact] still an engram"),
        ),
        (
            "reflections/also.md",
            &engram("Also", "reflections/also", "- [fact] another engram"),
        ),
    ])
    .await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap().word(),
        "pending"
    );
    let agent = crystalline_remote::ForwardedAgent::default();
    let receipt = crystalline_service::route::run_tool_routed(
        &fx.engine,
        "write_engram",
        serde_json::json!({
            "domain": "eng",
            "title": "Stray",
            "folder": "reflection",
            "content": "A fact about the topic.",
        }),
        &agent,
        None,
    )
    .await
    .unwrap();
    assert_eq!(receipt["action"], "created", "{receipt}");
    assert!(
        !receipt.to_string().contains("\"folder\":\"reflections\""),
        "{receipt}"
    );
    assert!(receipt.get("close_folders").is_none(), "{receipt}");
}

/// Evolve fills `reflection_pending` from the MANIFEST, so V112 stops pairing
/// `reflections/` with its close sibling once the switch is on and pending.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn evolve_leaves_the_pending_reflections_folder_out_of_v112() {
    let fx = fixture(&[
        (
            "reflections/kept.md",
            &engram("Kept", "reflections/kept", "- [fact] still an engram"),
        ),
        (
            "reflection/stray.md",
            &engram("Stray", "reflection/stray", "- [fact] close by"),
        ),
        (
            "reflection/other.md",
            &engram("Other", "reflection/other", "- [fact] close by too"),
        ),
    ])
    .await;
    let v112 = || crystalline_service::params::EvolveParams {
        domains: vec!["eng".to_string()],
        rules: vec!["V112".to_string()],
        ..Default::default()
    };
    let before = fx
        .engine
        .evolve_detect(&v112(), &crystalline_service::Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(
        before["queue"].as_array().unwrap().len(),
        1,
        "an ordinary pair while the switch is off: {before}"
    );
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    let after = fx
        .engine
        .evolve_detect(&v112(), &crystalline_service::Scope::Unrestricted)
        .await
        .unwrap();
    assert!(after["queue"].as_array().unwrap().is_empty(), "{after}");
}

/// A domain whose queue cannot be read is left out of an unnamed queue and
/// of the counts, and named in the answer; named, it is the caller's error.
#[tokio::test]
async fn an_unreadable_domain_never_fails_the_unnamed_queue_or_the_counts() {
    let fx = curated(&[]).await;
    let text = edit_page(&fx, "Deploys run at night.", "Deploys run at dawn.");
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();
    // A threads "file" that is a folder: reading it fails.
    std::fs::create_dir_all(fx.root.join("reflections/guides/deploying.threads.md")).unwrap();
    let unnamed = fx
        .engine
        .reflect(&ReflectParams::default(), &agent())
        .await
        .unwrap();
    assert_eq!(unnamed["total"], 0, "{unnamed}");
    assert_eq!(
        unnamed["scope"]["domains"],
        serde_json::json!([]),
        "{unnamed}"
    );
    assert_eq!(
        unnamed["scope"]["unreadable"],
        serde_json::json!(["eng"]),
        "{unnamed}"
    );
    let named = ReflectParams {
        domains: vec!["eng".into()],
        ..Default::default()
    };
    assert!(fx.engine.reflect(&named, &agent()).await.is_err());
    assert!(
        fx.engine
            .reflect_open_counts(&[], &agent())
            .await
            .unwrap()
            .is_empty()
    );
}

/// `skip_unavailable` screens named domains as the unnamed queue screens
/// every domain: an unreadable one is named, an unregistered name is left
/// out, and neither fails the queue.
#[tokio::test]
async fn a_lenient_named_queue_names_an_unreadable_domain_and_skips_an_unknown_one() {
    let fx = curated(&[]).await;
    let text = edit_page(&fx, "Deploys run at night.", "Deploys run at dawn.");
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();
    std::fs::create_dir_all(fx.root.join("reflections/guides/deploying.threads.md")).unwrap();
    let lenient = ReflectParams {
        domains: vec!["eng".into(), "nowhere".into()],
        skip_unavailable: true,
        ..Default::default()
    };
    let queue = fx.engine.reflect(&lenient, &agent()).await.unwrap();
    assert_eq!(queue["total"], 0, "{queue}");
    assert_eq!(
        queue["scope"]["unreadable"],
        serde_json::json!(["eng"]),
        "{queue}"
    );
}

/// A whole queue carries no `unreadable` member.
#[tokio::test]
async fn a_readable_scope_names_nothing_unreadable() {
    let fx = curated(&[]).await;
    let queue = fx
        .engine
        .reflect(&ReflectParams::default(), &agent())
        .await
        .unwrap();
    assert!(queue["scope"].get("unreadable").is_none(), "{queue}");
}

#[tokio::test]
async fn a_domain_named_twice_is_swept_once() {
    let fx = curated(&[]).await;
    let text = edit_page(&fx, "Deploys run at night.", "Deploys run at dawn.");
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();
    let twice = ReflectParams {
        domains: vec!["eng".into(), "eng".into()],
        ..Default::default()
    };
    let queue = fx.engine.reflect(&twice, &agent()).await.unwrap();
    assert_eq!(queue["total"], 1, "{queue}");
    assert_eq!(
        queue["scope"]["domains"],
        serde_json::json!(["eng"]),
        "{queue}"
    );
    let counts = fx
        .engine
        .reflect_open_counts(&["eng".to_string(), "eng".to_string()], &agent())
        .await
        .unwrap();
    assert_eq!(counts, vec![("eng".to_string(), 1)]);
}

/// The write list caps the Reflection at read (R18): an editor off the list
/// sees the queue and is not nudged; one with no list is.
#[tokio::test]
async fn an_off_list_curator_gets_no_count() {
    use std::sync::Arc;

    use crystalline_service::rest::{AuthStore, Role};
    use crystalline_service::{DomainAccess, Scope};

    let fx = curated(&[]).await;
    let text = edit_page(&fx, "Deploys run at night.", "Deploys run at dawn.");
    fx.engine
        .write_reflection(&write("guides/deploying.md", &text), &person())
        .await
        .unwrap();
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    for name in ["ed", "lee"] {
        auth.add_user(name, name, None, Role::Editor, "pw12345678")
            .await
            .unwrap();
    }
    auth.set_write_list("ed", &["agents-*".to_string()])
        .await
        .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth)));
    let as_user = |name: &str| {
        ReflectionCaller::agent(
            Scope::User {
                account: name.into(),
                admin: false,
            },
            name,
            false,
        )
    };
    let ed = as_user("ed");
    assert_eq!(
        fx.engine
            .reflect_queue("eng", None, None, &ed)
            .await
            .unwrap()["total"],
        1,
        "the off-list editor still reads the queue"
    );
    assert!(
        fx.engine
            .reflect_open_counts(&[], &ed)
            .await
            .unwrap()
            .is_empty(),
        "and is not nudged"
    );
    assert_eq!(
        fx.engine
            .reflect_open_counts(&[], &as_user("lee"))
            .await
            .unwrap(),
        vec![("eng".to_string(), 1)],
        "an editor with no list curates and is nudged"
    );
}

/// A domain whose Reflection is pending is named in an unnamed queue's
/// `scope.pending` (and left out of the queue); named, it still refuses.
#[tokio::test]
async fn a_pending_reflection_is_named_in_the_unnamed_queue() {
    let fx = fixture(&[
        ("MANIFEST.md", &manifest("reflection: on\n")),
        (
            "reflections/old.md",
            &engram("Old", "reflections/old", "- [fact] still an engram"),
        ),
    ])
    .await;
    let unnamed = fx
        .engine
        .reflect(&ReflectParams::default(), &agent())
        .await
        .unwrap();
    assert_eq!(
        unnamed["scope"]["pending"],
        serde_json::json!(["eng"]),
        "{unnamed}"
    );
    assert_eq!(
        unnamed["scope"]["domains"],
        serde_json::json!([]),
        "{unnamed}"
    );
    assert!(unnamed["scope"].get("unreadable").is_none(), "{unnamed}");
    let named = ReflectParams {
        domains: vec!["eng".into()],
        ..Default::default()
    };
    let err = fx
        .engine
        .reflect(&named, &agent())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("reflections/"), "{err}");
}

/// A queue with nothing pending carries no `pending` member.
#[tokio::test]
async fn a_queue_with_nothing_pending_names_nothing_pending() {
    let fx = curated(&[]).await;
    let queue = fx
        .engine
        .reflect(&ReflectParams::default(), &agent())
        .await
        .unwrap();
    assert!(queue["scope"].get("pending").is_none(), "{queue}");
}

/// The cost of the Reflection home's summary against the full review on a
/// large domain: 5,000 engrams, 200 pages of four sections each citing two
/// engrams, 400 cited engrams changed since, 100 pages edited by a person
/// and 400 open threads. Never a gate: the numbers depend on the machine and
/// go into the task report. Run with
/// `cargo nextest run -p crystalline-service --test reflection --run-ignored only reflection_summary_timing --no-capture`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "timing evidence for the task report, not a gate"]
async fn reflection_summary_timing() {
    use std::time::Instant;

    const ENGRAMS: usize = 5_000;
    const PAGES: usize = 200;
    const SECTIONS: usize = 4;
    const RUNS: usize = 15;

    let note = |i: usize, body: &str| engram(&format!("Note {i}"), &format!("note-{i}"), body);
    let mut files: Vec<(String, String)> =
        vec![("MANIFEST.md".into(), manifest("reflection: on\n"))];
    for i in 0..ENGRAMS {
        files.push((
            format!("notes/d{}/n{i}.md", i % 50),
            note(i, "- [fact] a note"),
        ));
    }
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(p, c)| (p.as_str(), c.as_str()))
        .collect();
    let built = Instant::now();
    let fx = fixture(&refs).await;

    let section =
        |p: usize, s: usize, text: &str| format!("## Part {s}\n\n{text} of page {p}.\n\n");
    for p in 0..PAGES {
        let mut markdown = format!("# Page {p}\n\nFor people.\n\n");
        let mut sources = BTreeMap::from([("_top".to_string(), Vec::new())]);
        for s in 0..SECTIONS {
            markdown.push_str(&section(p, s, "What the agent wrote"));
            let first = (p * SECTIONS + s) * 2 % ENGRAMS;
            sources.insert(
                format!("Part {s}"),
                vec![format!("note-{first}"), format!("note-{}", first + 1)],
            );
        }
        let mut params = write(&format!("area{}/page{p}.md", p % 10), &markdown);
        params.sources = sources;
        fx.engine.write_reflection(&params, &agent()).await.unwrap();
    }
    // 400 cited engrams change after they were reflected.
    for i in 0..400 {
        std::fs::write(
            fx.root.join(format!("notes/d{}/n{i}.md", i % 50)),
            note(i, "- [fact] a changed note"),
        )
        .unwrap();
    }
    fx.engine.sync(None).await.unwrap();
    // 100 pages edited by a person: every section differs from its baseline.
    for p in 0..100 {
        let path = format!("area{}/page{p}.md", p % 10);
        let doc = fx
            .engine
            .read_reflection("eng", &path, &person())
            .await
            .unwrap();
        let edited = doc["markdown"]
            .as_str()
            .unwrap()
            .replace("What the agent wrote", "What a person rewrote");
        fx.engine
            .write_reflection(&write(&path, &edited), &person())
            .await
            .unwrap();
    }
    // 400 open threads, two on each of the first 200 pages' first section.
    for t in 0..400 {
        let p = t % PAGES;
        fx.engine
            .discuss(
                &DiscussParams {
                    domain: "eng".into(),
                    path: Some(format!("area{}/page{p}.md", p % 10)),
                    section: Some("Part 0".into()),
                    text: Some(format!("Question {t}?")),
                    ..Default::default()
                },
                &person(),
            )
            .await
            .unwrap();
    }
    eprintln!("seeded in {:?}", built.elapsed());

    let caller = person();
    let review = fx.engine.reflection_review("eng", &caller).await.unwrap();
    let summary = fx.engine.reflection_summary("eng", &caller).await.unwrap();
    assert_eq!(summary["updates"], review["queue"]["kinds"]["update"]);
    assert_eq!(summary["waiting_for_the_agent"], 400);
    eprintln!(
        "queue: {} (update {} on {} pages, feedback {}); payload bytes: review {}, summary {}",
        review["queue"]["total"],
        review["queue"]["kinds"]["update"],
        summary["pages_to_update"],
        review["queue"]["kinds"]["feedback"],
        review.to_string().len(),
        summary.to_string().len(),
    );

    let median = |mut times: Vec<std::time::Duration>| {
        times.sort();
        times[times.len() / 2]
    };
    let mut review_times = Vec::new();
    let mut summary_times = Vec::new();
    for _ in 0..RUNS {
        let started = Instant::now();
        let v = fx.engine.reflection_review("eng", &caller).await.unwrap();
        let _ = v.to_string();
        review_times.push(started.elapsed());
        let started = Instant::now();
        let v = fx.engine.reflection_summary("eng", &caller).await.unwrap();
        let _ = v.to_string();
        summary_times.push(started.elapsed());
    }
    eprintln!(
        "median of {RUNS}: review {:?}, summary {:?}",
        median(review_times),
        median(summary_times)
    );
}
