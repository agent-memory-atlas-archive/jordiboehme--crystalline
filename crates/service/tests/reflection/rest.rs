//! The REST contract Fluid builds on.

use std::sync::Arc;
use std::sync::atomic::AtomicUsize;

use crystalline_core::config::AuthConfig;
use crystalline_service::daemon::http_router;
use crystalline_service::rest::{AuthStore, MemberLevel, ReflectionLevel, Role};
use serde_json::{Value, json};

use crate::fixture::{Fx, engram, fixture_with, manifest};

pub struct Served {
    pub addr: std::net::SocketAddr,
    pub fx: Fx,
    pub auth: Arc<AuthStore>,
}

/// `eng` private to keeper, `ann` a member with knowledge `none` and
/// Reflection `contributor`, `vera` a viewer member, `ed` an editor member;
/// `nora` an instance account with knowledge `none` and Reflection
/// `contributor`. With `anonymous`, `eng` stays shared (public) and has no
/// members, and the anonymous viewer is on. Reflection on, one engram, one
/// curated reflection.
pub async fn serve() -> Served {
    serve_with(false).await
}

pub async fn serve_with(anonymous: bool) -> Served {
    let fx = fixture_with(
        &[
            ("MANIFEST.md", &manifest("reflection: on\n")),
            (
                "runbooks/deploy.md",
                &engram("Deploy", "runbooks/deploy", "- [fact] deploys run at night"),
            ),
        ],
        move |cfg, _| {
            cfg.auth = Some(AuthConfig {
                anonymous: Some(anonymous),
                ..Default::default()
            });
        },
    )
    .await;
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    for (name, role) in [
        ("keeper", Role::Editor),
        ("ann", Role::Viewer),
        ("vera", Role::Viewer),
        ("ed", Role::Editor),
        ("nora", Role::None),
    ] {
        auth.add_user(name, name, None, role, "pw12345678")
            .await
            .unwrap();
    }
    auth.set_reflection_level("nora", ReflectionLevel::Contributor)
        .await
        .unwrap();
    if !anonymous {
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
        auth.upsert_domain_member("eng", "vera", MemberLevel::Viewer, None, "keeper")
            .await
            .unwrap();
        auth.upsert_domain_member("eng", "ed", MemberLevel::Editor, None, "keeper")
            .await
            .unwrap();
    }
    let mut p = crate::docs::write(
        "guides/deploying.md",
        "# Deploying\n\n## Night deploys\n\nDeploys run at night.\n",
    );
    p.sources = std::collections::BTreeMap::from([
        ("_top".to_string(), Vec::new()),
        (
            "Night deploys".to_string(),
            vec!["runbooks/deploy".to_string()],
        ),
    ]);
    fx.engine
        .write_reflection(&p, &crystalline_service::ReflectionCaller::owner())
        .await
        .unwrap();
    let router = http_router(
        fx.engine.clone(),
        Arc::new(AtomicUsize::new(0)),
        &[],
        auth.clone(),
        None,
    )
    .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    Served { addr, fx, auth }
}

pub struct Session {
    addr: std::net::SocketAddr,
    cookie: String,
    csrf: String,
}

impl Session {
    pub async fn login(addr: std::net::SocketAddr, name: &str) -> Session {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let resp = client
            .post(format!("http://{addr}/api/v1/auth/login"))
            .json(&json!({ "name": name, "password": "pw12345678" }))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let cookie = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .find_map(|v| v.split(';').next()?.strip_prefix("fluid_session="))
            .unwrap()
            .to_string();
        let body: Value = resp.json().await.unwrap();
        Session {
            addr,
            cookie,
            csrf: body["csrf"].as_str().unwrap().to_string(),
        }
    }

