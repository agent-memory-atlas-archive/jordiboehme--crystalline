//! One instance serves a domain's Reflection on a shared database: the one
//! that holds the domain's host lock (R92). Every other instance answers
//! `hosted_elsewhere` and names the host; a takeover moves it.

use std::sync::Arc;

use crystalline_index::{Store, TursoStore};
use crystalline_service::{ReflectionCaller, ReflectionHome, ReflectionState};
use tokio::sync::Mutex;

#[cfg(feature = "postgres")]
use crate::fixture::instance_watched;
use crate::fixture::{Fx, engram, instance_on, manifest};

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

#[cfg(feature = "postgres")]
fn hosted_by(label: &str) -> ReflectionState {
    ReflectionState::HostedElsewhere {
        label: Some(label.to_string()),
    }
}

/// The refusal a non-host answers, in R92's words.
#[cfg(feature = "postgres")]
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
    use crate::fixture::scratch_schema;
    use crate::rest::{Session, serve_fx};

    let Some(scratch) = scratch_schema() else {
        return;
    };
    let open = || async {
        let store = crystalline_index::PostgresStore::open_in_schema(scratch.url(), scratch.name())
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
    assert!(
        s.fx.engine
            .claim_host("eng", true)
            .await
            .unwrap()
            .is_acquired()
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
    assert!(
        a.engine
            .claim_host("eng", true)
            .await
            .unwrap()
            .is_acquired()
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

    // A holder whose last heartbeat is a minute old is alive: the non-host
    // keeps refusing and names it.
    let gamma_beat = |beat: String| {
        let store = s.fx.engine.store();
        async move {
            let store = store.lock().await;
            let id = store.domain_id("eng").await.unwrap().unwrap();
            store
                .claim_domain_host(id, "gamma", "gamma", &beat, &beat, true)
                .await
                .unwrap();
        }
    };
    gamma_beat(crystalline_index::claim_window(60).1).await;
    assert_eq!(
        s.fx.engine.reflection_state("eng").await.unwrap(),
        hosted_by("gamma")
    );
    // A holder that sent no heartbeat for 90 seconds is taken over by the
    // next Reflection request, as a plain sync takes it, and the take-over
    // marks a host move from it.
    gamma_beat(crystalline_index::claim_window(91).1).await;
    assert_eq!(s.fx.engine.reflection_state("eng").await.unwrap(), LOCAL);
    let store = s.fx.engine.store();
    let store = store.lock().await;
    let id = store.domain_id("eng").await.unwrap().unwrap();
    assert_eq!(
        store.domain_host(id).await.unwrap().unwrap().instance_id,
        "beta"
    );
    let mark = store.host_move(id).await.unwrap().expect("a host move");
    assert_eq!(mark.claimant.as_deref(), Some("beta"));
    assert_eq!(mark.only_elsewhere.previous_host.as_deref(), Some("gamma"));
}

/// A host that shuts down gracefully releases its lock. The instances left
/// do not all serve the Reflection then: the first that is asked claims the
/// free lock and serves it, hands the domain to its watcher, and every other
/// instance answers `hosted_elsewhere` naming it, even when two ask at once.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_released_host_lock_goes_to_exactly_one_instance_on_postgres() {
    use crate::fixture::scratch_schema;

    let Some(scratch) = scratch_schema() else {
        return;
    };
    let open = || async {
        let store = crystalline_index::PostgresStore::open_in_schema(scratch.url(), scratch.name())
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
}

/// A host that crashed (or slept) keeps its lock until its heartbeat is 90
/// seconds old. Then two running daemons that want the domain at the same
/// moment, one through a sync and one through a Reflection request, do not
/// both get it: the claim is one conditional upsert, and the second waits
/// on the row the first wrote and finds a live heartbeat there. The winner
/// watches the domain and marks the host move from the old host; the old
/// host refuses from its next request and names the winner.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_stale_host_lock_goes_to_exactly_one_running_daemon_on_postgres() {
    let Some(db) = Shared::new() else {
        return;
    };
    let files = files();
    let files: Vec<(&str, &str)> = files.iter().map(|(p, b)| (*p, b.as_str())).collect();
    let alpha = instance(db.open().await, "alpha").await;
    let (beta, mut beta_watch) = instance_watched(db.open().await, "beta", &files).await;
    let (gamma, mut gamma_watch) = instance_watched(db.open().await, "gamma", &files).await;
    assert_eq!(
        gamma.engine.reflection_state("eng").await.unwrap(),
        hosted_by("alpha")
    );
    // Alpha stops: its last heartbeat is 91 seconds old.
    {
        let store = db.open().await;
        let store = store.lock().await;
        let id = store.domain_id("eng").await.unwrap().unwrap();
        let beat = crystalline_index::claim_window(91).1;
        store
            .claim_domain_host(id, "alpha", "alpha", &beat, &beat, true)
            .await
            .unwrap();
    }

    let (synced, asked) = tokio::join!(
        beta.engine.sync(Some("eng")),
        gamma.engine.reflection_state("eng")
    );
    let asked = asked.unwrap();
    let (winner, winner_name, winner_watch, loser_watch) = match (&synced, &asked) {
        (Ok(_), ReflectionState::HostedElsewhere { label }) => {
            assert_eq!(label.as_deref(), Some("beta"), "gamma names the winner");
            (&beta, "beta", &mut beta_watch, &mut gamma_watch)
        }
        (Err(e), ReflectionState::On { .. }) => {
            assert!(e.to_string().contains("is hosted by gamma"), "{e}");
            (&gamma, "gamma", &mut gamma_watch, &mut beta_watch)
        }
        other => panic!("exactly one takes the lock over: {other:?}"),
    };
    {
        let store = db.open().await;
        let store = store.lock().await;
        let id = store.domain_id("eng").await.unwrap().unwrap();
        assert_eq!(
            store.domain_host(id).await.unwrap().unwrap().instance_id,
            winner_name
        );
        // A Reflection request marks the move and leaves the walk to the
        // watcher; a sync marks it and its walk, which found every file the
        // old host wrote on this disk too, ends it at once.
        match store.host_move(id).await.unwrap() {
            Some(mark) => {
                assert_eq!(winner_name, "gamma", "{mark:?}");
                assert_eq!(mark.claimant.as_deref(), Some("gamma"));
                assert_eq!(mark.only_elsewhere.previous_host.as_deref(), Some("alpha"));
            }
            None => assert_eq!(winner_name, "beta"),
        }
    }
    match winner_watch.try_recv() {
        Ok(crystalline_service::engine::WatchEvent::Add(name, root)) => {
            assert_eq!((name.as_str(), root), ("eng", winner.root.clone()));
        }
        other => panic!("the winner hands eng to its watcher: {other:?}"),
    }
    assert!(loser_watch.try_recv().is_err(), "the loser arms nothing");

    // The old host comes back: it refuses from its next request.
    let err = alpha
        .engine
        .write_reflection(
            &crate::docs::write("guides/late.md", "# Late\n"),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), refusal(winner_name));
}

