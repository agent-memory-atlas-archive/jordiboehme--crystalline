//! The two axes through the engine: knowledge `none` is invisible to engram
//! verbs and present to the Reflection, on a private and on a shared domain.

use std::sync::Arc;

use crystalline_service::engine::ReflectionSearch;
use crystalline_service::params::SearchParams;
use crystalline_service::rest::{AuthStore, MemberLevel, ReflectionLevel, Role};
use crystalline_service::{DomainAccess, ReflectionCaller, ReflectionRight, Scope};

use crate::fixture::{engram, fixture};

/// `eng` private to keeper; `ann` a member with knowledge `none` and
/// Reflection `contributor`.
pub async fn contributor_engine() -> (crate::fixture::Fx, Scope) {
    let fx = fixture(&[(
        "runbooks/deploy.md",
        &engram("Deploy", "runbooks/deploy", "- [fact] deploys run at night"),
    )])
    .await;
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    for name in ["keeper", "ann"] {
        auth.add_user(name, name, None, Role::Viewer, "pw12345678")
            .await
            .unwrap();
    }
    auth.set_domain_visibility("eng", true, "keeper")
        .await
        .unwrap();
    auth.upsert_domain_member(
        "eng",
        "ann",
        MemberLevel::None,
        Some(ReflectionLevel::Contributor),
        "keeper",
    )
    .await
    .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth)));
    (
        fx,
        Scope::User {
            account: "ann".into(),
            admin: false,
        },
    )
}

/// A signed-in instance viewer on the shared domain `eng`: Read.
pub async fn viewer_engine(files: &[(&str, &str)]) -> (crate::fixture::Fx, Scope) {
    let fx = fixture(files).await;
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    auth.add_user("vera", "Vera", None, Role::Viewer, "pw12345678")
        .await
        .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth)));
    (
        fx,
        Scope::User {
            account: "vera".into(),
            admin: false,
        },
    )
}

/// `eng` shared; `nora` an instance account with knowledge `none` and
/// Reflection `contributor`.
pub async fn shared_contributor_engine() -> (crate::fixture::Fx, Scope) {
    let fx = fixture(&[(
        "runbooks/deploy.md",
        &engram("Deploy", "runbooks/deploy", "- [fact] deploys run at night"),
    )])
    .await;
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    auth.add_user("nora", "nora", None, Role::None, "pw12345678")
        .await
        .unwrap();
    auth.set_reflection_level("nora", ReflectionLevel::Contributor)
        .await
        .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth)));
    (
        fx,
        Scope::User {
            account: "nora".into(),
            admin: false,
        },
    )
}

async fn sees_no_engram(fx: &crate::fixture::Fx, who: &Scope) {
    let query = SearchParams {
        query: Some("deploys".into()),
        ..Default::default()
    };
    // The control: the engram is there for the machine owner.
    let all = fx
        .engine
        .search_engrams(&query, &Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(all["total"], 1, "{all}");

    let err = fx
        .engine
        .require_domain("eng", who)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("eng") && !err.contains("forbidden"),
        "answered as unknown: {err}"
    );
    let hits = fx.engine.search_engrams(&query, who).await.unwrap();
    assert_eq!(hits["total"], 0, "{hits}");
    assert!(fx.engine.hidden_for(who).await.unwrap().contains("eng"));
}

#[tokio::test]
async fn a_member_with_knowledge_none_holds_no_engram_right_and_edits_the_reflection() {
    let (fx, ann) = contributor_engine().await;
    sees_no_engram(&fx, &ann).await;
    assert_eq!(
        fx.engine.reflection_right(&ann, "eng").await.unwrap(),
        ReflectionRight::Edit
    );
}

#[tokio::test]
async fn an_instance_account_with_knowledge_none_sees_no_shared_domain_and_edits_its_reflection() {
    let (fx, nora) = shared_contributor_engine().await;
    sees_no_engram(&fx, &nora).await;
    assert_eq!(
        fx.engine.reflection_right(&nora, "eng").await.unwrap(),
        ReflectionRight::Edit
    );
    // The engine screen and the per-domain right agree on every domain.
    let hidden = fx.engine.hidden_domains(&nora).await.unwrap().unwrap();
    for name in fx.engine.registered_domain_names() {
        let right = fx.engine.domain_right(&nora, &name).await.unwrap();
        assert_eq!(
            hidden.contains(&name),
            right == crystalline_service::DomainRight::None,
            "{name}"
        );
    }
}

