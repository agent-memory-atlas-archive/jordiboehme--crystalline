//! The backup branch.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crystalline_core::config::{GitHubConfig, OriginConfig, ServiceConfig};
use crystalline_remote::reflections_backup::{BACKUP_BRANCH, BackupOutcome};
use crystalline_service::reflection_backup::BackupCause;

use crate::docs::{agent, write};
use crate::fixture::{Fx, engram, fixture_with, manifest};
use crate::support::MockProvider;

const HOME: &str = "https://kb.example.com";

/// How the home fixture is set up.
struct Home {
    /// Whether `eng` is connected to `acme/kb`.
    origin: bool,
    /// Extra MANIFEST lines.
    extra: &'static str,
}

const CONNECTED: Home = Home {
    origin: true,
    extra: "",
};

async fn home_with(mock: Arc<MockProvider>, home: Home) -> Fx {
    let fx = fixture_with(
        &[
            (
                "MANIFEST.md",
                &manifest(&format!(
                    "reflection: on\nreflection_home: {HOME}\n{}",
                    home.extra
                )),
            ),
            (
                "runbooks/deploy.md",
                &engram("Deploy", "runbooks/deploy", "- [fact] deploys run at night"),
            ),
        ],
        |cfg, _base| {
            if home.origin {
                cfg.domains.get_mut("eng").unwrap().origin = Some(OriginConfig {
                    repo: "acme/kb".into(),
                    path: None,
                    branch: Some("main".into()),
                    poll_secs: None,
                });
            }
            cfg.service = Some(ServiceConfig {
                public_url: Some(HOME.into()),
                ..Default::default()
            });
            cfg.github = Some(GitHubConfig {
                enabled: Some(true),
                ..Default::default()
            });
        },
    )
    .await;
    let engine = Arc::try_unwrap(fx.engine).ok().expect("one handle");
    let engine = Arc::new(engine.with_origin_provider(mock));
    Fx { engine, ..fx }
}

async fn home(mock: Arc<MockProvider>) -> Fx {
    home_with(mock, CONNECTED).await
}

fn main_commit(mock: &MockProvider) {
    let files = BTreeMap::from([("runbooks/deploy.md".to_string(), b"engram".to_vec())]);
    let head = mock.add_commit(files);
    mock.set_branch("main", &head);
}

#[tokio::test]
async fn a_settled_change_is_committed_once_to_the_backup_branch() {
    let mock = Arc::new(MockProvider::new());
    main_commit(&mock);
    let fx = home(mock.clone()).await;
    fx.engine
        .write_reflection(&write("a.md", "# A\n\n## One\n\nText.\n"), &agent())
        .await
        .unwrap();
    let results = fx.engine.reflection_backup_tick(Instant::now()).await;
    assert_eq!(results.len(), 1, "{results:?}");
    let head = mock
        .branch_commit(BACKUP_BRANCH)
        .expect("the branch was created");
    assert!(
        mock.commit_paths(&head)
            .contains(&"reflections/a.md".to_string())
    );
    assert!(
        mock.commit_parents(&head).unwrap().is_empty(),
        "the first backup has no parent"
    );
    let calls = mock.calls().len();
    assert!(
        fx.engine
            .reflection_backup_tick(Instant::now())
            .await
            .is_empty(),
        "nothing marked, nothing done"
    );
    assert_eq!(mock.calls().len(), calls, "no forge call either");
    fx.engine.mark_reflection_dirty("eng", BackupCause::Settled);
    let again = fx.engine.reflection_backup_tick(Instant::now()).await;
    assert!(
        matches!(again[0].1, Ok(BackupOutcome::NothingToBackUp)),
        "{again:?}"
    );
    assert_eq!(
        mock.branch_commit(BACKUP_BRANCH).unwrap(),
        head,
        "no empty commit"
    );
}

