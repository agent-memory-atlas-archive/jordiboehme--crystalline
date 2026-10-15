//! One instance serves a domain's Reflection on a shared database: the one
//! that holds the domain's host lock (R92). Every other instance answers
//! `hosted_elsewhere` and names the host; a takeover moves it.

use std::sync::Arc;

use crystalline_index::{Store, TursoStore};
use crystalline_service::{ReflectionCaller, ReflectionHome, ReflectionState};
use tokio::sync::Mutex;

use crate::fixture::{Fx, engram, instance_on, instance_watched, manifest};

fn files() -> Vec<(&'static str, String)> {
    vec![
        ("MANIFEST.md", manifest("reflection: on\n")),
        (
            "runbooks/deploy.md",
            engram("Deploy", "runbooks/deploy", "- [fact] deploys run at night"),
        ),
    ]
}

async fn instance(store: Arc<Mutex<dyn Store>>, id: &str) -> Fx {
    let files = files();
    let files: Vec<(&str, &str)> = files.iter().map(|(p, b)| (*p, b.as_str())).collect();
    instance_on(store, id, &files).await
}

const LOCAL: ReflectionState = ReflectionState::On {
    home: ReflectionHome::Local,
};

fn hosted_by(label: &str) -> ReflectionState {
    ReflectionState::HostedElsewhere {
        label: Some(label.to_string()),
    }
}

/// The refusal a non-host answers, in R92's words.
fn refusal(label: &str) -> String {
    format!(
        "this domain's Reflection is served by {label}; move it with crystalline serve --take-over"
    )
}

