//! Threads through the engine.

use crystalline_service::ReflectionCaller;
use crystalline_service::params::DiscussParams;

use crate::docs::{agent, person, write};
use crate::fixture::manifest;
use crate::rights::viewer_engine;

const PAGE: &str = "# D\n\n## Night deploys\n<!-- r:aaaa1111 -->\n\nDeploys run at night.\n\n## Typed by hand\n\nNo id yet.\n";

fn open(section: &str, quote: Option<&str>, text: &str) -> DiscussParams {
    DiscussParams {
        domain: "eng".into(),
        action: Some("open".into()),
        path: Some("d.md".into()),
        section: Some(section.into()),
        quote: quote.map(str::to_string),
        text: Some(text.into()),
        ..Default::default()
    }
}

fn step(action: &str, id: &str, text: &str) -> DiscussParams {
    DiscussParams {
        domain: "eng".into(),
        action: Some(action.into()),
        path: Some("d.md".into()),
        thread: Some(id.into()),
        text: Some(text.into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn a_viewer_opens_answers_resolves_and_reopens() {
    let (fx, vera) = viewer_engine(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    let viewer = ReflectionCaller::person(vera, "vera");
    let opened = fx
        .engine
        .discuss(
            &open("aaaa1111", Some("run at night"), "Still true?"),
            &viewer,
        )
        .await
        .unwrap();
    let id = opened["id"].as_str().unwrap().to_string();
    assert_eq!(opened["waiting_on"], "agent");
    assert_eq!(opened["anchor"]["state"], "found");
    let answered = fx
        .engine
        .discuss(&step("answer", &id, "Yes, still true."), &agent())
        .await
        .unwrap();
    assert_eq!(answered["waiting_on"], "people");
    let empty = fx
        .engine
        .discuss(&step("resolve", &id, "  "), &viewer)
        .await
        .unwrap_err();
    assert!(
        matches!(empty, crystalline_service::EngineError::Invalid(_)),
        "a resolve needs its outcome: {empty:?}"
    );
    fx.engine
        .discuss(&step("resolve", &id, "Confirmed."), &viewer)
        .await
        .unwrap();
    let reopened = fx
        .engine
        .discuss(&step("reopen", &id, "It changed again."), &viewer)
        .await
        .unwrap();
    assert_eq!(reopened["status"], "open");
    assert_eq!(
        reopened["entries"].as_array().unwrap().len(),
        4,
        "the reopen is a visible entry"
    );
    let listed = fx
        .engine
        .list_reflection_threads("eng", None, "all", &viewer)
        .await
        .unwrap();
    assert_eq!(listed["threads"].as_array().unwrap().len(), 1);
}

/// The anonymous visitor of a public domain reads the threads and writes none.
#[tokio::test]
async fn an_anonymous_visitor_reads_threads_and_cannot_comment() {
    let (fx, vera) = viewer_engine(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    let opened = fx
        .engine
        .discuss(
            &open("aaaa1111", None, "Still true?"),
            &ReflectionCaller::person(vera, "vera"),
        )
        .await
        .unwrap();
    let id = opened["id"].as_str().unwrap().to_string();
    let anonymous = ReflectionCaller::person(crystalline_service::Scope::Anonymous, "anonymous");
    let listed = fx
        .engine
        .list_reflection_threads("eng", None, "open", &anonymous)
        .await
        .unwrap();
    assert_eq!(listed["threads"].as_array().unwrap().len(), 1, "it reads");
    for p in [
        open("aaaa1111", None, "Hello?"),
        step("answer", &id, "Me too."),
    ] {
        let err = fx
            .engine
            .discuss(&p, &anonymous)
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("sign in to comment"), "{err}");
    }
}

#[tokio::test]
async fn a_thread_on_a_heading_without_an_id_gives_it_one() {
    let fx = crate::docs::reflecting().await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    // A plain editor adds a heading after the write.
    let path = fx.root.join("reflections/d.md");
    let text = std::fs::read_to_string(&path).unwrap() + "\n## Added later\n\nBy hand.\n";
    std::fs::write(&path, text).unwrap();
    let opened = fx
        .engine
        .discuss(&open("Added later", None, "Who added this?"), &person())
        .await
        .unwrap();
    let section = opened["anchor"]["section"].as_str().unwrap().to_string();
    let file = std::fs::read_to_string(&path).unwrap();
    assert!(
        file.contains(&format!("## Added later\n<!-- r:{section} -->\n")),
        "{file}"
    );
}

#[tokio::test]
async fn an_agent_speaks_to_people_without_engram_links() {
    let fx = crate::docs::reflecting().await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    let err = fx
        .engine
        .discuss(
            &open("aaaa1111", None, "See [[runbooks/deploy]] for why."),
            &agent(),
        )
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("plain words"), "{err}");
    let err = fx
        .engine
        .discuss(
            &open("aaaa1111", None, "See crystalline://eng/runbooks/deploy"),
            &agent(),
        )
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("plain words"), "{err}");
    fx.engine
        .discuss(
            &open("aaaa1111", None, "A person may write [[this]]."),
            &person(),
        )
        .await
        .unwrap();
}

#[tokio::test]
async fn a_quote_that_is_not_there_is_refused() {
    let fx = crate::docs::reflecting().await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    let err = fx
        .engine
        .discuss(&open("aaaa1111", Some("in the morning"), "?"), &person())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("in the morning"), "{err}");
}

/// An unknown thread is not found (404 over REST), not a
/// malformed request.
#[tokio::test]
async fn an_unknown_thread_is_not_found() {
    let fx = crate::docs::reflecting().await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    fx.engine
        .discuss(&open("aaaa1111", None, "Still true?"), &person())
        .await
        .unwrap();
    let err = fx
        .engine
        .discuss(&step("answer", "t-0000dead", "Yes."), &agent())
        .await
        .unwrap_err();
    assert!(
        matches!(err, crystalline_service::EngineError::NotFound(_)),
        "{err:?}"
    );
}

/// An open that is refused (a quote that is not there)
/// writes nothing, not even the id a heading would have got.
#[tokio::test]
async fn a_refused_open_writes_no_id() {
    let fx = crate::docs::reflecting().await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    let path = fx.root.join("reflections/d.md");
    let text = std::fs::read_to_string(&path).unwrap() + "\n## Added later\n\nBy hand.\n";
    std::fs::write(&path, &text).unwrap();
    let err = fx
        .engine
        .discuss(
            &open("Added later", Some("not in the section"), "?"),
            &person(),
        )
        .await;
    assert!(err.is_err());
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        text,
        "no id was written for a refused open"
    );
    assert!(!fx.root.join("reflections/d.threads.md").exists());
}

