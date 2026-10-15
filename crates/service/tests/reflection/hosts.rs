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

/// A Postgres schema of its own, and an opener for one store on it per
/// instance.
#[cfg(feature = "postgres")]
struct Shared {
    url: String,
    schema: String,
}

#[cfg(feature = "postgres")]
impl Shared {
    fn new() -> Option<Shared> {
        let url = crate::fixture::pg_url()?;
        Some(Shared {
            url,
            schema: crate::fixture::unique_schema(),
        })
    }

    async fn open(&self) -> Arc<Mutex<dyn Store>> {
        let store = crystalline_index::PostgresStore::open_in_schema(&self.url, &self.schema)
            .await
            .expect("open the postgres test schema");
        Arc::new(Mutex::new(store)) as Arc<Mutex<dyn Store>>
    }

    async fn drop_schema(self) {
        crystalline_index::PostgresStore::open_in_schema(&self.url, &self.schema)
            .await
            .unwrap()
            .drop_schema()
            .await
            .unwrap();
    }
}

/// The engram, the page and the file only alpha's disk has.
#[cfg(feature = "postgres")]
const ALPHA_ENGRAM: &str = "runbooks/only-on-alpha.md";
#[cfg(feature = "postgres")]
const ALPHA_PAGE: &str = "guides/kept.md";
#[cfg(feature = "postgres")]
const ALPHA_FILE: &str = "assets/flow.png";

/// Alpha writes an engram, a Reflection page (a section with an id, so a
/// missing baseline would read as feedback) and a Reflection file: rows in
/// the shared database, files on alpha's disk only.
#[cfg(feature = "postgres")]
async fn alpha_writes(alpha: &Fx) {
    alpha
        .engine
        .write_engram(&crate::fixture::write_params(
            "Only On Alpha",
            Some("runbooks"),
            "- [fact] written on alpha",
        ))
        .await
        .unwrap();
    assert!(alpha.root.join(ALPHA_ENGRAM).is_file());
    alpha
        .engine
        .write_reflection(
            &crate::docs::write(ALPHA_PAGE, &crate::fixture::page("Kept")),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap();
    alpha
        .engine
        .reflection_asset_write(
            "eng",
            ALPHA_FILE,
            crate::assets::PNG.to_vec(),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap();
}

/// Whether the shared rows still hold alpha's engram, page and file.
#[cfg(feature = "postgres")]
async fn alpha_rows(fx: &Fx) -> (bool, bool, bool) {
    let store = fx.engine.store();
    let store = store.lock().await;
    let did = store.domain_id("eng").await.unwrap().unwrap();
    let engram = store
        .file_stamps(did)
        .await
        .unwrap()
        .contains_key(ALPHA_ENGRAM);
    let page = store
        .get_reflection(did, ALPHA_PAGE)
        .await
        .unwrap()
        .is_some();
    let file = store
        .get_asset(crystalline_index::AssetTable::Reflection, did, ALPHA_FILE)
        .await
        .unwrap()
        .is_some();
    (engram, page, file)
}

/// The domain's whole queue, every kind, one page.
#[cfg(feature = "postgres")]
async fn queue_of(fx: &Fx) -> Vec<serde_json::Value> {
    let p = crystalline_service::params::ReflectParams {
        limit: Some(100),
        ..Default::default()
    };
    fx.engine.reflect(&p, &crate::docs::agent()).await.unwrap()["queue"]
        .as_array()
        .unwrap()
        .clone()
}

/// The `host_moved` items of a queue.
#[cfg(feature = "postgres")]
fn host_moved(queue: &[serde_json::Value]) -> Vec<&serde_json::Value> {
    queue.iter().filter(|i| i["what"] == "host_moved").collect()
}

/// `eng`'s row of the status report.
#[cfg(feature = "postgres")]
async fn eng_stats(fx: &Fx) -> serde_json::Value {
    let status = fx.engine.status_report().await.unwrap();
    status["domains"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["name"] == "eng")
        .cloned()
        .expect("eng has a row")
}

/// The counts alpha's writes leave behind on another instance's disk.
#[cfg(feature = "postgres")]
fn only_on_alpha() -> serde_json::Value {
    serde_json::json!({
        "previous_host": "alpha",
        "engrams": 1,
        "attachments": 0,
        "pages": 1,
        "files": 1,
    })
}

/// Disk stays the truth on a shared database (Task 50). Alpha writes an
/// engram, a page and a file and shuts down cleanly; beta takes the free
/// lock on a Reflection request and syncs. Beta's disk has none of the
/// three, so its walk keeps their rows and writes nothing to its disk, and
/// the domain reports them as only on alpha: in the sync report, in the
/// status and as one `host_moved` queue item that stands in for the
/// feedback a page without a baseline would otherwise raise. A later walk
/// keeps them too.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_new_host_keeps_the_rows_it_cannot_see_and_reports_them_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha_writes(&alpha).await;
    alpha.engine.release_hosts().await;

    assert_eq!(beta.engine.reflection_state("eng").await.unwrap(), LOCAL);
    let synced = beta.engine.sync(Some("eng")).await.unwrap();
    let report = &synced["reports"][0];
    assert_eq!(report["only_elsewhere"], only_on_alpha(), "{report}");
    assert_eq!(report["deleted"], 0, "{report}");
    assert_eq!(alpha_rows(&beta).await, (true, true, true));
    for rel in [
        ALPHA_ENGRAM.to_string(),
        format!("reflections/{ALPHA_PAGE}"),
        format!("reflections/{ALPHA_FILE}"),
    ] {
        assert!(!beta.root.join(&rel).exists(), "nothing is written: {rel}");
    }

    let queue = queue_of(&beta).await;
    let moved = host_moved(&queue);
    assert_eq!(moved.len(), 1, "{queue:?}");
    assert_eq!(moved[0]["kind"], "update");
    assert_eq!(moved[0]["domain"], "eng");
    assert_eq!(moved[0]["only_elsewhere"], only_on_alpha());
    assert!(
        !queue
            .iter()
            .any(|i| i["kind"] == "feedback" && i["path"] == ALPHA_PAGE),
        "no feedback for a page whose baseline is on alpha's disk: {queue:?}"
    );
    assert_eq!(eng_stats(&beta).await["only_elsewhere"], only_on_alpha());

    // A second walk, the watcher's catch-up or the next startup, keeps them.
    let again = beta.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(again["reports"][0]["only_elsewhere"], only_on_alpha());
    assert_eq!(alpha_rows(&beta).await, (true, true, true));

    db.drop_schema().await;
}

/// Two complete walks that race right after a take-over both keep the rows
/// they did not see: the mark is read where each walk applies and cleared
/// only by a walk that found nothing missing.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_concurrent_walk_during_a_take_over_deletes_nothing_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha_writes(&alpha).await;
    alpha.engine.release_hosts().await;

    assert_eq!(
        beta.engine.claim_host("eng", false).await.unwrap(),
        crystalline_index::HostClaim::Acquired
    );
    let (sync, reindex, other) = tokio::join!(
        beta.engine.sync(Some("eng")),
        beta.engine.reindex(false),
        beta.engine.sync(None),
    );
    sync.unwrap();
    reindex.unwrap();
    other.unwrap();
    assert_eq!(alpha_rows(&beta).await, (true, true, true));
    assert_eq!(eng_stats(&beta).await["only_elsewhere"], only_on_alpha());

    db.drop_schema().await;
}