/// Instances name themselves by their `service.public_url` host: the
/// non-host's status, its refusal and its host listing show that name, not
/// the instance id. Two instances behind one address are told apart by the
/// start of the later one's id.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_host_is_named_by_its_address_and_twins_by_a_short_id_on_postgres() {
    use crate::fixture::instance_at;

    let Some(db) = Shared::new() else {
        return;
    };
    let files = files();
    let files: Vec<(&str, &str)> = files.iter().map(|(p, b)| (*p, b.as_str())).collect();
    const URL: &str = "https://crystalline.example.org/";
    let alpha = instance_at(db.open().await, "3f2a-alpha", URL, &files).await;
    let beta = instance_at(db.open().await, "9c1b-beta", URL, &files).await;
    assert_eq!(alpha.engine.reflection_state("eng").await.unwrap(), LOCAL);
    assert_eq!(
        beta.engine.reflection_state("eng").await.unwrap(),
        hosted_by("crystalline.example.org")
    );
    let err = beta
        .engine
        .write_reflection(
            &crate::docs::write("guides/new.md", "# New\n"),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), refusal("crystalline.example.org"));
    let stats = beta
        .engine
        .store()
        .lock()
        .await
        .domain_stats()
        .await
        .unwrap();
    let eng = stats.iter().find(|d| d.name == "eng").unwrap();
    assert_eq!(eng.host_instance_id.as_deref(), Some("3f2a-alpha"));
    assert_eq!(eng.host_label.as_deref(), Some("crystalline.example.org"));

    beta.engine.sync_take_over(Some("eng"), true).await.unwrap();
    let err = alpha
        .engine
        .write_reflection(
            &crate::docs::write("guides/new.md", "# New\n"),
            &ReflectionCaller::owner(),
        )
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), refusal("crystalline.example.org (9c1b)"));
    assert_eq!(
        alpha.engine.reflection_state("eng").await.unwrap(),
        hosted_by("crystalline.example.org (9c1b)"),
        "the second instance under one name adds the start of its id"
    );
}