    pub async fn send(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> (u16, Value) {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut req = client
            .request(method, format!("http://{}{path}", self.addr))
            .header("cookie", format!("fluid_session={}", self.cookie))
            .header("x-csrf-token", &self.csrf);
        if let Some(body) = body {
            req = req.json(&body);
        }
        let resp = req.send().await.unwrap();
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap();
        (
            status,
            serde_json::from_str(&text).unwrap_or(Value::String(text)),
        )
    }

    pub async fn get(&self, path: &str) -> (u16, Value) {
        self.send(reqwest::Method::GET, path, None).await
    }
}

#[tokio::test]
async fn a_contributor_sees_no_sources_and_no_engram_route() {
    let s = serve().await;
    let ann = Session::login(s.addr, "ann").await;
    let (status, domains) = ann.get("/api/v1/domains").await;
    assert_eq!(status, 200);
    assert!(
        !domains.to_string().contains("\"eng\""),
        "hidden as engrams: {domains}"
    );
    let (status, listing) = ann.get("/api/v1/reflection/domains").await;
    assert_eq!(status, 200);
    assert_eq!(listing["domains"][0]["domain"], "eng");
    assert_eq!(listing["domains"][0]["right"], "edit");
    assert_eq!(listing["domains"][0]["engrams_visible"], false);
    let (status, _) = ann.get("/api/v1/domains/eng/engrams/runbooks/deploy").await;
    assert_eq!(status, 404, "no engram route answers a contributor");
    let (status, doc) = ann
        .get("/api/v1/domains/eng/reflections/guides/deploying.md")
        .await;
    assert_eq!(status, 200);
    assert!(
        doc["sections"][0].get("sources").is_none(),
        "absent, not empty: {doc}"
    );
    assert!(!doc.to_string().contains("runbooks/deploy"));
    // The markdown comes without the block, and `line` is counted on it.
    let markdown = doc["markdown"].as_str().unwrap();
    assert!(!markdown.contains("reflection:"), "{markdown}");
    let line = doc["sections"][0]["line"].as_u64().unwrap() as usize;
    assert_eq!(
        markdown.lines().nth(line - 1),
        Some("## Night deploys"),
        "{doc}"
    );
    // Search never answers a hit out of the block: `runbooks` is only there.
    let (status, hits) = ann
        .get("/api/v1/domains/eng/reflection/search?q=runbooks")
        .await;
    assert_eq!(status, 200);
    assert_eq!(hits["hits"].as_array().unwrap().len(), 0, "{hits}");
    // The answered checksum is the stored file's, so an edit of the stripped
    // text with it is not stale, and the stored block survives it.
    let (status, saved) = ann
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/guides/deploying.md",
            Some(json!({ "markdown": markdown.replace("Deploys run at night.", "Deploys run at night, after the batch."), "expected_checksum": doc["checksum"] })),
        )
        .await;
    assert_eq!(status, 200, "a contributor edits: {saved}");
    let stored =
        std::fs::read_to_string(s.fx.root.join("reflections/guides/deploying.md")).unwrap();
    assert!(
        stored.contains("engram: runbooks/deploy") && stored.contains("after the batch"),
        "{stored}"
    );
    let (_, queue) = ann.get("/api/v1/domains/eng/reflection/queue").await;
    assert!(queue["total"].as_u64().unwrap() >= 1);
    assert!(!queue.to_string().contains("runbooks/deploy"), "{queue}");
}

#[tokio::test]
async fn a_create_refuses_an_existing_page() {
    let s = serve().await;
    let ed = Session::login(s.addr, "ed").await;
    let abs = s.fx.root.join("reflections/guides/deploying.md");
    let before = std::fs::read(&abs).unwrap();
    let (status, err) = ed
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/guides/deploying.md",
            Some(json!({ "markdown": "# Mine\n", "create": true })),
        )
        .await;
    assert_eq!(status, 409, "{err}");
    assert_eq!(
        err["detail"],
        "a reflection already lives at 'guides/deploying.md'"
    );
    assert_eq!(
        std::fs::read(&abs).unwrap(),
        before,
        "the page is untouched"
    );
    let (status, made) = ed
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/guides/new.md",
            Some(json!({ "markdown": "# New\n", "create": true })),
        )
        .await;
    assert_eq!(status, 200, "{made}");
    assert_eq!(made["created"], true);
}

