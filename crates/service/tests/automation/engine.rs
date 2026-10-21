//! The automation engine module: status, lease, run record and sharing for
//! the reflect and evolve loops.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Duration, FixedOffset};
use crystalline_core::automation::{Loop, RunOutcome, RunReport};
use crystalline_core::config::{GitHubConfig, GlobalConfig};
use crystalline_index::TursoStore;
use crystalline_service::engine::ShareActor;
use crystalline_service::params::{DiscussParams, WriteReflectionParams};
use crystalline_service::rest::{AuthStore, Role};
use crystalline_service::{DomainAccess, Engine, EngineError, ReflectionCaller, Scope};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::fixture::{Fx, engram, fixture, manifest};
use crate::support::MockProvider;

/// When every test starts.
const START: &str = "2026-10-21T10:00:00+00:00";

fn at(rfc3339: &str) -> DateTime<FixedOffset> {
    DateTime::parse_from_rfc3339(rfc3339).unwrap()
}

fn start() -> DateTime<FixedOffset> {
    at(START)
}

const PAGE: &str = "# D\n\n## Night deploys\n<!-- r:aaaa1111 -->\n\nDeploys run at night.\n\n## Day deploys\n<!-- r:bbbb2222 -->\n\nSome run by day.\n";

fn person() -> ReflectionCaller {
    ReflectionCaller::person(Scope::Unrestricted, "jordi")
}

fn agent() -> ReflectionCaller {
    ReflectionCaller::agent(Scope::Unrestricted, "claude-code", false)
}

/// `eng` with Reflection on, the page `d.md` written by the agent (so it is
/// reflected and its baseline is set), and the clock at [`START`].
async fn reflecting() -> Fx {
    let fx = fixture(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    fx.engine.set_automation_now(Some(start()));
    fx.engine
        .write_reflection(
            &WriteReflectionParams {
                domain: "eng".into(),
                path: "d.md".into(),
                markdown: Some(PAGE.into()),
                ..Default::default()
            },
            &agent(),
        )
        .await
        .unwrap();
    fx
}

/// A person opens a thread on `section` of `d.md`; it waits for the agent.
async fn open_thread(fx: &Fx, section: &str, text: &str) -> String {
    let opened = fx
        .engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                action: Some("open".into()),
                path: Some("d.md".into()),
                section: Some(section.into()),
                text: Some(text.into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();
    assert_eq!(opened["waiting_on"], "agent", "{opened}");
    opened["id"].as_str().unwrap().to_string()
}

async fn step(fx: &Fx, caller: &ReflectionCaller, action: &str, id: &str, text: &str) {
    fx.engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                action: Some(action.into()),
                path: Some("d.md".into()),
                thread: Some(id.into()),
                text: Some(text.into()),
                ..Default::default()
            },
            caller,
        )
        .await
        .unwrap();
}

/// The status of `lp` on `eng` as the machine owner.
async fn status(engine: &Engine, lp: Loop) -> Value {
    status_of(engine, lp, "eng").await
}