/// A Postgres schema of its own, dropped with the value even when the test
/// fails, and an opener for one store on it per instance.
#[cfg(feature = "postgres")]
struct Shared {
    scratch: crystalline_index::ScratchSchema,
}

#[cfg(feature = "postgres")]
impl Shared {
    fn new() -> Option<Shared> {
        Some(Shared {
            scratch: crate::fixture::scratch_schema()?,
        })
    }

    async fn open(&self) -> Arc<Mutex<dyn Store>> {
        let store = crystalline_index::PostgresStore::open_in_schema(
            self.scratch.url(),
            self.scratch.name(),
        )
        .await
        .expect("open the postgres test schema");
        Arc::new(Mutex::new(store)) as Arc<Mutex<dyn Store>>
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
}

/// A page or file only the previous host's disk has keeps its row, and no
/// write here recreates it over that row: a whole-page write, a page move
/// onto its path, an upload to its path and a file move onto it are refused
/// with the remedy, the rows stay alpha's and beta's disk stays without
/// them. A new page and a new file beside them are written as usual.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn no_write_recreates_a_page_or_file_only_the_previous_host_has_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha_writes(&alpha).await;
    alpha.engine.release_hosts().await;
    assert_eq!(beta.engine.reflection_state("eng").await.unwrap(), LOCAL);
    beta.engine.sync(Some("eng")).await.unwrap();
    let rows_before = {
        let store = beta.engine.store();
        let store = store.lock().await;
        let did = store.domain_id("eng").await.unwrap().unwrap();
        (
            store.get_reflection(did, ALPHA_PAGE).await.unwrap(),
            store
                .get_asset(crystalline_index::AssetTable::Reflection, did, ALPHA_FILE)
                .await
                .unwrap(),
        )
    };
    let owner = ReflectionCaller::owner();

    beta.engine
        .write_reflection(
            &crate::docs::write("guides/other.md", &crate::fixture::page("Other")),
            &owner,
        )
        .await
        .expect("a page nobody else has is written");
    beta.engine
        .reflection_asset_write("eng", "assets/b.png", crate::assets::PNG.to_vec(), &owner)
        .await
        .expect("a file nobody else has is written");

    let refusals = [
        beta.engine
            .write_reflection(
                &crate::docs::write(ALPHA_PAGE, &crate::fixture::page("Rewritten")),
                &owner,
            )
            .await
            .map(|_| ()),
        beta.engine
            .move_reflection("eng", "guides/other.md", ALPHA_PAGE, &owner)
            .await
            .map(|_| ()),
        beta.engine
            .reflection_asset_write("eng", ALPHA_FILE, crate::assets::PNG.to_vec(), &owner)
            .await
            .map(|_| ()),
        beta.engine
            .move_reflection_asset("eng", "assets/b.png", ALPHA_FILE, &owner)
            .await
            .map(|_| ()),
    ];
    for refused in refusals {
        let err = refused.expect_err("a path only alpha has is not written here");
        let text = err.to_string();
        assert!(
            matches!(err, crystalline_service::EngineError::Conflict(_))
                && text.contains("exists only on alpha")
                && text.contains("crystalline sync --domain eng --accept-disk"),
            "{text}"
        );
    }
    for rel in [
        format!("reflections/{ALPHA_PAGE}"),
        format!("reflections/{ALPHA_FILE}"),
    ] {
        assert!(!beta.root.join(&rel).exists(), "nothing is written: {rel}");
    }
    assert!(beta.root.join("reflections/guides/other.md").is_file());
    let store = beta.engine.store();
    let store = store.lock().await;
    let did = store.domain_id("eng").await.unwrap().unwrap();
    assert_eq!(
        (
            store.get_reflection(did, ALPHA_PAGE).await.unwrap(),
            store
                .get_asset(crystalline_index::AssetTable::Reflection, did, ALPHA_FILE)
                .await
                .unwrap(),
        ),
        rows_before,
        "alpha's rows are untouched"
    );
}