#[tokio::test]
async fn the_rights_per_route() {
    let s = serve().await;
    let vera = Session::login(s.addr, "vera").await;
    let (status, _) = vera.get("/api/v1/domains/eng/reflection/tree").await;
    assert_eq!(status, 200, "a viewer reads");
    let (status, err) = vera
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/new.md",
            Some(json!({ "markdown": "# New\n" })),
        )
        .await;
    assert_eq!(status, 403, "{err}");
    assert!(
        err["detail"]
            .as_str()
            .unwrap()
            .contains("is read, and edit is needed"),
        "{err}"
    );
    let (status, thread) = vera
        .send(reqwest::Method::POST, "/api/v1/domains/eng/reflection/threads", Some(json!({ "path": "guides/deploying.md", "section": "Night deploys", "quote": "at night", "text": "Still?" })))
        .await;
    assert_eq!(status, 201, "a viewer comments: {thread}");
    let id = thread["id"].as_str().unwrap();
    let (status, err) = vera
        .send(
            reqwest::Method::POST,
            &format!("/api/v1/domains/eng/reflection/threads/{id}/resolve"),
            Some(json!({ "path": "guides/deploying.md", "outcome": "" })),
        )
        .await;
    assert_eq!(status, 422, "a resolve needs its outcome: {err}");
    let (status, resolved) = vera
        .send(
            reqwest::Method::POST,
            &format!("/api/v1/domains/eng/reflection/threads/{id}/resolve"),
            Some(json!({ "path": "guides/deploying.md", "outcome": "Yes." })),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(resolved["status"], "resolved");
    let (_, listed) = vera
        .get("/api/v1/domains/eng/reflection/threads?status=all")
        .await;
    assert_eq!(listed["threads"].as_array().unwrap().len(), 1);

    let stranger_status = {
        s.auth
            .add_user("out", "out", None, Role::Editor, "pw12345678")
            .await
            .unwrap();
        let out = Session::login(s.addr, "out").await;
        out.get("/api/v1/domains/eng/reflection").await.0
    };
    assert_eq!(
        stranger_status, 404,
        "a stranger learns nothing about a private domain"
    );

    // A member editor whose write list leaves `eng` out reads its
    // Reflection, and a write answers 403 naming the list and its fix.
    s.auth
        .set_write_list("ed", &["agents-*".to_string()])
        .await
        .unwrap();
    let ed = Session::login(s.addr, "ed").await;
    let (_, status) = ed.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(status["right"], "read", "{status}");
    let (status, err) = ed
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/new.md",
            Some(json!({ "markdown": "# New\n" })),
        )
        .await;
    assert_eq!(status, 403, "{err}");
    assert_eq!(
        err["detail"],
        "'eng' is not on the write list of 'ed'; an instance admin changes it with crystalline users writes"
    );
}

#[tokio::test]
async fn status_tree_doc_move_delete_search_and_review() {
    let s = serve().await;
    let ed = Session::login(s.addr, "ed").await;
    let (_, status) = ed.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(status["state"], "on");
    assert_eq!(
        status["member"], true,
        "ed holds a membership row on the private eng"
    );
    assert_eq!(status["home"], "local");
    assert_eq!(status["right"], "curate");
    let (_, tree) = ed.get("/api/v1/domains/eng/reflection/tree").await;
    assert_eq!(tree["nodes"][0]["kind"], "folder");
    assert_eq!(
        tree["nodes"][0]["children"][0]["path"],
        "guides/deploying.md"
    );
    let (_, doc) = ed
        .get("/api/v1/domains/eng/reflections/guides/deploying.md")
        .await;
    assert_eq!(
        doc["sections"][0]["sources"][0]["permalink"],
        "runbooks/deploy"
    );
    let markdown = doc["markdown"].as_str().unwrap();
    assert!(
        markdown.contains("engram: runbooks/deploy"),
        "an editor gets the whole file"
    );
    let line = doc["sections"][0]["line"].as_u64().unwrap() as usize;
    assert_eq!(
        markdown.lines().nth(line - 1),
        Some("## Night deploys"),
        "{doc}"
    );
    let checksum = doc["checksum"].as_str().unwrap().to_string();
    let (status, stale) = ed
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/guides/deploying.md",
            Some(json!({ "markdown": "# X\n", "expected_checksum": "0000" })),
        )
        .await;
    assert_eq!(status, 409, "{stale}");
    let (status, _) = ed
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/guides/deploying.md",
            Some(json!({ "markdown": doc["markdown"], "expected_checksum": checksum })),
        )
        .await;
    assert_eq!(status, 200);
    let (status, moved) = ed
        .send(
            reqwest::Method::POST,
            "/api/v1/domains/eng/reflection/move",
            Some(json!({ "from": "guides/deploying.md", "to": "ops/deploying.md" })),
        )
        .await;
    assert_eq!(status, 200, "{moved}");
    let (_, hits) = ed
        .get("/api/v1/domains/eng/reflection/search?q=night")
        .await;
    assert_eq!(hits["hits"][0]["path"], "ops/deploying.md");
    let (status, review) = ed.get("/api/v1/domains/eng/reflection/review").await;
    assert_eq!(status, 200);
    assert!(
        review["waiting_for_people"].is_array()
            && review["waiting_for_the_agent"].is_array()
            && review["queue"]["queue"].is_array()
    );
    let (status, _) = ed
        .send(
            reqwest::Method::DELETE,
            "/api/v1/domains/eng/reflections/ops/deploying.md",
            None,
        )
        .await;
    assert_eq!(status, 204);
    let (status, err) = ed
        .send(
            reqwest::Method::DELETE,
            "/api/v1/domains/eng/reflections/PACT.md",
            None,
        )
        .await;
    assert_eq!(status, 422, "{err}");
}