async fn status_of(engine: &Engine, lp: Loop, domain: &str) -> Value {
    let answer = engine
        .automation_status(lp, &[domain.to_string()], &Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(answer["domains"].as_array().unwrap().len(), 1, "{answer}");
    answer["domains"][0].clone()
}

async fn take(engine: &Engine, lp: Loop, domain: &str, runner: &str) -> String {
    let taken = engine
        .automation_lease_take(lp, domain, runner, &Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(taken["renew_secs"], 60, "{taken}");
    taken["token"].as_str().unwrap().to_string()
}

fn report(outcome: RunOutcome, done: u64, summary: &str) -> RunReport {
    RunReport {
        started_at: START.to_string(),
        outcome,
        done,
        summary: summary.to_string(),
    }
}

async fn record(engine: &Engine, lp: Loop, domain: &str, token: &str, r: RunReport) -> Value {
    engine
        .automation_run_record(lp, domain, token, &r, &Scope::Unrestricted)
        .await
        .unwrap()
}

// --- what is due ------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nothing_due_on_a_quiet_domain() {
    let fx = reflecting().await;
    for lp in [Loop::Reflect, Loop::Evolve] {
        let s = status(&fx.engine, lp).await;
        assert_eq!(s["domain"], "eng", "{s}");
        assert_eq!(s["loop"], lp.as_str(), "{s}");
        assert_eq!(s["due"], false, "{s}");
        assert_eq!(s["left_for_person"], 0, "{s}");
        assert_eq!(s["running"], Value::Null, "{s}");
        assert_eq!(s["runs_on"], Value::Null, "{s}");
        assert_eq!(s["last_run"], Value::Null, "{s}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_waiting_thread_makes_reflect_due() {
    let fx = reflecting().await;
    open_thread(&fx, "aaaa1111", "Still true?").await;
    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["due"], true, "{s}");
    assert_eq!(s["counts"]["waiting_for_the_agent"], 1, "{s}");
    assert_eq!(s["counts"]["feedback"], 0, "{s}");
    // Evolve is another loop: a thread is nothing to it.
    assert_eq!(status(&fx.engine, Loop::Evolve).await["due"], false);
}

/// A judgment-only domain beside one with a reciprocal relation wired from
/// one end, which is mechanical.
const STUB: &str = "A title and almost nothing else.\n\n- [context] meant to be filled in later";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_mechanical_finding_makes_evolve_due_and_judgment_does_not() {
    let fx = fixture(&[("stub-note.md", &engram("Stub note", "stub-note", STUB))]).await;
    fx.engine.set_automation_now(Some(start()));
    let s = status(&fx.engine, Loop::Evolve).await;
    assert!(s["counts"]["judgment"].as_u64().unwrap() > 0, "{s}");
    assert_eq!(s["counts"]["mechanical"], 0, "{s}");
    assert_eq!(s["due"], false, "judgment findings are never due: {s}");

    write_summary_pair(&fx.root);
    fx.engine.sync(None).await.unwrap();
    let s = status(&fx.engine, Loop::Evolve).await;
    assert_eq!(s["counts"]["mechanical"], 1, "{s}");
    assert_eq!(s["due"], true, "{s}");
}

/// `summary-doc` summarizes `full-text-doc`, which never says it is
/// summarized: V103, a mechanical finding.
fn write_summary_pair(root: &Path) {
    std::fs::write(
        root.join("summary-doc.md"),
        engram(
            "Summary doc",
            "summary-doc",
            "The distilled version of the migration write-up.\n\n- summarizes [[Full text doc]]\n- [context] written after the migration closed",
        ),
    )
    .unwrap();
    std::fs::write(
        root.join("full-text-doc.md"),
        engram(
            "Full text doc",
            "full-text-doc",
            "The full migration write-up with the shard tables.\n\n- [context] the source the summary was cut from\n- [lesson] keep the tables out of the summary",
        ),
    )
    .unwrap();
}

// --- the lease --------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_held_lease_reports_running_and_is_not_due() {
    let fx = reflecting().await;
    open_thread(&fx, "aaaa1111", "Still true?").await;
    take(&fx.engine, Loop::Reflect, "eng", "k8s").await;

    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["due"], false, "{s}");
    assert_eq!(s["running"]["runner"], "k8s", "{s}");
    assert_eq!(s["running"]["taken_at"], START, "{s}");
    assert_eq!(s["running"]["renewed_at"], START, "{s}");
    assert!(s["running"].get("token").is_none(), "{s}");

    let refused = fx
        .engine
        .automation_lease_take(Loop::Reflect, "eng", "cli", &Scope::Unrestricted)
        .await
        .unwrap_err();
    assert!(refused.to_string().contains("already running"), "{refused}");
    // The other loop's lease is its own.
    take(&fx.engine, Loop::Evolve, "eng", "cli").await;
}