/// Two instances on one Postgres schema: the first claims `eng`'s host lock
/// and serves its Reflection; the second refuses every write with 409, says
/// `hosted_elsewhere` with the host's label in its status and its listing,
/// and serves the Reflection once it takes the lock over.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_reflection_on_a_shared_database_is_served_by_its_host_only_on_postgres() {
    use crate::fixture::{pg_url, unique_schema};
    use crate::rest::{Session, serve_fx};

    let Some(url) = pg_url() else { return };
    let schema = unique_schema();
    let open = || async {
        let store = crystalline_index::PostgresStore::open_in_schema(&url, &schema)
            .await
            .expect("open the postgres test schema");
        Arc::new(Mutex::new(store)) as Arc<Mutex<dyn Store>>
    };
    let a = instance(open().await, "alpha").await;
    let b = instance(open().await, "beta").await;
    assert_eq!(a.engine.reflection_state("eng").await.unwrap(), LOCAL);
    assert_eq!(
        b.engine.reflection_state("eng").await.unwrap(),
        hosted_by("alpha")
    );
    // The host knows it hosts without the store: a long sync holding the
    // lock does not stall its Reflection polls (Task 38's lock-free answer).
    {
        let store = a.engine.store();
        let _held = store.lock().await;
        let state = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            a.engine.reflection_state("eng"),
        )
        .await
        .expect("the host answers while the store lock is held")
        .unwrap();
        assert_eq!(state, LOCAL);
    }
    let host = a
        .engine
        .reflection_status("eng", &ReflectionCaller::owner())
        .await
        .unwrap();
    assert_eq!(host["state"], "on", "{host}");
    assert!(host["host_label"].is_null(), "{host}");

    let s = serve_fx(b, false).await;
    let ed = Session::login(s.addr, "ed").await;
    let (status, body) = ed.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["state"], "hosted_elsewhere", "{body}");
    assert_eq!(body["host_label"], "alpha", "{body}");
    assert!(body["home"].is_null(), "{body}");
    assert!(body["home_url"].is_null(), "{body}");
    assert_eq!(body["enabled"], true, "{body}");
    let (status, listing) = ed.get("/api/v1/reflection/domains").await;
    assert_eq!(status, 200, "{listing}");
    let row = &listing["domains"][0];
    assert_eq!(row["domain"], "eng", "{listing}");
    assert_eq!(row["state"], "hosted_elsewhere", "{listing}");
    assert_eq!(row["host_label"], "alpha", "{listing}");
    assert!(row["home"].is_null(), "{listing}");
    assert!(row["home_url"].is_null(), "{listing}");
    assert_eq!(row["open_threads"], 0, "{listing}");

    const PAGE: &str = "/api/v1/domains/eng/reflections/guides/new.md";
    let page = serde_json::json!({ "markdown": "# New\n", "create": true });
    let (status, err) = ed
        .send(reqwest::Method::PUT, PAGE, Some(page.clone()))
        .await;
    assert_eq!(status, 409, "{err}");
    assert_eq!(err["detail"], refusal("alpha"), "{err}");
    const FILE: &str = "/api/v1/domains/eng/reflection/assets/diagrams/flow.png";
    let (status, err) = ed.put_bytes(FILE, crate::assets::PNG).await;
    assert_eq!(status, 409, "{err}");
    assert_eq!(err["detail"], refusal("alpha"), "{err}");
    assert!(
        !s.fx.root.join("reflections/guides/new.md").exists()
            && !s
                .fx
                .root
                .join("reflections/assets/diagrams/flow.png")
                .exists(),
        "a non-host writes nothing"
    );

    // A takeover moves the Reflection: the new host serves it at once, and
    // the old one refuses from its next gated request, before any heartbeat.
    // Each side announces the move once, as `switched`, so a reader re-reads
    // the status.
    let mut new_host = s.fx.engine.changes().subscribe();
    let mut old_host = a.engine.changes().subscribe();
    assert_eq!(
        s.fx.engine.claim_host("eng", true).await.unwrap(),
        crystalline_index::HostClaim::Acquired
    );
    s.fx.engine.claim_host("eng", false).await.unwrap();
    assert_eq!(
        switched(&mut new_host),
        1,
        "a renewed claim announces nothing"
    );
    assert_eq!(s.fx.engine.reflection_state("eng").await.unwrap(), LOCAL);
    let (status, body) = ed.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["state"], "on", "{body}");
    assert!(body["host_label"].is_null(), "{body}");
    let (status, made) = ed.send(reqwest::Method::PUT, PAGE, Some(page)).await;
    assert_eq!(status, 200, "the new host serves the write: {made}");
    let (status, up) = ed.put_bytes(FILE, crate::assets::PNG).await;
    assert_eq!(status, 200, "and the file: {up}");
    let err = a
        .engine
        .write_reflection(
            &crate::docs::write("guides/old.md", "# Old\n"),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        refusal("beta"),
        "refused with no heartbeat"
    );
    assert!(!a.root.join("reflections/guides/old.md").exists());
    assert_eq!(switched(&mut old_host), 1);
    assert_eq!(
        a.engine.reflection_state("eng").await.unwrap(),
        hosted_by("beta")
    );
    a.engine.renew_hosts().await;
    assert_eq!(
        switched(&mut old_host),
        0,
        "the heartbeat finds nothing left"
    );

    // And back: a room open on the host that lost the lock saves nothing
    // from its next save on.
    assert_eq!(
        a.engine.claim_host("eng", true).await.unwrap(),
        crystalline_index::HostClaim::Acquired
    );
    let err =
        s.fx.engine
            .save_reflection_room(
                "eng",
                "guides/new.md",
                "# New\n\nMore.\n",
                "",
                &crystalline_service::SectionAuthors::default(),
                false,
            )
            .await
            .unwrap_err()
            .to_string();
    assert!(err.contains("is not on here any more"), "{err}");
    let kept = std::fs::read_to_string(s.fx.root.join("reflections/guides/new.md")).unwrap();
    assert!(
        !kept.contains("More."),
        "the room's text is not saved: {kept}"
    );
    let (_, body) = ed.get("/api/v1/domains/eng/reflection").await;
    assert_eq!(body["state"], "hosted_elsewhere", "{body}");
    assert_eq!(body["host_label"], "alpha", "{body}");

    // A holder that stopped heartbeating still holds the lock: nothing claims
    // it until an instance syncs the domain or starts with --take-over, so a
    // non-host keeps refusing and names it.
    {
        let store = s.fx.engine.store();
        let store = store.lock().await;
        let id = store.domain_id("eng").await.unwrap().unwrap();
        let long_ago = "2000-01-01T00:00:00+00:00";
        store
            .claim_domain_host(id, "gamma", "gamma", long_ago, long_ago, true)
            .await
            .unwrap();
    }
    assert_eq!(
        s.fx.engine.reflection_state("eng").await.unwrap(),
        hosted_by("gamma")
    );

    crystalline_index::PostgresStore::open_in_schema(&url, &schema)
        .await
        .unwrap()
        .drop_schema()
        .await
        .unwrap();
}

