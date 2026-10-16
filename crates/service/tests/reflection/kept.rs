//! Kept texts over the JSON API: each entry goes only to a person who may
//! write its source (a Reflection text: curate; an engram text: write access
//! to the engrams), and a reader is refused.

use chrono::TimeZone;
use crystalline_core::kept::{self, KeptKind};
use crystalline_service::rest::{MemberLevel, Role};
use reqwest::Method;
use serde_json::Value;

use crate::rest::{Served, Session, anonymous, serve, serve_with};

const PAGE: &str = "guides/deploying.md";
const ENGRAM: &str = "runbooks/deploy.md";

/// Keep one Reflection text and one engram text for `eng`, and one for
/// another domain, the way a closing room does. Answers the ids of the two
/// `eng` texts, page first.
fn keep(s: &Served) -> (String, String) {
    let root = s.fx.tmp.path().join("state").join(kept::KEPT_DIR);
    let at = chrono::Utc.with_ymd_and_hms(2026, 10, 15, 8, 0, 0).unwrap();
    kept::write(
        &root,
        "eng",
        None,
        KeptKind::Reflection,
        PAGE,
        at,
        "Typed on the page.\n",
    )
    .unwrap();
    let later = at + chrono::Duration::minutes(1);
    kept::write(
        &root,
        "eng",
        None,
        KeptKind::Engram,
        ENGRAM,
        later,
        "Typed on the engram.\n",
    )
    .unwrap();
    kept::write(
        &root,
        "ops",
        None,
        KeptKind::Reflection,
        PAGE,
        at,
        "Another domain.\n",
    )
    .unwrap();
    let found = kept::scan(&root);
    let id = |kind: KeptKind| {
        found
            .iter()
            .find(|k| k.domain == "eng" && k.kind == kind)
            .unwrap()
            .id
            .clone()
    };
    (id(KeptKind::Reflection), id(KeptKind::Engram))
}

/// `vic`: an instance viewer invited into `eng` as an editor. The
/// invitation gives curate on the Reflection, and the instance role keeps
/// the engrams read only.
async fn add_vic(s: &Served) {
    s.auth
        .add_user("vic", "vic", None, Role::Viewer, "pw12345678")
        .await
        .unwrap();
    s.auth
        .upsert_domain_member("eng", "vic", MemberLevel::Editor, None, "keeper")
        .await
        .unwrap();
}