/// R18: a write list caps the Reflection like it caps the engrams (0.25.0
/// B-2, "a reader there and nothing more"). An instance editor whose list
/// leaves `eng` out reads its Reflection, and a write is refused with the
/// sentence that names the list and its fix.
#[tokio::test]
async fn an_off_list_editor_reads_the_reflection_and_the_refusal_names_the_list() {
    let fx = crate::docs::reflecting().await;
    fx.engine
        .write_reflection(
            &crate::docs::write(
                "guides/night.md",
                "# Night\n\n## Deploys\n\nDeploys run at night.\n",
            ),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap();
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    auth.add_user("ed", "ed", None, Role::Editor, "pw12345678")
        .await
        .unwrap();
    auth.set_write_list("ed", &["agents-*".to_string()])
        .await
        .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth.clone())));
    let ed = Scope::User {
        account: "ed".into(),
        admin: false,
    };
    assert_eq!(
        fx.engine.reflection_right(&ed, "eng").await.unwrap(),
        ReflectionRight::Read
    );
    let caller = ReflectionCaller::agent(ed, "ed", false);
    fx.engine
        .read_reflection_tree("eng", &caller)
        .await
        .unwrap();
    searches_night(&fx, &caller).await;
    let err = fx
        .engine
        .write_reflection(&crate::docs::write("guides/a.md", "# A\n"), &caller)
        .await
        .unwrap_err();
    assert!(
        matches!(err, crystalline_service::EngineError::Forbidden(_)),
        "{err:?}"
    );
    assert_eq!(
        err.to_string(),
        crystalline_service::WriteBlock::WriteList {
            account: "ed".into()
        }
        .sentence("eng")
    );
    assert!(!fx.root.join("reflections/guides/a.md").exists());

    // The cap is on the whole account: a knowledge-`none` contributor whose
    // list leaves `eng` out reads, and its edit is refused with the same
    // sentence.
    auth.add_user("nora", "nora", None, Role::None, "pw12345678")
        .await
        .unwrap();
    auth.set_reflection_level("nora", ReflectionLevel::Contributor)
        .await
        .unwrap();
    let nora = Scope::User {
        account: "nora".into(),
        admin: false,
    };
    // Knowledge `none` searches the Reflection it edits, and keeps searching
    // once the write list caps it to a reader.
    searches_night(&fx, &ReflectionCaller::person(nora, "nora")).await;
    auth.set_write_list("nora", &["agents-*".to_string()])
        .await
        .unwrap();
    let nora = Scope::User {
        account: "nora".into(),
        admin: false,
    };
    assert_eq!(
        fx.engine.reflection_right(&nora, "eng").await.unwrap(),
        ReflectionRight::Read
    );
    searches_night(&fx, &ReflectionCaller::person(nora.clone(), "nora")).await;
    let err = fx
        .engine
        .write_reflection(
            &crate::docs::write("guides/b.md", "# B\n"),
            &ReflectionCaller::person(nora, "nora"),
        )
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        crystalline_service::WriteBlock::WriteList {
            account: "nora".into()
        }
        .sentence("eng")
    );
}

/// `who` finds the night page by text: searching takes the read right.
async fn searches_night(fx: &crate::fixture::Fx, who: &ReflectionCaller) {
    let found = fx
        .engine
        .search_reflection(
            "eng",
            &ReflectionSearch {
                query: "night",
                search_type: Some("text"),
                limit: 10,
                page: 1,
            },
            who,
        )
        .await
        .unwrap();
    assert_eq!(found["hits"][0]["path"], "guides/night.md", "{found}");
}