/// A host that shuts down gracefully releases its lock. The instances left
/// do not all serve the Reflection then: the first that is asked claims the
/// free lock and serves it, hands the domain to its watcher, and every other
/// instance answers `hosted_elsewhere` naming it, even when two ask at once.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_released_host_lock_goes_to_exactly_one_instance_on_postgres() {
    use crate::fixture::{pg_url, unique_schema};

    let Some(url) = pg_url() else { return };
    let schema = unique_schema();
    let open = || async {
        let store = crystalline_index::PostgresStore::open_in_schema(&url, &schema)
            .await
            .expect("open the postgres test schema");
        Arc::new(Mutex::new(store)) as Arc<Mutex<dyn Store>>
    };
    let files = files();
    let files: Vec<(&str, &str)> = files.iter().map(|(p, b)| (*p, b.as_str())).collect();
    let alpha = instance(open().await, "alpha").await;
    let (beta, mut beta_watch) = instance_watched(open().await, "beta", &files).await;
    let (gamma, mut gamma_watch) = instance_watched(open().await, "gamma", &files).await;
    assert_eq!(
        beta.engine.reflection_state("eng").await.unwrap(),
        hosted_by("alpha")
    );
    alpha.engine.release_hosts().await;

    let (b, g) = tokio::join!(
        beta.engine.reflection_state("eng"),
        gamma.engine.reflection_state("eng")
    );
    let (b, g) = (b.unwrap(), g.unwrap());
    let (winner, loser, winner_watch, loser_watch, winner_name) = match (&b, &g) {
        (ReflectionState::On { .. }, _) => {
            (&beta, &gamma, &mut beta_watch, &mut gamma_watch, "beta")
        }
        (_, ReflectionState::On { .. }) => {
            (&gamma, &beta, &mut gamma_watch, &mut beta_watch, "gamma")
        }
        _ => panic!("one of the two serves: beta {b:?}, gamma {g:?}"),
    };
    assert_eq!(
        (b.clone(), g.clone()),
        if winner_name == "beta" {
            (LOCAL, hosted_by("beta"))
        } else {
            (hosted_by("gamma"), LOCAL)
        },
        "exactly one serves and the other names it"
    );
    match winner_watch.try_recv() {
        Ok(crystalline_service::engine::WatchEvent::Add(name, root)) => {
            assert_eq!((name.as_str(), root), ("eng", winner.root.clone()));
        }
        other => panic!("the winner hands eng to its watcher: {other:?}"),
    }
    assert!(loser_watch.try_recv().is_err(), "the loser arms nothing");
    winner
        .engine
        .write_reflection(
            &crate::docs::write("guides/won.md", "# Won\n"),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap();
    let err = loser
        .engine
        .write_reflection(
            &crate::docs::write("guides/lost.md", "# Lost\n"),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), refusal(winner_name));
    assert_eq!(
        alpha.engine.reflection_state("eng").await.unwrap(),
        hosted_by(winner_name),
        "the released host does not take it back by asking"
    );

    crystalline_index::PostgresStore::open_in_schema(&url, &schema)
        .await
        .unwrap()
        .drop_schema()
        .await
        .unwrap();
}