#[tokio::test]
async fn a_non_home_instance_answers_with_the_home_url() {
    let s = serve().await;
    let manifest_text = manifest("reflection: on\nreflection_home: https://team.example.com\n");
    std::fs::write(s.fx.root.join("MANIFEST.md"), manifest_text).unwrap();
    let ed = Session::login(s.addr, "ed").await;
    let (status, body) = ed.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(status, 200);
    assert_eq!(body["state"], "elsewhere");
    assert_eq!(body["home_url"], "https://team.example.com");
    let (status, err) = ed.get("/api/v1/domains/eng/reflection/tree").await;
    assert_eq!(status, 409);
    assert_eq!(err["home_url"], "https://team.example.com");
    assert_eq!(
        err["detail"],
        "this domain's Reflection lives at https://team.example.com"
    );
}

#[tokio::test]
async fn a_contributor_can_leave_a_domain() {
    let s = serve().await;
    let ann = Session::login(s.addr, "ann").await;
    // Leaving reveals nobody else: the listing and an eviction stay the 404
    // of a domain it cannot read as engrams.
    let (status, _) = ann.get("/api/v1/domains/eng/members").await;
    assert_eq!(status, 404, "a contributor does not list the members");
    let (status, _) = ann
        .send(
            reqwest::Method::DELETE,
            "/api/v1/domains/eng/members/vera",
            None,
        )
        .await;
    assert_eq!(status, 404, "nor learns whether another account is one");
    let (status, _) = ann
        .send(
            reqwest::Method::DELETE,
            "/api/v1/domains/eng/members/nobody",
            None,
        )
        .await;
    assert_eq!(status, 404);
    let (status, body) = ann
        .send(
            reqwest::Method::DELETE,
            "/api/v1/domains/eng/members/ann",
            None,
        )
        .await;
    assert_eq!(status, 204, "{body}");
    let (status, _) = ann.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(status, 404, "gone for good");
}

#[tokio::test]
async fn the_member_routes_take_both_levels() {
    let s = serve().await;
    let keeper = Session::login(s.addr, "keeper").await;
    s.auth
        .add_user("new", "new", None, Role::Viewer, "pw12345678")
        .await
        .unwrap();
    let (status, err) = keeper
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/members/new",
            Some(json!({ "level": "none" })),
        )
        .await;
    assert_eq!(
        status, 422,
        "knowledge none needs a Reflection level: {err}"
    );
    let (status, _) = keeper
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/members/new",
            Some(json!({ "level": "none", "reflection": "contributor" })),
        )
        .await;
    assert_eq!(status, 204);
    let (_, members) = keeper.get("/api/v1/domains/eng/members").await;
    let new = members["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["principal"] == "new")
        .unwrap();
    assert_eq!(
        (new["level"].as_str(), new["reflection"].as_str()),
        (Some("none"), Some("contributor"))
    );
    let vera = members["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["principal"] == "vera")
        .unwrap();
    assert_eq!(vera["reflection"], "default");
}

/// PACT.md is written by curators; a contributor and a reader propose a
/// change through a thread on it.
#[tokio::test]
async fn pact_is_written_by_curators_and_discussed_by_everyone() {
    let s = serve().await;
    let ed = Session::login(s.addr, "ed").await;
    let (status, made) = ed
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/PACT.md",
            Some(json!({ "markdown": "# How we write\n\n## Audience\n\nNew people.\n" })),
        )
        .await;
    assert_eq!(
        status, 200,
        "a knowledge editor curates and writes the pact: {made}"
    );
    let ann = Session::login(s.addr, "ann").await;
    let (status, err) = ann
        .send(
            reqwest::Method::PUT,
            "/api/v1/domains/eng/reflections/PACT.md",
            Some(json!({ "markdown": "# Mine\n" })),
        )
        .await;
    assert_eq!(status, 403, "{err}");
    assert!(
        err["detail"]
            .as_str()
            .unwrap()
            .contains("is edit, and curate is needed"),
        "{err}"
    );
    let vera = Session::login(s.addr, "vera").await;
    for who in [&ann, &vera] {
        let (status, thread) = who
            .send(reqwest::Method::POST, "/api/v1/domains/eng/reflection/threads", Some(json!({ "path": "PACT.md", "section": "Audience", "text": "Support staff too?" })))
            .await;
        assert_eq!(status, 201, "a proposal through a comment: {thread}");
    }
}