/// The same for an engram only alpha's disk has: an overwriting capture
/// onto its path, an engram move onto it, an edit of it and a delete of it
/// are refused with the remedy, and so is a delete of a Reflection file only alpha has, which
/// would otherwise drop its only shared copy unseen. The rows stay alpha's;
/// a new engram beside them is written as usual.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn no_write_recreates_an_engram_only_the_previous_host_has_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha_writes(&alpha).await;
    alpha.engine.release_hosts().await;
    assert_eq!(beta.engine.reflection_state("eng").await.unwrap(), LOCAL);
    beta.engine.sync(Some("eng")).await.unwrap();
    let engram_row = |fx: &Fx| {
        let store = fx.engine.store();
        async move {
            let store = store.lock().await;
            let did = store.domain_id("eng").await.unwrap().unwrap();
            store.engram_content(did, ALPHA_ENGRAM).await.unwrap()
        }
    };
    let before = engram_row(&beta).await;
    assert!(before.is_some(), "alpha's engram has a row");

    beta.engine
        .write_engram(&crate::fixture::write_params(
            "Other",
            Some("runbooks"),
            "- [fact] written on beta",
        ))
        .await
        .expect("an engram nobody else has is written");
    let moved: crystalline_service::params::MoveParams =
        serde_json::from_value(serde_json::json!({
            "identifier": "runbooks/other",
            "domain": "eng",
            "destination": ALPHA_ENGRAM,
        }))
        .unwrap();
    // A plain capture is refused by the permalink the row holds; an
    // overwrite finds no file here and would land over the row.
    let mut again = crate::fixture::write_params(
        "Only On Alpha",
        Some("runbooks"),
        "- [fact] written again on beta",
    );
    again.overwrite = true;
    let refusals = [
        beta.engine.write_engram(&again).await.map(|_| ()),
        beta.engine
            .move_engram(&moved, &crystalline_service::Scope::Unrestricted)
            .await
            .map(|_| ()),
        beta.engine
            .reflection_asset_delete("eng", ALPHA_FILE, &ReflectionCaller::owner())
            .await,
        beta.engine
            .edit_engram(&crystalline_service::params::EditParams {
                identifier: "runbooks/only-on-alpha".into(),
                domain: "eng".into(),
                operation: "append".into(),
                content: Some("- [fact] added on beta".into()),
                ..Default::default()
            })
            .await
            .map(|_| ()),
        beta.engine
            .delete_engram(&crystalline_service::params::DeleteParams {
                identifier: "runbooks/only-on-alpha".into(),
                domain: "eng".into(),
                expected_checksum: None,
            })
            .await
            .map(|_| ()),
    ];
    for refused in refusals {
        let err = refused.expect_err("a path only alpha has is not written here");
        let text = err.to_string();
        assert!(
            matches!(err, crystalline_service::EngineError::Conflict(_))
                && text.contains("exists only on alpha")
                && text.contains("crystalline sync --domain eng --accept-disk"),
            "{text}"
        );
    }
    assert!(!beta.root.join(ALPHA_ENGRAM).exists(), "nothing is written");
    assert!(
        beta.root.join("runbooks/other.md").is_file(),
        "nothing moved"
    );
    assert_eq!(engram_row(&beta).await, before, "alpha's row is untouched");
    assert_eq!(alpha_rows(&beta).await, (true, true, true));
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

    assert!(
        beta.engine
            .claim_host("eng", false)
            .await
            .unwrap()
            .is_acquired()
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
}

/// A host that lost the lock while it walked writes nothing. Alpha scans,
/// beta takes the domain over and marks the move before alpha applies:
/// alpha's apply is refused, so its disk, which has every file, cannot end
/// beta's move, and beta's own walk keeps and reports the rows its disk
/// lacks.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_deposed_host_walk_neither_applies_nor_ends_the_move_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha_writes(&alpha).await;

    let (entered, release) = alpha.engine.hold_next_apply_until();
    let walking = tokio::spawn({
        let engine = alpha.engine.clone();
        async move { engine.sync(Some("eng")).await }
    });
    entered.notified().await;
    assert!(
        beta.engine
            .claim_host("eng", true)
            .await
            .unwrap()
            .is_acquired()
    );
    release.notify_one();
    let refused = walking.await.unwrap().unwrap_err();
    assert!(
        refused.to_string().contains("instance beta hosts it now"),
        "{refused}"
    );
    assert_eq!(
        alpha.engine.reflection_state("eng").await.unwrap(),
        hosted_by("beta"),
        "alpha stops hosting at once"
    );

    let synced = beta.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(synced["reports"][0]["only_elsewhere"], only_on_alpha());
    assert_eq!(alpha_rows(&beta).await, (true, true, true));
}