fn listed(body: &Value) -> Vec<(String, String)> {
    body["kept"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| {
            (
                k["kind"].as_str().unwrap().to_string(),
                k["path"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

/// An editor sees both kinds, oldest first, never another domain's; one
/// entry carries its text; a delete takes exactly that file.
#[tokio::test]
async fn an_editor_lists_reads_and_drops_the_kept_texts() {
    let s = serve().await;
    let (page_id, engram_id) = keep(&s);
    let ed = Session::login(s.addr, "ed").await;

    let (status, body) = ed.get("/api/v1/domains/eng/kept").await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["domain"], "eng");
    assert_eq!(
        listed(&body),
        vec![
            ("reflection".to_string(), PAGE.to_string()),
            ("engram".to_string(), ENGRAM.to_string()),
        ]
    );
    let first = &body["kept"][0];
    assert_eq!(first["id"], page_id.as_str());
    assert_eq!(first["kept_at"], "2026-10-15T08:00:00Z");
    assert_eq!(first["bytes"], 19);
    assert!(first.get("file").is_none(), "no server path: {first}");
    assert_eq!(first["draft"], false);

    let (status, one) = ed.get(&format!("/api/v1/domains/eng/kept/{page_id}")).await;
    assert_eq!(status, 200, "{one}");
    assert_eq!(one["text"], "Typed on the page.\n");
    assert_eq!(one["path"], PAGE);
    assert_eq!(one["kind"], "reflection");

    let (status, gone) = ed
        .send(
            Method::DELETE,
            &format!("/api/v1/domains/eng/kept/{engram_id}"),
            None,
        )
        .await;
    assert_eq!(status, 204, "{gone}");
    let (_, body) = ed.get("/api/v1/domains/eng/kept").await;
    assert_eq!(
        listed(&body),
        vec![("reflection".to_string(), PAGE.to_string())]
    );
    let (status, _) = ed
        .get(&format!("/api/v1/domains/eng/kept/{engram_id}"))
        .await;
    assert_eq!(status, 404);
    let root = s.fx.tmp.path().join("state/kept");
    assert_eq!(kept::scan(&root).len(), 2, "the other two stay");
}

/// Each entry by its own right: `vic` curates the Reflection and may not
/// write engrams, so it sees, reads and drops the page's text only; the
/// engram's text answers 404 as if it were not there, and stays.
#[tokio::test]
async fn each_entry_needs_the_right_to_write_its_own_source() {
    let s = serve().await;
    add_vic(&s).await;
    let (page_id, engram_id) = keep(&s);
    let vic = Session::login(s.addr, "vic").await;

    let (status, body) = vic.get("/api/v1/domains/eng/kept").await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        listed(&body),
        vec![("reflection".to_string(), PAGE.to_string())]
    );
    let (status, _) = vic
        .get(&format!("/api/v1/domains/eng/kept/{engram_id}"))
        .await;
    assert_eq!(status, 404);
    let (status, _) = vic
        .send(
            Method::DELETE,
            &format!("/api/v1/domains/eng/kept/{engram_id}"),
            None,
        )
        .await;
    assert_eq!(status, 404);
    let (status, one) = vic
        .get(&format!("/api/v1/domains/eng/kept/{page_id}"))
        .await;
    assert_eq!(status, 200, "{one}");
    let (status, _) = vic
        .send(
            Method::DELETE,
            &format!("/api/v1/domains/eng/kept/{page_id}"),
            None,
        )
        .await;
    assert_eq!(status, 204);
    let root = s.fx.tmp.path().join("state/kept");
    let left: Vec<KeptKind> = kept::scan(&root)
        .into_iter()
        .filter(|k| k.domain == "eng")
        .map(|k| k.kind)
        .collect();
    assert_eq!(left, vec![KeptKind::Engram], "the engram's text stays");
}

/// A reader of the domain (`vera`) and a contributor who edits the
/// Reflection without curating it (`ann`) are refused on every route; a
/// person who may not see the domain (`nora`) meets an unknown domain.
/// Nothing is dropped.
#[tokio::test]
async fn a_reader_is_refused_and_a_stranger_meets_an_unknown_domain() {
    let s = serve().await;
    let (page_id, engram_id) = keep(&s);
    for (name, expected) in [("vera", 403), ("ann", 403), ("nora", 404)] {
        let who = Session::login(s.addr, name).await;
        for (method, path) in [
            (Method::GET, "/api/v1/domains/eng/kept".to_string()),
            (Method::GET, format!("/api/v1/domains/eng/kept/{page_id}")),
            (Method::GET, format!("/api/v1/domains/eng/kept/{engram_id}")),
            (
                Method::DELETE,
                format!("/api/v1/domains/eng/kept/{page_id}"),
            ),
            (
                Method::DELETE,
                format!("/api/v1/domains/eng/kept/{engram_id}"),
            ),
        ] {
            let (status, body) = who.send(method.clone(), &path, None).await;
            assert_eq!(status, expected, "{name} {method} {path}: {body}");
            assert!(
                !body.to_string().contains("Typed on"),
                "{name} gets no text: {body}"
            );
        }
    }
    let root = s.fx.tmp.path().join("state/kept");
    assert_eq!(kept::scan(&root).len(), 3, "nothing is dropped");
}

/// The anonymous viewer of a public domain is asked to sign in.
#[tokio::test]
async fn the_anonymous_viewer_is_asked_to_sign_in() {
    let s = serve_with(true).await;
    let (page_id, _) = keep(&s);
    for (method, path) in [
        (Method::GET, "/api/v1/domains/eng/kept".to_string()),
        (Method::GET, format!("/api/v1/domains/eng/kept/{page_id}")),
        (
            Method::DELETE,
            format!("/api/v1/domains/eng/kept/{page_id}"),
        ),
    ] {
        let (status, body) = anonymous(s.addr, method.clone(), &path, None).await;
        assert_eq!(status, 401, "{method} {path}: {body}");
    }
    let (status, _) = anonymous(s.addr, Method::GET, "/api/v1/domains/nope/kept", None).await;
    assert_eq!(status, 404);
}

/// A text kept because the Reflection was switched off is still listed: the
/// Reflection's state plays no part.
#[tokio::test]
async fn a_switched_off_reflection_still_lists_its_kept_texts() {
    let s = serve().await;
    let (page_id, _) = keep(&s);
    let manifest = s.fx.root.join("MANIFEST.md");
    let text = std::fs::read_to_string(&manifest).unwrap().replacen(
        "reflection: on\n",
        "reflection: off\n",
        1,
    );
    std::fs::write(&manifest, text).unwrap();
    s.fx.engine.sync(Some("eng")).await.unwrap();
    let keeper = Session::login(s.addr, "keeper").await;
    let (status, one) = keeper
        .get(&format!("/api/v1/domains/eng/kept/{page_id}"))
        .await;
    assert_eq!(status, 200, "{one}");
    assert_eq!(one["text"], "Typed on the page.\n");
}

/// A text kept from a review draft is its owner's alone: `ed` lists, reads
/// and drops the one from ed's draft, marked `draft`; `keeper`, who may
/// write every engram of the domain, never sees it, and its id answers 404.
#[tokio::test]
async fn a_drafts_kept_text_goes_to_its_owner_only() {
    let s = serve().await;
    let root = s.fx.tmp.path().join("state").join(kept::KEPT_DIR);
    let at = chrono::Utc.with_ymd_and_hms(2026, 10, 15, 9, 0, 0).unwrap();
    kept::write(
        &root,
        "eng",
        Some("ed"),
        KeptKind::Engram,
        ENGRAM,
        at,
        "Typed in ed's draft.\n",
    )
    .unwrap();
    let id = kept::scan(&root)[0].id.clone();

    let keeper = Session::login(s.addr, "keeper").await;
    let (status, body) = keeper.get("/api/v1/domains/eng/kept").await;
    assert_eq!(status, 200, "{body}");
    assert!(listed(&body).is_empty(), "{body}");
    for method in [Method::GET, Method::DELETE] {
        let (status, body) = keeper
            .send(
                method.clone(),
                &format!("/api/v1/domains/eng/kept/{id}"),
                None,
            )
            .await;
        assert_eq!(status, 404, "{method}: {body}");
    }
    assert_eq!(kept::scan(&root).len(), 1, "keeper drops nothing");

    let ed = Session::login(s.addr, "ed").await;
    let (_, body) = ed.get("/api/v1/domains/eng/kept").await;
    assert_eq!(body["kept"][0]["draft"], true, "{body}");
    let (status, one) = ed.get(&format!("/api/v1/domains/eng/kept/{id}")).await;
    assert_eq!(status, 200, "{one}");
    assert_eq!(one["text"], "Typed in ed's draft.\n");
    let (status, _) = ed
        .send(
            Method::DELETE,
            &format!("/api/v1/domains/eng/kept/{id}"),
            None,
        )
        .await;
    assert_eq!(status, 204);
    assert!(kept::scan(&root).is_empty());
}
