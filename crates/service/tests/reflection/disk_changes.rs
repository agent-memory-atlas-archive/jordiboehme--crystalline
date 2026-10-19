//! What reaches the Reflection's files from outside the engine (another
//! process, a plain editor, a pull) is announced on the change bus once the
//! watcher's targeted pass finds it, so an open page updates without a
//! reload. `sync_paths` is the call the watcher makes after its debounce.

use crystalline_service::changes::{Change, ReflectionChangeKind as K};
use crystalline_service::params::DiscussParams;

use crate::docs::{person, write};
use crate::fixture::{Fx, fixture, manifest, page};

/// The `reflection` events the bus carried since `rx` subscribed, as
/// `(kind, path, actor)`.
fn heard(
    rx: &mut tokio::sync::broadcast::Receiver<crystalline_service::changes::Envelope>,
) -> Vec<(K, String, Option<String>)> {
    let mut heard = Vec::new();
    while let Ok(envelope) = rx.try_recv() {
        if let Change::Reflection(change) = envelope.change {
            heard.push((change.kind, change.path, change.actor));
        }
    }
    heard
}

fn put(fx: &Fx, rel: &str, text: &str) {
    let abs = fx.root.join("reflections").join(rel);
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(abs, text).unwrap();
}

async fn reflecting() -> Fx {
    fixture(&[
        ("MANIFEST.md", &manifest("reflection: on\n")),
        ("reflections/d.md", &page("D")),
    ])
    .await
}

const THREADS: &str = "# Threads\n\n## t-0000aaaa\n\n```yaml\nsection: aaaa1111\nstatus: open\n```\n\n- 2026-10-19T09:00:00Z, comment by scribe (agent): Written by another process.\n";

#[tokio::test]
async fn a_threads_file_and_a_page_changed_on_disk_are_announced() {
    let fx = reflecting().await;
    fx.engine.take_reflection_backup_marks();
    let mut rx = fx.engine.changes().subscribe();

    put(&fx, "d.threads.md", THREADS);
    fx.engine
        .sync_paths("eng", vec!["reflections/d.threads.md".into()])
        .await
        .unwrap();
    assert_eq!(heard(&mut rx), vec![(K::Threads, "d.md".to_string(), None)]);
    assert_eq!(
        fx.engine.take_reflection_backup_marks(),
        vec!["eng".to_string()],
        "a threads file is in the folder the backup commits"
    );

    put(&fx, "d.md", &page("D, edited by hand"));
    fx.engine
        .sync_paths("eng", vec!["reflections/d.md".into()])
        .await
        .unwrap();
    assert_eq!(heard(&mut rx), vec![(K::Changed, "d.md".to_string(), None)]);

    put(&fx, "guides/new.md", &page("New"));
    std::fs::remove_file(fx.root.join("reflections/d.md")).unwrap();
    std::fs::remove_file(fx.root.join("reflections/d.threads.md")).unwrap();
    fx.engine
        .sync_paths(
            "eng",
            vec![
                "reflections/guides/new.md".into(),
                "reflections/d.md".into(),
                "reflections/d.threads.md".into(),
            ],
        )
        .await
        .unwrap();
    let mut events = heard(&mut rx);
    events.sort_by(|a, b| a.1.cmp(&b.1));
    assert_eq!(
        events,
        vec![
            (K::Deleted, "d.md".to_string(), None),
            (K::Changed, "guides/new.md".to_string(), None),
        ],
        "a page that went with its threads is one deletion"
    );
}

#[tokio::test]
async fn more_pages_than_the_collapse_threshold_are_one_event_with_an_empty_path() {
    let fx = reflecting().await;
    let mut rx = fx.engine.changes().subscribe();
    let count = crystalline_service::changes::COLLAPSE_THRESHOLD + 1;
    let mut paths = Vec::new();
    for i in 0..count {
        put(&fx, &format!("many/p{i}.md"), &page(&format!("P{i}")));
        paths.push(format!("reflections/many/p{i}.md"));
    }
    fx.engine.sync_paths("eng", paths).await.unwrap();
    assert_eq!(heard(&mut rx), vec![(K::Changed, String::new(), None)]);
}