/// The Reflection backup waits while a move is unresolved; the walk that
/// ends it marks the backup, so the edits made meanwhile are backed up
/// without waiting for the next one. Here the move ends by an engram copied
/// over, which changes no Reflection row on its own.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn the_walk_that_ends_a_move_marks_the_backup_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha
        .engine
        .write_engram(&crate::fixture::write_params(
            "Only On Alpha",
            Some("runbooks"),
            "- [fact] written on alpha",
        ))
        .await
        .unwrap();
    alpha.engine.release_hosts().await;
    let synced = beta.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(synced["reports"][0]["only_elsewhere"]["engrams"], 1);
    beta.engine.take_reflection_backup_marks();

    std::fs::copy(alpha.root.join(ALPHA_ENGRAM), beta.root.join(ALPHA_ENGRAM)).unwrap();
    let synced = beta.engine.sync(Some("eng")).await.unwrap();
    let report = &synced["reports"][0];
    assert!(report["only_elsewhere"].is_null(), "{report}");
    assert_eq!(report["reflections_changed"], 0, "{report}");
    assert_eq!(
        beta.engine.take_reflection_backup_marks(),
        vec!["eng".to_string()]
    );
}

/// An engine built with no instance id cannot hold a host lock, so on a
/// shared database it walks no file domain: a full sync and a reindex leave
/// the domain out with the reason in their answer, a named and a targeted
/// sync are refused, and the host's move and the rows only the old host has
/// stay. (Every production opener gives its engine this machine's id.)
#[cfg(feature = "postgres")]
#[tokio::test]
async fn an_engine_without_an_instance_id_walks_no_file_domain_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    let beta = instance(db.open().await, "beta").await;
    alpha_writes(&alpha).await;
    alpha.engine.release_hosts().await;
    beta.engine.sync(Some("eng")).await.unwrap();
    let store = beta.engine.store();
    let did = store.lock().await.domain_id("eng").await.unwrap().unwrap();
    let marked = store.lock().await.host_move(did).await.unwrap();
    assert!(marked.is_some());

    let config_path = beta.tmp.path().join("config.yaml");
    let cfg = crystalline_core::config::load_yaml(&config_path).unwrap();
    let anonymous = crystalline_service::Engine::new(db.open().await, cfg, None, Some(config_path));
    let full = anonymous.sync(None).await.unwrap();
    let skipped = full["skipped"].to_string();
    assert!(
        skipped.contains("\"eng\"") && skipped.contains("no instance id"),
        "{full}"
    );
    let named = anonymous.sync(Some("eng")).await.unwrap_err().to_string();
    assert!(named.contains("crystalline serve"), "{named}");
    let targeted = anonymous
        .sync_paths("eng", vec![ALPHA_ENGRAM.to_string()])
        .await
        .unwrap_err()
        .to_string();
    assert!(targeted.contains("no instance id"), "{targeted}");
    let reindexed = anonymous.reindex(false).await.unwrap();
    assert_eq!(reindexed["reports"], serde_json::json!([]), "{reindexed}");
    let skipped = reindexed["skipped"].to_string();
    assert!(
        skipped.contains("\"eng\"") && skipped.contains("no instance id"),
        "the reason is in the answer: {reindexed}"
    );

    assert_eq!(store.lock().await.host_move(did).await.unwrap(), marked);
    assert_eq!(alpha_rows(&beta).await, (true, true, true));
}