#[tokio::test]
async fn the_backup_branch_never_receives_an_engram() {
    let mock = Arc::new(MockProvider::new());
    main_commit(&mock);
    let fx = home(mock.clone()).await;
    fx.engine
        .write_reflection(&write("a.md", "# A\n"), &agent())
        .await
        .unwrap();
    fx.engine.reflection_backup_tick(Instant::now()).await;
    fx.engine
        .write_reflection(&write("b.md", "# B\n"), &agent())
        .await
        .unwrap();
    fx.engine.reflection_backup_tick(Instant::now()).await;
    let head = mock.branch_commit(BACKUP_BRANCH).unwrap();
    let paths = mock.commit_paths(&head);
    assert!(
        paths.iter().all(|p| p.starts_with("reflections/")),
        "{paths:?}"
    );
    assert!(
        paths.contains(&"reflections/a.md".to_string())
            && paths.contains(&"reflections/b.md".to_string())
    );
    assert_eq!(
        mock.commit_parents(&head).unwrap().len(),
        1,
        "the second backup builds on the first"
    );
}

#[tokio::test]
async fn an_edit_waits_for_sixty_idle_seconds() {
    let mock = Arc::new(MockProvider::new());
    main_commit(&mock);
    let fx = home(mock.clone()).await;
    std::fs::create_dir_all(fx.root.join("reflections")).unwrap();
    std::fs::write(fx.root.join("reflections/typed.md"), "# Typed in a room\n").unwrap();
    let t0 = Instant::now();
    fx.engine.mark_reflection_dirty("eng", BackupCause::Edit);
    assert!(
        fx.engine
            .reflection_backup_tick(t0 + Duration::from_secs(30))
            .await
            .is_empty()
    );
    assert_eq!(
        fx.engine
            .reflection_backup_tick(t0 + Duration::from_secs(61))
            .await
            .len(),
        1
    );
    assert!(mock.branch_commit(BACKUP_BRANCH).is_some());
}

#[tokio::test]
async fn a_file_dropped_by_hand_is_backed_up() {
    let mock = Arc::new(MockProvider::new());
    main_commit(&mock);
    let fx = home(mock.clone()).await;
    std::fs::create_dir_all(fx.root.join("reflections")).unwrap();
    std::fs::write(
        fx.root.join("reflections/hand.md"),
        "# By hand\n\n## Part\n<!-- r:bbbb2222 -->\n\nText.\n",
    )
    .unwrap();
    let t0 = Instant::now();
    fx.engine
        .sync_paths("eng", vec!["reflections/hand.md".into()])
        .await
        .unwrap();
    assert!(
        fx.engine.reflection_backup_tick(t0).await.is_empty(),
        "an edit found by the watcher waits like a room's"
    );
    let done = fx
        .engine
        .reflection_backup_tick(t0 + Duration::from_secs(61))
        .await;
    assert_eq!(done.len(), 1, "{done:?}");
    let head = mock.branch_commit(BACKUP_BRANCH).unwrap();
    assert!(
        mock.commit_paths(&head)
            .contains(&"reflections/hand.md".to_string())
    );
}

#[tokio::test]
async fn an_offline_forge_keeps_the_change_marked_and_the_next_tick_commits_it_once() {
    let mock = Arc::new(MockProvider::new());
    main_commit(&mock);
    let fx = home(mock.clone()).await;
    mock.set_offline_writes(true);
    fx.engine
        .write_reflection(&write("a.md", "# A\n"), &agent())
        .await
        .unwrap();
    let t0 = Instant::now();
    let failed = fx.engine.reflection_backup_tick(t0).await;
    assert!(failed[0].1.is_err(), "{failed:?}");
    assert!(mock.branch_commit(BACKUP_BRANCH).is_none());
    mock.set_offline_writes(false);
    assert!(
        fx.engine
            .reflection_backup_tick(t0 + Duration::from_secs(10))
            .await
            .is_empty(),
        "waits before retrying"
    );
    let retried = fx
        .engine
        .reflection_backup_tick(t0 + Duration::from_secs(61))
        .await;
    assert!(retried[0].1.is_ok(), "{retried:?}");
    let head = mock.branch_commit(BACKUP_BRANCH).unwrap();
    assert!(
        mock.commit_paths(&head)
            .contains(&"reflections/a.md".to_string()),
        "nothing was lost"
    );
    assert!(
        fx.engine
            .reflection_backup_tick(t0 + Duration::from_secs(200))
            .await
            .is_empty(),
        "and it is committed once"
    );
}

