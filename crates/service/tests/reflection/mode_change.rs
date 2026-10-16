//! A Reflection whose mode changes while its folder already holds pages:
//! every way the mode can move makes the index whole at once, without a
//! file being rewritten. Pages leave the engram index and gain their
//! Reflection rows (pages, sections, threads, files) when the Reflection
//! comes into effect, and go back the other way when it stops.

use std::sync::Arc;

use crystalline_index::{AssetTable, Store};
use crystalline_service::Scope;
use crystalline_service::params::DiscussParams;
use crystalline_service::{ReflectionCaller, ReflectionState};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::fixture::{Fx, delete_params, engram, fixture, fixture_on, manifest, move_params, page};

/// A small PNG: the bytes only have to be an attachable file.
const PNG: &[u8] =
    b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89";

/// Two marked pages, the pact and a file, all under `reflections/`.
fn folder() -> Vec<(&'static str, String)> {
    vec![
        ("reflections/PACT.md", page("Pact")),
        ("reflections/guides/a.md", page("A")),
        ("reflections/b.md", page("B")),
    ]
}

/// The `eng` fixture with [`folder`], a file under `reflections/assets/`,
/// one engram outside the folder and `more`, its MANIFEST carrying
/// `manifest_extra`.
async fn fx_with(manifest_extra: &str, more: &[(&str, &str)]) -> Fx {
    fx_in(None, manifest_extra, more).await
}

/// [`fx_with`] over `store` (`None`: an in-memory Turso index).
async fn fx_in(
    store: Option<Arc<Mutex<dyn Store>>>,
    manifest_extra: &str,
    more: &[(&str, &str)],
) -> Fx {
    let pages = folder();
    let mut files: Vec<(&str, &str)> = pages.iter().map(|(p, t)| (*p, t.as_str())).collect();
    let text = manifest(manifest_extra);
    let kept = engram("Kept", "notes/kept", "- [fact] kept");
    files.push(("MANIFEST.md", &text));
    files.push(("notes/kept.md", &kept));
    files.extend_from_slice(more);
    let fx = match store {
        Some(store) => fixture_on(store, &files, |_, _| {}, None, None, None).await,
        None => fixture(&files).await,
    };
    std::fs::create_dir_all(fx.root.join("reflections/assets")).unwrap();
    std::fs::write(fx.root.join("reflections/assets/pic.png"), PNG).unwrap();
    fx.engine.sync(None).await.unwrap();
    fx
}

fn person() -> ReflectionCaller {
    ReflectionCaller::person(Scope::Unrestricted, "jordi")
}

/// What the index holds of `eng`: its engram paths, its page paths and its
/// Reflection file paths, each sorted.
async fn rows(fx: &Fx) -> (Vec<String>, Vec<String>, Vec<String>) {
    let store = fx.engine.store();
    let store = store.lock().await;
    let id = store.domain_id("eng").await.unwrap().unwrap();
    let mut engrams: Vec<String> = store.file_stamps(id).await.unwrap().into_keys().collect();
    engrams.sort();
    let mut pages: Vec<String> = store
        .list_reflection_stamps(id)
        .await
        .unwrap()
        .into_iter()
        .map(|s| s.path)
        .collect();
    pages.sort();
    let mut files: Vec<String> = store
        .list_assets(AssetTable::Reflection, id)
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.path)
        .collect();
    files.sort();
    (engrams, pages, files)
}

/// The page paths the Reflection tree lists, depth first.
fn tree_paths(node: &Value, out: &mut Vec<String>) {
    if node["kind"] == "reflection" {
        out.push(node["path"].as_str().unwrap().to_string());
    }
    for child in node["children"].as_array().into_iter().flatten() {
        tree_paths(child, out);
    }
}

/// The Reflection is whole: the pages and the file have their rows, no page
/// is an engram, the tree lists every page, the file list names the file
/// and a thread opens on a page that was never rewritten.
async fn assert_whole(fx: &Fx) {
    assert_whole_beside(fx, &[]).await;
}