/// `eng` shared with a page citing an engram of `scotty`, private to
/// keeper: `ann` an instance editor who curates `eng` and may not open
/// `scotty`, `sam` an instance editor who is also a viewer of `scotty`. The
/// page `overview.md` has a section `Team` built from `scotty`'s team
/// engram and one `Deploys` built from `eng`'s runbook.
pub async fn crossing_rights() -> (crate::fixture::Fx, Scope, Scope) {
    let fx = crate::sources::crossing().await;
    let mut p = crate::docs::write(
        "overview.md",
        "# Overview\n\nFor people.\n\n## Team\n\nFive people.\n\n## Deploys\n\nAt night.\n",
    );
    p.sources = std::collections::BTreeMap::from([
        (
            "Team".to_string(),
            vec!["crystalline://scotty/team/scotty-team".to_string()],
        ),
        ("Deploys".to_string(), vec!["runbooks/deploy".to_string()]),
    ]);
    fx.engine
        .write_reflection(&p, &ReflectionCaller::owner())
        .await
        .unwrap();
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    for name in ["keeper", "ann", "sam"] {
        auth.add_user(name, name, None, Role::Editor, "pw12345678")
            .await
            .unwrap();
    }
    auth.set_domain_visibility("scotty", true, "keeper")
        .await
        .unwrap();
    auth.upsert_domain_member("scotty", "sam", MemberLevel::Viewer, None, "keeper")
        .await
        .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth)));
    let user = |name: &str| Scope::User {
        account: name.into(),
        admin: false,
    };
    (fx, user("ann"), user("sam"))
}

fn agent_as(scope: &Scope) -> ReflectionCaller {
    ReflectionCaller::agent(scope.clone(), "claude-code", false)
}

/// A write that names a source in a domain the writer may not open, in one
/// nobody registered and in one a connected server serves is refused with
/// the same bytes: a private domain's existence never shows.
#[tokio::test]
async fn a_hidden_an_unknown_and_a_mounted_domain_are_refused_alike() {
    let page = || {
        let mut p = crate::docs::write("b.md", "# B\n\nFor people.\n\n## Only\n\nText.\n");
        p.sources = std::collections::BTreeMap::from([(
            "Only".to_string(),
            vec!["crystalline://scotty/team/scotty-team".to_string()],
        )]);
        p
    };
    let (fx, ann, _) = crossing_rights().await;
    let hidden = fx
        .engine
        .write_reflection(&page(), &agent_as(&ann))
        .await
        .unwrap_err()
        .to_string();

    let lone = crate::docs::reflecting().await;
    let unknown = lone
        .engine
        .write_reflection(&page(), &ReflectionCaller::owner())
        .await
        .unwrap_err()
        .to_string();

    let mounted = crate::docs::reflecting().await;
    let remote = mounted.tmp.path().join("remote");
    crystalline_remote::update_sources(&remote, |file| {
        file.upsert(crystalline_remote::SourceRecord {
            url: "http://127.0.0.1:9".to_string(),
            name: "acme".to_string(),
            account: "ada".to_string(),
            kind: crystalline_remote::CredentialKind::Token,
            token_endpoint: None,
            revocation_endpoint: None,
            connected_at: chrono::Utc::now(),
            mounts: vec![crystalline_remote::MountRecord {
                remote: "scotty".to_string(),
                local: "scotty".to_string(),
            }],
            domains: None,
            from_env: false,
        });
        Ok(())
    })
    .unwrap();
    mounted
        .engine
        .set_sources(Arc::new(crystalline_remote::SourceSet::load(
            remote,
            mounted.engine.local_domains(),
            |_| None,
        )));
    let served = mounted
        .engine
        .write_reflection(&page(), &ReflectionCaller::owner())
        .await
        .unwrap_err()
        .to_string();

    assert!(hidden.contains("scotty"), "{hidden}");
    assert_eq!(hidden, unknown);
    assert_eq!(unknown, served);
    assert!(!fx.root.join("reflections/b.md").exists());
}