#[tokio::test]
async fn a_local_reflection_has_no_backup() {
    let fx = crate::docs::reflecting().await;
    fx.engine
        .write_reflection(&write("a.md", "# A\n"), &agent())
        .await
        .unwrap();
    assert!(
        fx.engine
            .reflection_backup_tick(Instant::now())
            .await
            .is_empty(),
        "no origin, no backup and no forge call"
    );
}

/// A home with no repository has nowhere its Reflection may go: the tick
/// drops the mark and asks the forge nothing.
#[tokio::test]
async fn a_home_without_an_origin_makes_no_forge_call() {
    let mock = Arc::new(MockProvider::new());
    let fx = home_with(
        mock.clone(),
        Home {
            origin: false,
            extra: "",
        },
    )
    .await;
    std::fs::create_dir_all(fx.root.join("reflections")).unwrap();
    std::fs::write(fx.root.join("reflections/a.md"), "# A\n").unwrap();
    fx.engine.mark_reflection_dirty("eng", BackupCause::Settled);
    assert!(
        fx.engine
            .reflection_backup_tick(Instant::now())
            .await
            .is_empty()
    );
    assert!(mock.calls().is_empty(), "{:?}", mock.calls());
}

#[tokio::test]
async fn a_read_only_domain_is_not_backed_up() {
    let mock = Arc::new(MockProvider::new());
    main_commit(&mock);
    let fx = home_with(
        mock.clone(),
        Home {
            origin: true,
            extra: "read_only: on\n",
        },
    )
    .await;
    std::fs::create_dir_all(fx.root.join("reflections")).unwrap();
    std::fs::write(fx.root.join("reflections/a.md"), "# A\n").unwrap();
    let calls = mock.calls().len();
    fx.engine.mark_reflection_dirty("eng", BackupCause::Settled);
    assert!(
        fx.engine
            .reflection_backup_tick(Instant::now())
            .await
            .is_empty()
    );
    assert_eq!(mock.calls().len(), calls, "no forge call");
    assert!(mock.branch_commit(BACKUP_BRANCH).is_none());
}

/// The same on a branch that already exists: the move of the branch fails,
/// and the retry still carries the change (the state is written only after
/// the branch moved).
#[tokio::test]
async fn a_failed_move_of_the_branch_loses_nothing() {
    let mock = Arc::new(MockProvider::new());
    main_commit(&mock);
    let fx = home(mock.clone()).await;
    fx.engine
        .write_reflection(&write("a.md", "# A\n"), &agent())
        .await
        .unwrap();
    let t0 = Instant::now();
    assert!(fx.engine.reflection_backup_tick(t0).await[0].1.is_ok());
    let first = mock.branch_commit(BACKUP_BRANCH).unwrap();
    mock.set_offline_writes(true);
    fx.engine
        .write_reflection(&write("b.md", "# B\n"), &agent())
        .await
        .unwrap();
    let t1 = Instant::now();
    let failed = fx.engine.reflection_backup_tick(t1).await;
    assert!(failed[0].1.is_err(), "{failed:?}");
    assert_eq!(mock.branch_commit(BACKUP_BRANCH).unwrap(), first);
    mock.set_offline_writes(false);
    let retried = fx
        .engine
        .reflection_backup_tick(t1 + Duration::from_secs(61))
        .await;
    assert!(
        matches!(retried[0].1, Ok(BackupOutcome::Committed { .. })),
        "{retried:?}"
    );
    let head = mock.branch_commit(BACKUP_BRANCH).unwrap();
    assert!(
        mock.commit_paths(&head)
            .contains(&"reflections/b.md".to_string()),
        "nothing was lost"
    );
    assert_eq!(mock.commit_parents(&head).unwrap(), vec![first]);
}