/// [`assert_whole`] with `more` engrams beside the two the fixture writes.
async fn assert_whole_beside(fx: &Fx, more: &[&str]) {
    let (engrams, pages, files) = rows(fx).await;
    let mut expected = vec!["MANIFEST.md", "notes/kept.md"];
    expected.extend_from_slice(more);
    expected.sort();
    assert_eq!(engrams, expected, "no page is an engram");
    assert_eq!(pages, vec!["PACT.md", "b.md", "guides/a.md"]);
    assert_eq!(files, vec!["assets/pic.png"]);
    let tree = fx
        .engine
        .read_reflection_tree("eng", &person())
        .await
        .unwrap();
    let mut listed = Vec::new();
    for node in tree["nodes"].as_array().unwrap() {
        tree_paths(node, &mut listed);
    }
    listed.sort();
    assert_eq!(listed, vec!["b.md", "guides/a.md"], "{tree}");
    let listed_files: Vec<String> = fx
        .engine
        .reflection_asset_list("eng", &person())
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.path)
        .collect();
    assert_eq!(listed_files, vec!["assets/pic.png"]);
    fx.engine
        .discuss(
            &DiscussParams {
                domain: "eng".into(),
                action: Some("open".into()),
                path: Some("b.md".into()),
                section: Some("aaaa1111".into()),
                text: Some("Still true?".into()),
                ..Default::default()
            },
            &person(),
        )
        .await
        .unwrap();
}

/// The Reflection is off and the folder is engrams again: every page is an
/// engram and no Reflection row is left. A threads file a test opened is an
/// engram too then, and is left out of the comparison.
async fn assert_engrams(fx: &Fx) {
    let (mut engrams, pages, files) = rows(fx).await;
    engrams.retain(|p| !p.ends_with(".threads.md"));
    assert_eq!(
        engrams,
        vec![
            "MANIFEST.md",
            "notes/kept.md",
            "reflections/PACT.md",
            "reflections/b.md",
            "reflections/guides/a.md",
        ]
    );
    assert!(pages.is_empty(), "{pages:?}");
    assert!(files.is_empty(), "{files:?}");
}

/// The mode switched on by a plain editor, found by the watcher's targeted
/// pass over the MANIFEST alone.
#[tokio::test]
async fn a_switch_on_by_hand_found_by_a_targeted_pass_makes_the_reflection_whole() {
    let fx = fx_with("", &[]).await;
    assert_engrams(&fx).await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine
        .sync_paths("eng", vec!["MANIFEST.md".into()])
        .await
        .unwrap();
    assert_whole(&fx).await;
}

/// The mode switched off by a plain editor: the pages go back to the engram
/// index and their Reflection rows go.
#[tokio::test]
async fn a_switch_off_by_hand_found_by_a_targeted_pass_makes_the_pages_engrams() {
    let fx = fx_with("reflection: on\n", &[]).await;
    assert_whole(&fx).await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("")).unwrap();
    fx.engine
        .sync_paths("eng", vec!["MANIFEST.md".into()])
        .await
        .unwrap();
    assert_engrams(&fx).await;
}

/// The switch through the domain policies (the REST PATCH and the MCP
/// `configure` tool), on and off, over a folder that already holds pages.
#[tokio::test]
async fn the_policy_switch_makes_the_index_whole_both_ways() {
    let fx = fx_with("", &[]).await;
    let on = vec![("reflection".to_string(), "on".to_string())];
    fx.engine
        .set_manifest_policies("eng", &on, &Scope::Unrestricted)
        .await
        .unwrap();
    assert_whole(&fx).await;
    let off = vec![("reflection".to_string(), "off".to_string())];
    fx.engine
        .set_manifest_policies("eng", &off, &Scope::Unrestricted)
        .await
        .unwrap();
    assert_engrams(&fx).await;
}

/// The switch written by `edit_engram` on the MANIFEST.
#[tokio::test]
async fn an_edit_of_the_manifest_that_switches_on_makes_the_reflection_whole() {
    let fx = fx_with("", &[]).await;
    let p = crystalline_service::params::EditParams {
        identifier: "manifest".into(),
        domain: "eng".into(),
        operation: "find_replace".into(),
        find_text: Some("recorded_at: 2026-01-01\n".into()),
        content: Some("recorded_at: 2026-01-01\nreflection: on\n".into()),
        ..Default::default()
    };
    fx.engine.edit_engram(&p).await.unwrap();
    assert!(matches!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::On { .. }
    ));
    assert_whole(&fx).await;
}

/// A page with no marker holds the switch pending (it is an engram). Once
/// a plain editor gives it its marker, the targeted pass over that one file
/// brings the whole Reflection into effect: the case the design audit met.
#[tokio::test]
async fn the_last_pending_page_given_a_marker_by_hand_makes_the_reflection_whole() {
    let unmarked = "# B\n\nFor people.\n";
    let fx = fx_with("", &[]).await;
    std::fs::write(fx.root.join("reflections/b.md"), unmarked).unwrap();
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    assert!(
        matches!(
            fx.engine.reflection_state("eng").await.unwrap(),
            ReflectionState::Pending { .. }
        ),
        "an unmarked page holds the switch"
    );
    std::fs::write(fx.root.join("reflections/b.md"), page("B")).unwrap();
    fx.engine
        .sync_paths("eng", vec!["reflections/b.md".into()])
        .await
        .unwrap();
    assert_whole(&fx).await;
}

