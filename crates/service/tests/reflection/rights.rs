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