/// A one-shot command of machine `id` on `fx`'s folder and configuration:
/// the engine every daemonless command opens on a shared database.
#[cfg(feature = "postgres")]
async fn one_shot(db: &Shared, fx: &Fx, id: &str) -> Arc<crystalline_service::Engine> {
    let config_path = fx.tmp.path().join("config.yaml");
    let cfg = crystalline_core::config::load_yaml(&config_path).unwrap();
    Arc::new(
        crystalline_service::Engine::new(db.open().await, cfg, None, Some(config_path))
            .with_state_dir(fx.tmp.path().join("state"))
            .with_one_shot_instance_id(id.to_string()),
    )
}

/// `eng`'s lock row and host move, read on a store of its own.
#[cfg(feature = "postgres")]
async fn lock_and_move(
    db: &Shared,
) -> (
    Option<crystalline_index::DomainHost>,
    Option<crystalline_index::HostMove>,
) {
    let store = db.open().await;
    let store = store.lock().await;
    let did = store.domain_id("eng").await.unwrap().unwrap();
    (
        store.domain_host(did).await.unwrap(),
        store.host_move(did).await.unwrap(),
    )
}

/// A one-shot command never claims a domain to serve its Reflection: it
/// sends no heartbeat and holds nothing past a walk, and a read changes no
/// durable state. On a free lock it answers as a non-host, says to start
/// the daemon and leaves no lock row and no host-move mark behind. While
/// this machine holds the lock live (its daemon, an `mcp --embedded`
/// session), the command serves the Reflection from the same disk and
/// leaves that lock as it was; a stale claim of this machine serves nothing.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_one_shot_command_claims_no_domain_to_serve_its_reflection_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    alpha.engine.release_hosts().await;
    assert_eq!(lock_and_move(&db).await, (None, None), "a free lock");

    let cmd = one_shot(&db, &alpha, "beta").await;
    assert_eq!(
        cmd.reflection_state("eng").await.unwrap(),
        ReflectionState::HostedElsewhere { label: None }
    );
    let status = cmd
        .reflection_status("eng", &ReflectionCaller::owner())
        .await
        .unwrap();
    assert_eq!(status["state"], "hosted_elsewhere", "{status}");
    assert!(status["host_label"].is_null(), "{status}");
    let refused = cmd
        .read_reflection_tree("eng", &ReflectionCaller::owner())
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(
        refused,
        crystalline_service::engine::REFUSED_NOT_BY_A_COMMAND,
        "in plain words"
    );
    let p = crystalline_service::params::ReflectParams {
        limit: Some(100),
        ..Default::default()
    };
    let queue = cmd.reflect(&p, &crate::docs::agent()).await.unwrap();
    assert_eq!(queue["queue"], serde_json::json!([]), "{queue}");
    assert_eq!(
        lock_and_move(&db).await,
        (None, None),
        "no lock row and no mark after the reads"
    );

    // Beta's daemon holds the lock live: the command serves the Reflection
    // and claims nothing, so the daemon's own claim still names the lock.
    let token = {
        let store = db.open().await;
        let store = store.lock().await;
        let did = store.domain_id("eng").await.unwrap().unwrap();
        let (now, stale_before) = crystalline_index::claim_window(90);
        match store
            .claim_domain_host(did, "beta", "beta", &now, &stale_before, false)
            .await
            .unwrap()
        {
            crystalline_index::HostClaim::Acquired { token } => token,
            other => panic!("{other:?}"),
        }
    };
    assert_eq!(cmd.reflection_state("eng").await.unwrap(), LOCAL);
    cmd.read_reflection_tree("eng", &ReflectionCaller::owner())
        .await
        .unwrap();
    let store = db.open().await;
    let store = store.lock().await;
    let did = store.domain_id("eng").await.unwrap().unwrap();
    assert!(
        store
            .release_domain_host(did, "beta", &token)
            .await
            .unwrap(),
        "the command did not claim over the daemon"
    );

    // Any live claim of this machine counts, the row cannot tell a daemon
    // from an `mcp --embedded` session; a claim of this machine that went
    // stale does not, since another instance may take it at any time.
    let long_ago = "2000-01-01T00:00:00+00:00";
    store
        .claim_domain_host(did, "beta", "beta", long_ago, long_ago, true)
        .await
        .unwrap();
    drop(store);
    assert_eq!(
        cmd.reflection_state("eng").await.unwrap(),
        ReflectionState::HostedElsewhere { label: None },
        "a stale claim of this machine serves nothing"
    );
}