/// A reader who may not open `scotty` sees the page's own sources and, for
/// the section built from `scotty`, only a count: no title, permalink,
/// domain or state, in the sections and in the raw block. A reader of
/// `scotty` sees the source in full.
#[tokio::test]
async fn a_reader_who_may_not_open_a_domain_sees_only_a_count() {
    let (fx, ann, sam) = crossing_rights().await;
    let doc = fx
        .engine
        .read_reflection("eng", "overview.md", &agent_as(&ann))
        .await
        .unwrap();
    let text = doc.to_string();
    assert!(!text.contains("scotty"), "{doc}");
    assert!(!text.contains("team/"), "{doc}");
    let team = doc["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["heading"] == "Team")
        .unwrap();
    assert_eq!(team["sources"], serde_json::json!([]), "{doc}");
    assert_eq!(team["hidden_sources"], 1, "{doc}");
    let deploys = doc["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["heading"] == "Deploys")
        .unwrap();
    assert_eq!(deploys["sources"][0]["permalink"], "runbooks/deploy");
    assert!(deploys.get("hidden_sources").is_none(), "{doc}");
    // The line still points at its heading in the markdown answered.
    let markdown = doc["markdown"].as_str().unwrap();
    let line = team["line"].as_u64().unwrap() as usize;
    assert_eq!(
        markdown.lines().nth(line - 1),
        Some("## Team"),
        "{markdown}"
    );

    let full = fx
        .engine
        .read_reflection("eng", "overview.md", &agent_as(&sam))
        .await
        .unwrap();
    let team = full["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["heading"] == "Team")
        .unwrap();
    assert_eq!(team["sources"][0]["domain"], "scotty", "{full}");
    assert_eq!(team["sources"][0]["title"], "Scotty team", "{full}");
    assert!(team.get("hidden_sources").is_none(), "{full}");
    assert!(
        full["markdown"]
            .as_str()
            .unwrap()
            .contains("domain: scotty")
    );
}

/// The queue names a changed source in `scotty` only to a caller who may
/// open `scotty`; a curator who may not gets the item with a count and the
/// plain words, so it asks a person instead of updating blind.
#[tokio::test]
async fn the_queue_names_a_source_only_to_a_reader_of_its_domain() {
    let (fx, ann, sam) = crossing_rights().await;
    std::fs::write(
        crate::fixture::root_of(&fx, "scotty").join("team/scotty-team.md"),
        engram("Scotty team", "team/scotty-team", "- [fact] six people"),
    )
    .unwrap();
    fx.engine.sync(None).await.unwrap();
    let params = crystalline_service::params::ReflectParams {
        domains: vec!["eng".into()],
        ..Default::default()
    };
    let queue = fx.engine.reflect(&params, &agent_as(&ann)).await.unwrap();
    assert!(!queue.to_string().contains("scotty"), "{queue}");
    let item = queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["what"] == "source_changed")
        .unwrap_or_else(|| panic!("{queue}"));
    assert_eq!(item["heading"], "Team");
    assert_eq!(item["sources"], serde_json::json!([]));
    assert_eq!(item["hidden_sources"], 1);
    assert_eq!(
        item["note"],
        "a source in a domain you cannot open has changed"
    );

    let queue = fx.engine.reflect(&params, &agent_as(&sam)).await.unwrap();
    let item = queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["what"] == "source_changed")
        .unwrap_or_else(|| panic!("{queue}"));
    assert_eq!(item["sources"][0]["domain"], "scotty", "{queue}");
    assert_eq!(item["sources"][0]["state"], "changed", "{queue}");
    assert!(item.get("hidden_sources").is_none(), "{queue}");
}

/// A write by a curator who may not open `scotty` keeps the section's
/// `scotty` source as it was: a sources write, a whole-page write sent back
/// as it was read (told nothing about a made-up block), a section
/// operation and a room's save.
#[tokio::test]
async fn a_write_never_drops_a_source_the_writer_cannot_see() {
    use crystalline_core::reflection as r;
    let (fx, ann, _) = crossing_rights().await;
    let stored_team = |fx: &crate::fixture::Fx| -> Vec<r::SourceRef> {
        let text = std::fs::read_to_string(fx.root.join("reflections/overview.md")).unwrap();
        let sections = r::split_sections(&text);
        let id = sections
            .iter()
            .find(|s| s.heading == "Team")
            .unwrap()
            .id
            .clone()
            .unwrap();
        r::read_provenance(&text)[&id].sources.clone()
    };
    let before = stored_team(&fx);
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].domain.as_deref(), Some("scotty"));

    // Sources alone: the writer names the runbook; scotty's stays beside it.
    let mut p = crystalline_service::params::WriteReflectionParams {
        domain: "eng".into(),
        path: "overview.md".into(),
        ..Default::default()
    };
    p.sources = std::collections::BTreeMap::from([(
        "Team".to_string(),
        vec!["runbooks/deploy".to_string()],
    )]);
    fx.engine
        .write_reflection(&p, &agent_as(&ann))
        .await
        .unwrap();
    let after = stored_team(&fx);
    assert_eq!(after.len(), 2, "{after:?}");
    assert_eq!(after[0].engram, "runbooks/deploy");
    assert_eq!(after[1], before[0], "kept as it was");

    // The page sent back as it was read: the block it read had no scotty.
    let doc = fx
        .engine
        .read_reflection("eng", "overview.md", &agent_as(&ann))
        .await
        .unwrap();
    let mut whole = crate::docs::write("overview.md", doc["markdown"].as_str().unwrap());
    whole.expected_checksum = doc["checksum"].as_str().map(str::to_string);
    let receipt = fx
        .engine
        .write_reflection(&whole, &agent_as(&ann))
        .await
        .unwrap();
    assert!(
        !receipt.to_string().contains("bookkeeping"),
        "no made-up block: {receipt}"
    );
    assert_eq!(stored_team(&fx), after);

    // A section operation.
    let op = crystalline_service::params::WriteReflectionParams {
        domain: "eng".into(),
        path: "overview.md".into(),
        operation: Some("replace_section".into()),
        section: Some("Team".into()),
        content: Some("## Team\n\nSix people now.\n".into()),
        ..Default::default()
    };
    fx.engine
        .write_reflection(&op, &agent_as(&ann))
        .await
        .unwrap();
    assert_eq!(stored_team(&fx), after);

    // A room's save of the page as the room reads it.
    let room = fx
        .engine
        .reflection_room_text("eng", "overview.md")
        .await
        .unwrap();
    fx.engine
        .save_reflection_room(
            "eng",
            "overview.md",
            &room.content.replace("Six people now.", "Seven people now."),
            &room.checksum,
            &crystalline_service::SectionAuthors::plain(vec!["ann".into()]),
            true,
        )
        .await
        .unwrap();
    assert_eq!(stored_team(&fx), after);
}