/// The pages a host wrote live on its own disk and in the shared rows.
/// When another instance takes the lock over, its first complete walk must
/// not drop the rows of those pages: they go back to the new host's disk
/// first, so the new host serves them. A file under `reflections/assets/`
/// keeps its bytes on the old host's disk only, so its row is kept through
/// that walk. Both the claim of a Reflection request and the claim of a
/// sync (the startup path) write the pages back.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_new_host_keeps_the_pages_the_old_host_wrote_on_postgres() {
    use crate::fixture::{pg_url, unique_schema};

    let Some(url) = pg_url() else { return };
    let schema = unique_schema();
    let open = || async {
        let store = crystalline_index::PostgresStore::open_in_schema(&url, &schema)
            .await
            .expect("open the postgres test schema");
        Arc::new(Mutex::new(store)) as Arc<Mutex<dyn Store>>
    };
    let alpha = instance(open().await, "alpha").await;
    let beta = instance(open().await, "beta").await;
    let gamma = instance(open().await, "gamma").await;
    let page = "# Kept\n\nWritten on alpha.\n";
    alpha
        .engine
        .write_reflection(
            &crate::docs::write("guides/kept.md", page),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap();
    alpha
        .engine
        .reflection_asset_write(
            "eng",
            "assets/flow.png",
            crate::assets::PNG.to_vec(),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap();
    let store = alpha.engine.store();
    let did = store.lock().await.domain_id("eng").await.unwrap().unwrap();
    let rows = || async {
        let store = store.lock().await;
        (
            store.get_reflection(did, "guides/kept.md").await.unwrap(),
            store
                .get_asset(
                    crystalline_index::AssetTable::Reflection,
                    did,
                    "assets/flow.png",
                )
                .await
                .unwrap(),
        )
    };

    // A Reflection request claims the free lock; the daemon's watcher then
    // syncs the domain, a complete walk of the new host's disk.
    alpha.engine.release_hosts().await;
    assert_eq!(beta.engine.reflection_state("eng").await.unwrap(), LOCAL);
    let on_beta = beta.root.join("reflections/guides/kept.md");
    assert!(on_beta.exists(), "the page is back on beta's disk");
    beta.engine.sync(Some("eng")).await.unwrap();
    let (kept, file) = rows().await;
    assert!(
        kept.expect("the page row survives the walk")
            .content
            .contains("Written on alpha."),
        "the page keeps alpha's text"
    );
    assert!(file.is_some(), "the file row survives the first walk");
    let read = beta
        .engine
        .read_reflection("eng", "guides/kept.md", &ReflectionCaller::owner())
        .await
        .unwrap();
    assert!(read.to_string().contains("Written on alpha."), "{read}");

    // A sync's claim (the startup path, and --take-over) does the same.
    beta.engine.release_hosts().await;
    let on_gamma = gamma.root.join("reflections/guides/kept.md");
    assert!(!on_gamma.exists());
    gamma.engine.sync(Some("eng")).await.unwrap();
    assert!(on_gamma.exists(), "the page is back on gamma's disk");
    let (kept, file) = rows().await;
    assert!(kept.is_some(), "the page row survives gamma's first walk");
    assert!(file.is_some(), "and the file row");

    crystalline_index::PostgresStore::open_in_schema(&url, &schema)
        .await
        .unwrap()
        .drop_schema()
        .await
        .unwrap();
}

/// How many `switched` events for `eng` the bus holds.
#[cfg(feature = "postgres")]
fn switched(
    rx: &mut tokio::sync::broadcast::Receiver<crystalline_service::changes::Envelope>,
) -> usize {
    use crystalline_service::changes::{Change, ReflectionChangeKind};
    let mut heard = 0;
    while let Ok(envelope) = rx.try_recv() {
        if let Change::Reflection(change) = envelope.change
            && change.kind == ReflectionChangeKind::Switched
        {
            assert_eq!((change.domain.as_str(), change.path.as_str()), ("eng", ""));
            heard += 1;
        }
    }
    heard
}

/// On Turso a database is one instance's own, so the host lock never moves a
/// Reflection away: an engine that does not hold the lock (here a second
/// engine on the same store) still serves it.
#[tokio::test]
async fn a_turso_instance_always_serves_its_reflection() {
    let store: Arc<Mutex<dyn Store>> =
        Arc::new(Mutex::new(TursoStore::open_in_memory().await.unwrap()));
    let a = instance(store.clone(), "alpha").await;
    let b = instance(store, "beta").await;
    for (fx, page) in [(&a, "guides/a.md"), (&b, "guides/b.md")] {
        assert_eq!(fx.engine.reflection_state("eng").await.unwrap(), LOCAL);
        let status = fx
            .engine
            .reflection_status("eng", &ReflectionCaller::owner())
            .await
            .unwrap();
        assert_eq!(status["state"], "on", "{status}");
        assert!(status["host_label"].is_null(), "{status}");
        fx.engine
            .write_reflection(
                &crate::docs::write(page, "# Page\n"),
                &ReflectionCaller::owner(),
            )
            .await
            .unwrap();
    }
}