/// A one-shot command's targeted sync of a domain another live instance
/// hosts is refused with the host's label and the ways on, so the verb that
/// ran it (an import, a discard) says why its files are not indexed. An
/// instance that heartbeats (the daemon's watcher) passes over it quietly,
/// and its full sync names the reason for the domain it leaves out.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_one_shot_targeted_sync_names_the_host_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    // Gamma, labelled apart from its id, hosts the domain live.
    {
        let store = db.open().await;
        let store = store.lock().await;
        let did = store.domain_id("eng").await.unwrap().unwrap();
        let live = "2999-01-01T00:00:00+00:00";
        assert!(
            store
                .claim_domain_host(did, "gamma-id", "gamma-laptop", live, live, true)
                .await
                .unwrap()
                .is_acquired()
        );
    }
    let reason = "domain 'eng' is hosted by gamma-laptop (last heartbeat 2999-01-01T00:00:00+00:00); run crystalline sync --domain eng --take-over, or run this on the host";

    let cmd = one_shot(&db, &alpha, "beta").await;
    let refused = cmd
        .sync_paths("eng", vec!["runbooks/deploy.md".to_string()])
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(refused, reason);

    let quiet = alpha
        .engine
        .sync_paths("eng", vec!["runbooks/deploy.md".to_string()])
        .await
        .unwrap();
    assert_eq!(quiet.domain, "eng");
    let full = alpha.engine.sync(None).await.unwrap();
    assert_eq!(full["skipped"][0]["domain"], "eng", "{full}");
    assert_eq!(full["skipped"][0]["reason"], reason, "{full}");
    let named = alpha
        .engine
        .sync(Some("eng"))
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(named, reason);
    assert_eq!(
        lock_and_move(&db).await.0.unwrap().instance_id,
        "gamma-id",
        "the host keeps its lock"
    );
}

/// A one-shot command's release never deletes a later claim under the
/// same instance id. The command claims the free lock and holds before its
/// apply; this machine's daemon claims the domain too; the command's
/// release then misses, the daemon keeps hosting, and the daemon's own
/// release still matches.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_command_release_leaves_the_daemon_claim_after_it_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    alpha.engine.release_hosts().await;

    let cmd = one_shot(&db, &alpha, "beta").await;
    let (entered, release) = cmd.hold_next_apply_until();
    let walking = tokio::spawn({
        let cmd = cmd.clone();
        async move { cmd.sync(Some("eng")).await }
    });
    entered.notified().await;
    let daemon = instance(db.open().await, "beta").await;
    assert!(
        daemon
            .engine
            .claim_host("eng", false)
            .await
            .unwrap()
            .is_acquired()
    );
    release.notify_one();
    walking.await.unwrap().unwrap();
    assert_eq!(
        lock_and_move(&db).await.0.map(|h| h.instance_id).as_deref(),
        Some("beta"),
        "the daemon's lock stays"
    );
    daemon.engine.release_hosts().await;
    assert!(
        lock_and_move(&db).await.0.is_none(),
        "the daemon's own release matches"
    );
}

/// Two one-shot commands of one machine walk the same domain at once. The
/// first one's release, while the second still walks, leaves the second
/// one's claim, so the second walk applies: it still holds the lock.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn two_commands_of_one_machine_keep_each_other_claim_on_postgres() {
    let Some(db) = Shared::new() else { return };
    let alpha = instance(db.open().await, "alpha").await;
    alpha.engine.release_hosts().await;

    let first = one_shot(&db, &alpha, "beta").await;
    let second = one_shot(&db, &alpha, "beta").await;
    let (first_in, first_go) = first.hold_next_apply_until();
    let (second_in, second_go) = second.hold_next_apply_until();
    let first_walk = tokio::spawn({
        let first = first.clone();
        async move { first.sync(Some("eng")).await }
    });
    first_in.notified().await;
    let second_walk = tokio::spawn({
        let second = second.clone();
        async move { second.sync(Some("eng")).await }
    });
    second_in.notified().await;
    first_go.notify_one();
    first_walk.await.unwrap().unwrap();
    assert_eq!(
        lock_and_move(&db).await.0.map(|h| h.instance_id).as_deref(),
        Some("beta"),
        "the second command's lock stays"
    );
    second_go.notify_one();
    let applied = second_walk.await.unwrap();
    assert!(applied.is_ok(), "the second walk applies: {applied:?}");
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