/// A tool call's answer as text: the result, or the error the server sent.
async fn answer_of(
    peer: &rmcp::service::Peer<rmcp::RoleClient>,
    tool: &str,
    args: serde_json::Value,
) -> String {
    let mut params = rmcp::model::CallToolRequestParams::new(tool.to_string());
    if let serde_json::Value::Object(map) = args {
        params = params.with_arguments(map);
    }
    match peer.call_tool(params).await {
        Ok(result) => serde_json::to_string(&result).unwrap(),
        Err(e) => format!("{e:?}"),
    }
}

/// Over MCP, the open tier (anonymous, MCP sign-in off) may not open the
/// private `scotty`: a write naming it is refused in the bytes a domain
/// nobody registered and a domain a connected server serves get, and a read
/// shows the section built from it with a count only.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn over_mcp_the_open_tier_is_refused_alike_and_sees_only_a_count() {
    use crate::assets_mcp::{call, connect, serve_mcp};
    use crystalline_service::mcp::McpServer;
    let args = serde_json::json!({
        "domain": "eng",
        "path": "b.md",
        "markdown": "# B\n\nFor people.\n\n## Only\n\nText.\n",
        "sources": { "Only": ["crystalline://scotty/team/scotty-team"] },
    });

    let (fx, _, _) = crossing_rights().await;
    let (client, _server) = serve_mcp(McpServer::new_http(fx.engine.clone())).await;
    let hidden = answer_of(client.peer(), "write_reflection", args.clone()).await;
    let read = call(
        client.peer(),
        "read_reflection",
        serde_json::json!({ "domain": "eng", "path": "overview.md" }),
    )
    .await;

    let lone = crate::docs::reflecting().await;
    let (lone_client, _lone_server) = connect(lone.engine.clone()).await;
    let unknown = answer_of(lone_client.peer(), "write_reflection", args.clone()).await;

    let mounted = crate::docs::reflecting().await;
    let remote = mounted.tmp.path().join("remote");
    crystalline_remote::update_sources(&remote, |file| {
        file.upsert(crystalline_remote::SourceRecord {
            url: "http://127.0.0.1:9".to_string(),
            name: "acme".to_string(),
            account: "ada".to_string(),
            kind: crystalline_remote::CredentialKind::Token,
            token_endpoint: None,
            revocation_endpoint: None,
            connected_at: chrono::Utc::now(),
            mounts: vec![crystalline_remote::MountRecord {
                remote: "scotty".to_string(),
                local: "scotty".to_string(),
            }],
            domains: None,
            from_env: false,
        });
        Ok(())
    })
    .unwrap();
    mounted
        .engine
        .set_sources(Arc::new(crystalline_remote::SourceSet::load(
            remote,
            mounted.engine.local_domains(),
            |_| None,
        )));
    let (mounted_client, _mounted_server) = connect(mounted.engine.clone()).await;
    let served = answer_of(mounted_client.peer(), "write_reflection", args).await;

    assert!(
        hidden.contains("domain 'scotty' not registered"),
        "{hidden}"
    );
    assert_eq!(hidden, unknown);
    assert_eq!(unknown, served);

    let text = read.to_string();
    assert!(!text.contains("scotty"), "{read}");
    assert!(!text.contains("team/scotty-team"), "{read}");
    assert!(text.contains("hidden_sources"), "{read}");
}