/// The remedy the 409 names, `move_engram`, on the last engram under
/// `reflections/`: the Reflection comes into effect whole at once.
#[tokio::test]
async fn moving_the_last_engram_out_makes_the_reflection_whole() {
    let old = engram("Old", "reflections/old", "- [fact] old");
    let fx = fx_with("", &[("reflections/old.md", &old)]).await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    assert!(matches!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::Pending { .. }
    ));
    fx.engine
        .move_engram(
            &move_params("reflections/old", "notes/kept-old.md"),
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    assert_whole_beside(&fx, &["notes/kept-old.md"]).await;
}

/// `delete_engram` on the last engram under `reflections/` does the same.
#[tokio::test]
async fn deleting_the_last_engram_makes_the_reflection_whole() {
    let old = engram("Old", "reflections/old", "- [fact] old");
    let fx = fx_with("", &[("reflections/old.md", &old)]).await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    fx.engine
        .delete_engram(&delete_params("reflections/old"))
        .await
        .unwrap();
    assert_whole(&fx).await;
}

/// Pages an older version indexed as engrams under a switch that is on (the
/// rows of 0.26.0's targeted pass): the next full sync clears them.
#[tokio::test]
async fn a_full_sync_clears_pages_left_as_engrams() {
    let fx = fx_with("", &[]).await;
    assert_engrams(&fx).await;
    // The switch lands with no pass at all, as a daemon that was not running
    // would see it: the rows still say engram.
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    assert_whole(&fx).await;
}

/// A folder registered with its Reflection on and pages in place is whole
/// as soon as it is added.
#[tokio::test]
async fn a_domain_added_with_its_reflection_on_is_whole_at_once() {
    let fx = fixture(&[]).await;
    let dir = fx.tmp.path().join("team");
    std::fs::create_dir_all(dir.join("reflections/assets")).unwrap();
    std::fs::write(
        dir.join("MANIFEST.md"),
        manifest("reflection: on\n").replace("title: eng", "title: team"),
    )
    .unwrap();
    std::fs::write(dir.join("reflections/b.md"), page("B")).unwrap();
    std::fs::write(dir.join("reflections/assets/pic.png"), PNG).unwrap();
    fx.engine
        .domain_add_local(Some("team"), Some(dir.to_str().unwrap()))
        .await
        .unwrap();
    let store = fx.engine.store();
    let store = store.lock().await;
    let id = store.domain_id("team").await.unwrap().unwrap();
    let engrams: Vec<String> = store.file_stamps(id).await.unwrap().into_keys().collect();
    assert_eq!(engrams, vec!["MANIFEST.md"]);
    assert_eq!(store.list_reflection_stamps(id).await.unwrap().len(), 1);
    assert_eq!(
        store
            .list_assets(AssetTable::Reflection, id)
            .await
            .unwrap()
            .len(),
        1
    );
}

/// A folder whose files were never engrams (only a file under
/// `reflections/assets/`) gets its rows when a plain editor switches the
/// Reflection on: no engram row hints at the change, the empty Reflection
/// beside a folder with a file in it does.
#[tokio::test]
async fn a_switch_on_by_hand_over_a_folder_of_files_only_gives_them_rows() {
    let fx = fixture(&[]).await;
    std::fs::create_dir_all(fx.root.join("reflections/assets")).unwrap();
    std::fs::write(fx.root.join("reflections/assets/pic.png"), PNG).unwrap();
    fx.engine.sync(None).await.unwrap();
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine
        .sync_paths("eng", vec!["MANIFEST.md".into()])
        .await
        .unwrap();
    let (_, pages, files) = rows(&fx).await;
    assert!(pages.is_empty(), "{pages:?}");
    assert_eq!(files, vec!["assets/pic.png"]);
}

/// The hand switch both ways on a shared database, where the walk claims the
/// domain's host lock and checks it again inside its apply.
#[cfg(feature = "postgres")]
#[tokio::test]
async fn a_switch_by_hand_makes_the_index_whole_both_ways_on_postgres() {
    let Some(scratch) = crate::fixture::scratch_schema() else {
        return;
    };
    let store = crystalline_index::PostgresStore::open_in_schema(scratch.url(), scratch.name())
        .await
        .expect("open the postgres test schema");
    let fx = fx_in(Some(Arc::new(Mutex::new(store))), "", &[]).await;
    assert_engrams(&fx).await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine
        .sync_paths("eng", vec!["MANIFEST.md".into()])
        .await
        .unwrap();
    assert_whole(&fx).await;
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("")).unwrap();
    fx.engine
        .sync_paths("eng", vec!["MANIFEST.md".into()])
        .await
        .unwrap();
    assert_engrams(&fx).await;
}