#[tokio::test]
async fn the_watchers_echo_of_an_engine_thread_write_is_not_announced_twice() {
    let fx = reflecting().await;
    let mut rx = fx.engine.changes().subscribe();
    fx.engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                action: Some("open".into()),
                path: Some("d.md".into()),
                section: Some("aaaa1111".into()),
                text: Some("Still true?".into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();
    assert_eq!(
        heard(&mut rx),
        vec![(K::Threads, "d.md".to_string(), None)],
        "the engine's own event (the machine owner carries no label)"
    );

    // The comment marked the backup itself; the backup ran.
    fx.engine.take_reflection_backup_marks();

    // What the watcher does a moment later: the same file, found again.
    fx.engine
        .sync_paths("eng", vec!["reflections/d.threads.md".into()])
        .await
        .unwrap();
    assert_eq!(heard(&mut rx), Vec::new(), "the echo is dropped");
    assert_eq!(
        fx.engine.take_reflection_backup_marks(),
        Vec::<String>::new(),
        "and it asks for no second backup"
    );

    // Another process writes inside the same window: new content is heard.
    let mut threads = std::fs::read_to_string(fx.root.join("reflections/d.threads.md")).unwrap();
    threads.push_str("- 2026-10-19T09:00:01Z, comment by scribe (agent): Yes.\n");
    put(&fx, "d.threads.md", &threads);
    fx.engine
        .sync_paths("eng", vec!["reflections/d.threads.md".into()])
        .await
        .unwrap();
    assert_eq!(heard(&mut rx), vec![(K::Threads, "d.md".to_string(), None)]);
}

/// A page and a file the engine wrote carry the stamp the watcher's pass
/// compares, so that pass finds nothing new and announces nothing.
#[tokio::test]
async fn the_watchers_echo_of_an_engine_page_or_file_write_is_not_announced() {
    let fx = reflecting().await;
    fx.engine
        .write_reflection(&write("d.md", &page("D, rewritten")), &person())
        .await
        .unwrap();
    fx.engine
        .reflection_asset_write("eng", "assets/p.png", b"png".to_vec(), &person())
        .await
        .unwrap();
    let mut rx = fx.engine.changes().subscribe();
    fx.engine
        .sync_paths(
            "eng",
            vec!["reflections/d.md".into(), "reflections/assets/p.png".into()],
        )
        .await
        .unwrap();
    assert_eq!(heard(&mut rx), Vec::new());
}

/// A full walk (the watcher's fallback after a folder event or a queue
/// overflow, a manual sync) compares every threads file's checksum with
/// what the last walk saw and the engine wrote: a threads file changed on
/// disk is named by its page; nothing moved, nothing said.
#[tokio::test]
async fn a_full_walk_names_a_threads_file_changed_on_disk() {
    let fx = reflecting().await;
    let mut rx = fx.engine.changes().subscribe();
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(
        heard(&mut rx),
        Vec::new(),
        "nothing moved since the last walk"
    );

    put(&fx, "d.threads.md", THREADS);
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(heard(&mut rx), vec![(K::Threads, "d.md".to_string(), None)]);
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(heard(&mut rx), Vec::new(), "said once");

    std::fs::remove_file(fx.root.join("reflections/d.threads.md")).unwrap();
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(
        heard(&mut rx),
        vec![(K::Threads, "d.md".to_string(), None)],
        "threads removed beside a page that stays"
    );
}

/// The first file dropped into an empty `reflections/assets/` (a folder
/// event, so the watcher walks the whole domain) is heard too.
#[tokio::test]
async fn the_first_file_into_an_empty_assets_folder_is_heard_on_a_full_walk() {
    let fx = reflecting().await;
    let mut rx = fx.engine.changes().subscribe();
    put(&fx, "assets/p.png", "png");
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(
        heard(&mut rx),
        vec![(K::Files, "assets/p.png".to_string(), None)]
    );
}

/// What the engine wrote itself (a comment, a page, a file) is no change
/// for the next full walk, however the files' times moved.
#[tokio::test]
async fn a_full_walk_after_the_engines_own_writes_says_nothing() {
    let fx = reflecting().await;
    fx.engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                action: Some("open".into()),
                path: Some("d.md".into()),
                section: Some("aaaa1111".into()),
                text: Some("Still true?".into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();
    fx.engine
        .write_reflection(&write("guides/new.md", &page("New")), &person())
        .await
        .unwrap();
    fx.engine
        .reflection_asset_write("eng", "assets/p.png", b"png".to_vec(), &person())
        .await
        .unwrap();
    let mut rx = fx.engine.changes().subscribe();
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(heard(&mut rx), Vec::new());
}

/// Content decides, not file times: a threads file restored with an old
/// time is heard, and one with a time in the future is heard once, not on
/// every walk after it.
#[tokio::test]
async fn a_full_walk_goes_by_content_whatever_the_file_times_say() {
    use std::time::{Duration, SystemTime};
    let fx = reflecting().await;
    let mut rx = fx.engine.changes().subscribe();
    let file = fx.root.join("reflections/d.threads.md");

    put(&fx, "d.threads.md", THREADS);
    std::fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000_000))
        .unwrap();
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(
        heard(&mut rx),
        vec![(K::Threads, "d.md".to_string(), None)],
        "an old time hides nothing"
    );

    put(
        &fx,
        "d.threads.md",
        &THREADS.replace("another process", "a share"),
    );
    std::fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(SystemTime::now() + Duration::from_secs(86_400))
        .unwrap();
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(heard(&mut rx), vec![(K::Threads, "d.md".to_string(), None)]);
    fx.engine.sync(Some("eng")).await.unwrap();
    assert_eq!(
        heard(&mut rx),
        Vec::new(),
        "a time in the future does not make every walk speak"
    );
}

/// A threads file with Windows line endings is written back with LF; the
/// echo the watcher finds carries the checksum the engine announced.
#[tokio::test]
async fn the_echo_of_a_write_into_a_crlf_threads_file_is_dropped() {
    let fx = reflecting().await;
    put(&fx, "d.threads.md", &THREADS.replace('\n', "\r\n"));
    fx.engine.sync(Some("eng")).await.unwrap();
    let mut rx = fx.engine.changes().subscribe();
    fx.engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                action: Some("answer".into()),
                path: Some("d.md".into()),
                thread: Some("t-0000aaaa".into()),
                text: Some("An answer spliced into the file.".into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();
    assert_eq!(heard(&mut rx), vec![(K::Threads, "d.md".to_string(), None)]);
    fx.engine
        .sync_paths("eng", vec!["reflections/d.threads.md".into()])
        .await
        .unwrap();
    assert_eq!(heard(&mut rx), Vec::new(), "the echo is dropped");
}