/// Knowledge `none` on the instance: no shared domain as engrams, every
/// shared Reflection at the instance Reflection level.
#[tokio::test]
async fn knowledge_none_on_the_instance_finds_its_shared_domain_through_the_reflection() {
    let s = serve_with(true).await;
    let nora = Session::login(s.addr, "nora").await;
    let (status, me) = nora.get("/api/v1/auth/me").await;
    assert_eq!(status, 200, "the instance gate lets it in: {me}");
    assert!(
        me.to_string().contains("\"none\"") && me.to_string().contains("\"contributor\""),
        "{me}"
    );
    let (_, domains) = nora.get("/api/v1/domains").await;
    assert!(
        !domains.to_string().contains("\"eng\""),
        "hidden as engrams: {domains}"
    );
    let (status, _) = nora
        .get("/api/v1/domains/eng/engrams/runbooks/deploy")
        .await;
    assert_eq!(status, 404);
    let (status, listing) = nora.get("/api/v1/reflection/domains").await;
    assert_eq!(status, 200);
    assert_eq!(listing["domains"][0]["domain"], "eng");
    assert_eq!(listing["domains"][0]["right"], "edit");
    assert_eq!(listing["domains"][0]["engrams_visible"], false);
    let (_, status) = nora.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(
        status["member"], false,
        "nothing to leave on a shared domain"
    );
    let (status, doc) = nora
        .get("/api/v1/domains/eng/reflections/guides/deploying.md")
        .await;
    assert_eq!(status, 200);
    assert!(
        !doc.to_string().contains("runbooks/deploy"),
        "no source engram: {doc}"
    );
}

/// Every instance-wide read the API serves, as an account at knowledge
/// `none`: none of them names the shared domain. The guard admits such an
/// account on every path, so this is what catches a read that forgets the
/// `hidden_for` screen.
#[tokio::test]
async fn no_instance_wide_read_names_a_shared_domain_to_knowledge_none() {
    let s = serve_with(true).await;
    let nora = Session::login(s.addr, "nora").await;
    for op in crate::support::MOUNTED_OPERATIONS {
        let Some(path) = op.strip_prefix("GET /api/v1") else {
            continue;
        };
        // Per-domain routes are covered above; the Reflection listing names
        // eng on purpose; the event stream never ends a body.
        // `/openapi.json` describes routes, and its examples may spell a
        // domain; it names no registered domain of this instance.
        if path.contains('{')
            || path.starts_with("/reflection")
            || path.starts_with("/auth")
            || path == "/events"
            || path == "/openapi.json"
        {
            continue;
        }
        let (_, body) = nora.get(&format!("/api/v1{path}")).await;
        assert!(
            !body.to_string().contains("\"eng\""),
            "GET {path} names eng to knowledge none: {body}"
        );
    }
}

/// The anonymous visitor of a public domain reads its Reflection, sources
/// included (it reads the engrams too), and cannot comment.
#[tokio::test]
async fn an_anonymous_visitor_reads_a_public_reflection_and_cannot_comment() {
    let s = serve_with(true).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let url = |path: &str| format!("http://{}{path}", s.addr);
    let doc: Value = client
        .get(url("/api/v1/domains/eng/reflections/guides/deploying.md"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        doc["sections"][0]["sources"][0]["permalink"], "runbooks/deploy",
        "{doc}"
    );
    let listing: Value = client
        .get(url("/api/v1/reflection/domains"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(listing["domains"][0]["right"], "read", "{listing}");
    let resp = client
        .post(url("/api/v1/domains/eng/reflection/threads"))
        .json(
            &json!({ "path": "guides/deploying.md", "section": "Night deploys", "text": "Hello?" }),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status().as_u16(),
        401,
        "a comment needs somebody to sign it"
    );
    assert!(
        !s.fx
            .root
            .join("reflections/guides/deploying.threads.md")
            .exists(),
        "no thread was written"
    );
}