/// Review Focus 4.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_crashed_runner_expires_after_five_minutes() {
    let fx = reflecting().await;
    open_thread(&fx, "aaaa1111", "Still true?").await;
    let token = take(&fx.engine, Loop::Reflect, "eng", "k8s").await;
    fx.engine
        .set_automation_now(Some(start() + Duration::seconds(120)));
    fx.engine
        .automation_lease_renew(Loop::Reflect, "eng", &token, &Scope::Unrestricted)
        .await
        .unwrap();

    // Then the runner dies. Five minutes after the last renewal it still runs.
    fx.engine
        .set_automation_now(Some(start() + Duration::seconds(120 + 299)));
    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["running"]["runner"], "k8s", "{s}");
    assert_eq!(s["due"], false, "{s}");

    fx.engine
        .set_automation_now(Some(start() + Duration::seconds(120 + 301)));
    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["running"], Value::Null, "{s}");
    assert_eq!(s["due"], true, "{s}");

    let fresh = take(&fx.engine, Loop::Reflect, "eng", "cli").await;
    assert_ne!(fresh, token);
    let renewed = fx
        .engine
        .automation_lease_renew(Loop::Reflect, "eng", &token, &Scope::Unrestricted)
        .await;
    assert!(renewed.is_err(), "the dead runner's token is gone");
    let runs = fx
        .engine
        .automation_runs(Loop::Reflect, "eng", 10, &Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(runs["runs"][0]["outcome"], "expired", "{runs}");
    assert_eq!(runs["runs"][0]["runner"], "k8s", "{runs}");
}