/// The normal restart of the one host is not a take-over: a page and an
/// engram deleted by hand while it was down lose their rows on its startup
/// sync, after a clean shutdown (the lock row is gone, the domain row names
/// alpha as the last host) and after a crash (the lock row still names it).
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_restart_of_the_same_host_deletes_a_hand_deleted_file_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    alpha_writes(&alpha).await;

    // A clean shutdown releases the lock.
    alpha.engine.release_hosts().await;
    std::fs::remove_file(alpha.root.join(ALPHA_ENGRAM)).unwrap();
    std::fs::remove_file(alpha.root.join("reflections").join(ALPHA_PAGE)).unwrap();
    let alpha = crate::fixture::restart_on(db.open().await, "alpha", alpha).await;
    assert_eq!(alpha_rows(&alpha).await, (false, false, true));
    assert!(eng_stats(&alpha).await["only_elsewhere"].is_null());

    // A crash leaves the lock row naming alpha.
    std::fs::remove_file(alpha.root.join("reflections").join(ALPHA_FILE)).unwrap();
    let alpha = crate::fixture::restart_on(db.open().await, "alpha", alpha).await;
    assert_eq!(alpha_rows(&alpha).await, (false, false, false));
    assert!(host_moved(&queue_of(&alpha).await).is_empty());

    db.drop_schema().await;
}

/// What exists only on the previous host is reported until it is resolved:
/// a take-over sync run with `--accept-disk` still reports first, a walk
/// after a person copied a file over drops it from the counts, and
/// `crystalline sync --domain eng --accept-disk` then runs one ordinary
/// walk that deletes the rows still missing and ends the report.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn accept_disk_drops_the_rows_only_elsewhere_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha_writes(&alpha).await;
    alpha.engine.release_hosts().await;
    // A take-over sync run with --accept-disk at once drops nothing it never
    // reported: the move is new, so this walk counts and keeps.
    let first = beta
        .engine
        .sync_with(Some("eng"), true, true)
        .await
        .unwrap();
    assert_eq!(first["reports"][0]["only_elsewhere"], only_on_alpha());
    assert_eq!(alpha_rows(&beta).await, (true, true, true));
    assert_eq!(eng_stats(&beta).await["only_elsewhere"], only_on_alpha());

    // The page is copied over, with its baseline.
    let from = alpha.root.join("reflections");
    let to = beta.root.join("reflections");
    std::fs::create_dir_all(to.join("guides")).unwrap();
    std::fs::copy(from.join(ALPHA_PAGE), to.join(ALPHA_PAGE)).unwrap();
    let synced = beta.engine.sync(Some("eng")).await.unwrap();
    let mut left = only_on_alpha();
    left["pages"] = serde_json::json!(0);
    assert_eq!(synced["reports"][0]["only_elsewhere"], left);
    assert_eq!(
        host_moved(&queue_of(&beta).await)[0]["only_elsewhere"],
        left
    );

    let accepted = beta
        .engine
        .sync_with(Some("eng"), false, true)
        .await
        .unwrap();
    let report = &accepted["reports"][0];
    assert!(report["only_elsewhere"].is_null(), "{report}");
    assert_eq!(report["deleted"], 1, "{report}");
    assert_eq!(alpha_rows(&beta).await, (false, true, false));
    assert!(host_moved(&queue_of(&beta).await).is_empty());
    assert!(eng_stats(&beta).await["only_elsewhere"].is_null());
    // The next walk deletes as any walk does.
    std::fs::remove_file(to.join(ALPHA_PAGE)).unwrap();
    beta.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(alpha_rows(&beta).await, (false, false, false));

    db.drop_schema().await;
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