#[tokio::test]
async fn answering_a_feedback_item_needs_curate_and_marks_the_section() {
    let (fx, vera) = viewer_engine(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    fx.engine
        .write_reflection(&write("d.md", PAGE), &person())
        .await
        .unwrap();
    let mut p = open(
        "aaaa1111",
        None,
        "I read your change; I think the batch moved.",
    );
    p.answers_feedback = true;
    let err = fx
        .engine
        .discuss(&p, &ReflectionCaller::person(vera, "vera"))
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("curate"), "{err}");
    let opened = fx.engine.discuss(&p, &agent()).await.unwrap();
    let text = std::fs::read_to_string(fx.root.join("reflections/d.md")).unwrap();
    let prov = crystalline_core::reflection::read_provenance(&text);
    assert_eq!(
        prov["aaaa1111"].answered_by.as_deref(),
        opened["id"].as_str()
    );
}

/// 0.25.0's read-only domain freezes its Reflection: every write is refused
/// with the domain's own sentence and nothing on disk moves; reads answer.
#[tokio::test]
async fn a_read_only_domain_freezes_its_reflection() {
    let fx = crate::docs::reflecting().await;
    let page = "# Deploying\n\n## Night deploys\n\nDeploys run at night.\n";
    fx.engine
        .write_reflection(&write("guides/deploying.md", page), &person())
        .await
        .unwrap();
    let opened = fx
        .engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                path: Some("guides/deploying.md".into()),
                section: Some("Night deploys".into()),
                text: Some("Still true?".into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();
    std::fs::write(
        fx.root.join("MANIFEST.md"),
        crate::fixture::manifest("reflection: on\nread_only: on\n"),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    let before = std::fs::read_to_string(fx.root.join("reflections/guides/deploying.md")).unwrap();
    let frozen = |err: crystalline_service::EngineError| {
        assert!(
            matches!(err, crystalline_service::EngineError::DomainReadOnly(_)),
            "{err:?}"
        );
        assert_eq!(
            err.to_string(),
            "'eng' is read-only; its owner switches read_only off in the domain policies"
        );
    };
    frozen(
        fx.engine
            .write_reflection(&write("guides/deploying.md", "# Deploying\n"), &person())
            .await
            .unwrap_err(),
    );
    frozen(
        fx.engine
            .write_reflection(&write("guides/new.md", "# New\n"), &person())
            .await
            .unwrap_err(),
    );
    frozen(
        fx.engine
            .move_reflection("eng", "guides/deploying.md", "guides/moved.md", &person())
            .await
            .unwrap_err(),
    );
    frozen(
        fx.engine
            .delete_reflection("eng", "guides/deploying.md", &person())
            .await
            .unwrap_err(),
    );
    // Any section id: the freeze answers before the ids are looked at.
    frozen(
        fx.engine
            .settle_reflection(
                "eng",
                "guides/deploying.md",
                &["0000aaaa".to_string()],
                "kept",
                &person(),
            )
            .await
            .unwrap_err(),
    );
    let answer = DiscussParams {
        domain: "eng".into(),
        action: Some("answer".into()),
        path: Some("guides/deploying.md".into()),
        thread: opened["id"].as_str().map(str::to_string),
        text: Some("Yes.".into()),
        ..Default::default()
    };
    frozen(fx.engine.discuss(&answer, &person()).await.unwrap_err());
    let another = DiscussParams {
        domain: "eng".into(),
        path: Some("guides/deploying.md".into()),
        section: Some("Night deploys".into()),
        text: Some("Another one".into()),
        ..Default::default()
    };
    frozen(fx.engine.discuss(&another, &person()).await.unwrap_err());
    assert_eq!(
        std::fs::read_to_string(fx.root.join("reflections/guides/deploying.md")).unwrap(),
        before
    );
    assert!(!fx.root.join("reflections/guides/new.md").exists());
    let doc = fx
        .engine
        .read_reflection("eng", "guides/deploying.md", &person())
        .await
        .unwrap();
    assert!(
        doc["markdown"]
            .as_str()
            .unwrap()
            .contains("Deploys run at night."),
        "reads answer: {doc}"
    );
    fx.engine
        .read_reflection_tree("eng", &person())
        .await
        .unwrap();
    let listed = DiscussParams {
        domain: "eng".into(),
        action: Some("list".into()),
        ..Default::default()
    };
    fx.engine.discuss(&listed, &person()).await.unwrap();
}

/// A contributor at knowledge `none` cannot see the domain as engrams, yet a
/// read-only domain answers it with the domain's own sentence, not as an
/// unknown domain: the check runs unscoped after the reflection gate.
#[tokio::test]
async fn a_read_only_domain_answers_a_knowledge_none_contributor_with_its_sentence() {
    let (fx, ann) = crate::rights::contributor_engine().await;
    std::fs::write(
        fx.root.join("MANIFEST.md"),
        manifest("reflection: on\nread_only: on\n"),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    let err = fx
        .engine
        .write_reflection(
            &write("guides/a.md", "# A\n"),
            &ReflectionCaller::person(ann, "ann"),
        )
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        "'eng' is read-only; its owner switches read_only off in the domain policies"
    );
}