// --- what a run leaves ------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_item_left_by_a_run_is_not_due_until_it_changes() {
    let fx = reflecting().await;
    let id = open_thread(&fx, "aaaa1111", "Should we move them?").await;
    let token = take(&fx.engine, Loop::Reflect, "eng", "cli").await;
    let recorded = record(
        &fx.engine,
        Loop::Reflect,
        "eng",
        &token,
        report(RunOutcome::Done, 0, "Left the thread for a person."),
    )
    .await;
    assert_eq!(recorded["run"]["left"], 1, "{recorded}");

    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["due"], false, "{s}");
    assert_eq!(s["left_for_person"], 1, "{s}");
    assert_eq!(
        s["running"],
        Value::Null,
        "the record released the lease: {s}"
    );
    assert_eq!(s["last_run"]["outcome"], "done", "{s}");
    assert_eq!(
        s["last_run"]["summary"], "Left the thread for a person.",
        "{s}"
    );

    // A new message on the thread is a change: due again.
    step(&fx, &person(), "answer", &id, "Yes, by Friday please.").await;
    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["due"], true, "{s}");
    assert_eq!(s["left_for_person"], 0, "{s}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_capped_run_leaves_the_rest_due() {
    let fx = reflecting().await;
    let first = open_thread(&fx, "aaaa1111", "Still true?").await;
    open_thread(&fx, "bbbb2222", "Which days?").await;
    let token = take(&fx.engine, Loop::Reflect, "eng", "cli").await;
    step(&fx, &agent(), "answer", &first, "Yes, still true.").await;
    let recorded = record(
        &fx.engine,
        Loop::Reflect,
        "eng",
        &token,
        report(RunOutcome::StoppedAtCap, 1, "Answered one thread."),
    )
    .await;
    assert_eq!(recorded["run"]["left"], 0, "{recorded}");
    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["due"], true, "{s}");
    assert_eq!(s["counts"]["waiting_for_the_agent"], 1, "{s}");
    assert_eq!(s["left_for_person"], 0, "{s}");
    assert_eq!(s["last_run"]["outcome"], "stopped_at_cap", "{s}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_run_parks_nothing() {
    let fx = reflecting().await;
    open_thread(&fx, "aaaa1111", "Still true?").await;
    let token = take(&fx.engine, Loop::Reflect, "eng", "cli").await;
    record(
        &fx.engine,
        Loop::Reflect,
        "eng",
        &token,
        report(RunOutcome::Failed, 0, &"x".repeat(5000)),
    )
    .await;
    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["due"], true, "{s}");
    assert_eq!(s["left_for_person"], 0, "{s}");
    assert_eq!(s["last_run"]["outcome"], "failed", "{s}");
    assert_eq!(
        s["last_run"]["summary"].as_str().unwrap().len(),
        2048,
        "the summary is capped"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unchanged_item_keeps_its_version_a_day_later() {
    let fx = reflecting().await;
    write_summary_pair(&fx.root);
    fx.engine.sync(None).await.unwrap();
    open_thread(&fx, "aaaa1111", "Still true?").await;
    for lp in [Loop::Reflect, Loop::Evolve] {
        assert_eq!(status(&fx.engine, lp).await["due"], true, "{lp}");
        let token = take(&fx.engine, lp, "eng", "cli").await;
        record(
            &fx.engine,
            lp,
            "eng",
            &token,
            report(RunOutcome::Done, 0, "Left it."),
        )
        .await;
    }
    for when in [start(), start() + Duration::days(1)] {
        fx.engine.set_automation_now(Some(when));
        for lp in [Loop::Reflect, Loop::Evolve] {
            let s = status(&fx.engine, lp).await;
            assert_eq!(s["due"], false, "{lp} at {when}: {s}");
            assert!(s["left_for_person"].as_u64().unwrap() >= 1, "{lp}: {s}");
        }
    }
}

// --- who runs ---------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_shared_domain_runs_only_on_its_home() {
    let fx = fixture(&[(
        "MANIFEST.md",
        &manifest("reflection: on\nreflection_home: https://home.example\n"),
    )])
    .await;
    let s = status(&fx.engine, Loop::Reflect).await;
    assert_eq!(s["runs_on"], "https://home.example", "{s}");
    assert_eq!(s["due"], false, "{s}");
    let refused = fx
        .engine
        .automation_lease_take(Loop::Reflect, "eng", "cli", &Scope::Unrestricted)
        .await
        .unwrap_err();
    assert_eq!(refused.to_string(), "runs on https://home.example");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rights_are_checked() {
    let fx = reflecting().await;
    open_thread(&fx, "aaaa1111", "Still true?").await;
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
    let vera = Scope::User {
        account: "vera".into(),
        admin: false,
    };
    for lp in [Loop::Reflect, Loop::Evolve] {
        let all = fx.engine.automation_status(lp, &[], &vera).await.unwrap();
        assert_eq!(all["domains"], serde_json::json!([]), "{lp}: {all}");
        let named = fx
            .engine
            .automation_status(lp, &["eng".to_string()], &vera)
            .await
            .unwrap_err();
        assert!(matches!(named, EngineError::Forbidden(_)), "{lp}: {named}");
        let take = fx
            .engine
            .automation_lease_take(lp, "eng", "cli", &vera)
            .await
            .unwrap_err();
        assert!(matches!(take, EngineError::Forbidden(_)), "{lp}: {take}");
        let runs = fx
            .engine
            .automation_runs(lp, "eng", 10, &vera)
            .await
            .unwrap_err();
        assert!(matches!(runs, EngineError::Forbidden(_)), "{lp}: {runs}");
    }
    // The owner sees the domain.
    let all = fx
        .engine
        .automation_status(Loop::Reflect, &[], &Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(all["domains"][0]["domain"], "eng", "{all}");
}

// --- sharing ----------------------------------------------------------------

fn team_manifest_direct() -> Vec<u8> {
    b"---\ntype: manifest\ntitle: Team\npermalink: manifest\ntags:\n  - manifest\nstatus: current\nrecorded_at: 2026-01-01\nsharing: direct\n---\n\n# Team\n\n## Scope\n\n- shared knowledge\n\n## When to Use\n\n- always\n".to_vec()
}

/// A team domain `brand` registered from the forge, whose MANIFEST shares
/// directly, with the clock at [`START`].
async fn direct_team(
    tmp: &tempfile::TempDir,
    mock: Arc<MockProvider>,
) -> (Engine, std::path::PathBuf) {
    let commit = mock.add_commit(BTreeMap::from([(
        "MANIFEST.md".to_string(),
        team_manifest_direct(),
    )]));
    mock.set_branch("main", &commit);
    let cfg = GlobalConfig {
        github: Some(GitHubConfig {
            enabled: Some(true),
            ..GitHubConfig::default()
        }),
        ..GlobalConfig::default()
    };
    let store = TursoStore::open_in_memory().await.unwrap();
    let eng = Engine::new(
        Arc::new(Mutex::new(store)),
        cfg,
        None,
        Some(tmp.path().join("config.yaml")),
    )
    .with_origin_provider(mock)
    .with_origins_dir(tmp.path().join("origins"))
    .with_state_dir(tmp.path().to_path_buf());
    let root = tmp.path().join("brand-knowledge");
    eng.origin_add(
        "acme/brand-knowledge",
        Some("brand"),
        None,
        None,
        Some(root.to_str().unwrap()),
    )
    .await
    .unwrap();
    eng.set_automation_now(Some(start()));
    std::fs::create_dir_all(root.join("notes")).unwrap();
    (eng, root)
}

fn shared_files(shared: &Value) -> Vec<String> {
    let mut files: Vec<String> = shared["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f.as_str().unwrap().to_string())
        .collect();
    files.sort();
    files
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn share_opens_a_pull_request_under_direct_sharing() {
    let tmp = tempfile::tempdir().unwrap();
    let mock = Arc::new(MockProvider::new());
    let (eng, root) = direct_team(&tmp, mock.clone()).await;
    let token = take(&eng, Loop::Evolve, "brand", "k8s").await;
    std::fs::write(
        root.join("notes/fix.md"),
        engram("Fix", "notes/fix", "the run's fix"),
    )
    .unwrap();
    let shared = eng
        .automation_share(
            Loop::Evolve,
            "brand",
            &token,
            "Fixed one finding.",
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    assert_eq!(shared["outcome"], "shared", "{shared}");
    assert_eq!(shared_files(&shared), vec!["notes/fix.md"], "{shared}");
    let url = shared["url"].as_str().unwrap().to_string();
    assert!(
        mock.calls()
            .iter()
            .any(|c| c.starts_with("create_proposal")),
        "a pull request, not a direct commit: {:?}",
        mock.calls()
    );
    assert!(
        !mock
            .calls()
            .iter()
            .any(|c| c.starts_with("update_branch:main:")),
        "{:?}",
        mock.calls()
    );
    let recorded = record(
        &eng,
        Loop::Evolve,
        "brand",
        &token,
        report(RunOutcome::Done, 1, "Fixed one finding."),
    )
    .await;
    assert_eq!(recorded["run"]["pr_url"], url.as_str(), "{recorded}");

    // A second run with nothing new has nothing to share.
    let again = take(&eng, Loop::Evolve, "brand", "k8s").await;
    let nothing = eng
        .automation_share(
            Loop::Evolve,
            "brand",
            &again,
            "Nothing.",
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    assert_eq!(nothing["outcome"], "nothing_to_share", "{nothing}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn share_takes_only_the_runs_files_when_people_had_unshared_work() {
    let tmp = tempfile::tempdir().unwrap();
    let mock = Arc::new(MockProvider::new());
    let (eng, root) = direct_team(&tmp, mock.clone()).await;
    // A person's unshared edit, before the run takes its lease.
    std::fs::write(
        root.join("notes/person.md"),
        engram("Person", "notes/person", "a person's draft"),
    )
    .unwrap();
    let token = take(&eng, Loop::Evolve, "brand", "k8s").await;
    std::fs::write(
        root.join("notes/fix.md"),
        engram("Fix", "notes/fix", "the run's fix"),
    )
    .unwrap();
    let shared = eng
        .automation_share(
            Loop::Evolve,
            "brand",
            &token,
            "Fixed one finding.",
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    assert_eq!(shared["outcome"], "shared", "{shared}");
    assert_eq!(shared_files(&shared), vec!["notes/fix.md"], "{shared}");
    // The person's work is still theirs to share; the run's fix waits in
    // the pull request.
    let left = eng
        .local_changes("brand", &ShareActor::Owner)
        .await
        .unwrap();
    let paths: Vec<&str> = left["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["path"].as_str().unwrap())
        .collect();
    assert!(paths.contains(&"notes/person.md"), "{left}");
}
