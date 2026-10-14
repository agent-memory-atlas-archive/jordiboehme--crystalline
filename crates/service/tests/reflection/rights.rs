//! The two axes through the engine: knowledge `none` is invisible to engram
//! verbs and present to the Reflection, on a private and on a shared domain.

use std::sync::Arc;

use crystalline_service::params::SearchParams;
use crystalline_service::rest::{AuthStore, MemberLevel, ReflectionLevel, Role};
use crystalline_service::{DomainAccess, ReflectionRight, Scope};

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