/// What the queue tells `ann` (who may not open `scotty`) about the `Team`
/// section of `overview.md` after `change` ran on the fixture, without the
/// row's position: every member, `age_secs` included.
async fn hidden_team_item(change: impl FnOnce(&crate::fixture::Fx)) -> serde_json::Value {
    let (fx, ann, _) = crossing_rights().await;
    change(&fx);
    // The engram behind the source last changed ten days ago: a hidden
    // item is aged by its page, never by the engram.
    let team = crate::fixture::root_of(&fx, "scotty").join("team/scotty-team.md");
    if team.exists() {
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(10 * 86_400);
        std::fs::File::options()
            .write(true)
            .open(&team)
            .unwrap()
            .set_modified(old)
            .unwrap();
    }
    fx.engine.sync(None).await.unwrap();
    let params = crystalline_service::params::ReflectParams {
        domains: vec!["eng".into()],
        ..Default::default()
    };
    let queue = fx.engine.reflect(&params, &agent_as(&ann)).await.unwrap();
    let mut items: Vec<serde_json::Value> = queue["queue"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["heading"] == "Team")
        .cloned()
        .collect();
    assert_eq!(items.len(), 1, "{queue}");
    let mut item = items.remove(0);
    assert!(item["age_secs"].as_i64().unwrap() < 3600, "{item}");
    let obj = item.as_object_mut().unwrap();
    for key in ["n", "section", "age_secs"] {
        obj.remove(key);
    }
    item
}

/// A source the caller may not see tells nothing of itself in the queue:
/// changed, retired, gone, or in a domain this instance does not register,
/// the item is the same, aged by the page.
#[tokio::test]
async fn a_hidden_source_looks_the_same_in_every_state() {
    let scotty_team =
        |fx: &crate::fixture::Fx| crate::fixture::root_of(fx, "scotty").join("team/scotty-team.md");
    let changed = hidden_team_item(|fx| {
        std::fs::write(
            scotty_team(fx),
            engram("Scotty team", "team/scotty-team", "- [fact] six people"),
        )
        .unwrap();
    })
    .await;
    let retired = hidden_team_item(|fx| {
        std::fs::write(
            scotty_team(fx),
            engram("Scotty team", "team/scotty-team", "- [fact] five people")
                .replace("status: stable", "status: superseded"),
        )
        .unwrap();
    })
    .await;
    let missing = hidden_team_item(|fx| {
        std::fs::remove_file(scotty_team(fx)).unwrap();
    })
    .await;
    let unregistered = hidden_team_item(|fx| {
        let abs = fx.root.join("reflections/overview.md");
        let text = std::fs::read_to_string(&abs).unwrap();
        std::fs::write(&abs, text.replace("domain: scotty", "domain: elsewhere")).unwrap();
    })
    .await;
    assert_eq!(changed["what"], "source_changed", "{changed}");
    assert_eq!(changed, retired);
    assert_eq!(changed, missing);
    assert_eq!(changed, unregistered);
}
