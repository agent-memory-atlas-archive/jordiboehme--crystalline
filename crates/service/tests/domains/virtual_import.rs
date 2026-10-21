//! `domain import` into a virtual domain takes the files its notes link to and
//! completes the notes, the way `crystalline import` does for a file domain.
//!
//! Run against both backends, like the other virtual-domain suites: an
//! attachment of a virtual domain is a database blob, so the store is the
//! thing under test.

use std::path::Path;
use std::sync::Arc;

use crystalline_core::config::{DomainEntry, GlobalConfig};
use crystalline_index::{Store, TursoStore};
use crystalline_service::Scope;
use crystalline_service::engine::Engine;
use crystalline_service::params::ReadParams;
use tokio::sync::Mutex;

/// Run a body against Turso (always) and Postgres (when configured).
macro_rules! both_backends {
    ($name:ident, $body:path) => {
        #[tokio::test]
        async fn $name() {
            {
                let store = TursoStore::open_in_memory().await.unwrap();
                let store: Arc<Mutex<dyn Store>> = Arc::new(Mutex::new(store));
                $body(store).await;
            }
            #[cfg(feature = "postgres")]
            {
                if let Some(scratch) = crate::support::scratch_schema("cvi") {
                    let pg = crystalline_index::PostgresStore::open_in_schema(
                        scratch.url(),
                        scratch.name(),
                    )
                    .await
                    .expect("open the postgres test schema");
                    let store: Arc<Mutex<dyn Store>> = Arc::new(Mutex::new(pg));
                    $body(store).await;
                }
            }
        }
    };
}

/// A PNG stand-in that only has to survive the trip unchanged.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00page\x00three";

/// A note the way a document converter writes one: a type and a title, no
/// tags, status, permalink or recorded_at, a picture in `<name>.assets/` and
/// a link to a file that is not there.
const REPORT: &str = "---\ntype: document\ntitle: Report\n---\n\n# Report\n\n![p3](report.pdf.assets/page-3.png)\n\n![gone](missing.png)\n";

fn virtual_engine(store: Arc<Mutex<dyn Store>>) -> Engine {
    let mut cfg = GlobalConfig::default();
    cfg.domains
        .insert("notes".to_string(), DomainEntry::virtual_domain());
    Engine::new(store, cfg, None, None)
}

/// The source tree: the note, its picture and one file no note links.
fn converted_tree(root: &Path) {
    std::fs::write(root.join("report.pdf.md"), REPORT).unwrap();
    std::fs::create_dir_all(root.join("report.pdf.assets")).unwrap();
    std::fs::write(root.join("report.pdf.assets/page-3.png"), PNG).unwrap();
    std::fs::write(root.join("unlinked.png"), PNG).unwrap();
}

async fn stored_text(engine: &Engine, identifier: &str) -> String {
    let read = engine
        .read_engram(
            &ReadParams {
                identifier: identifier.to_string(),
                domain: Some("notes".to_string()),
                share_link: None,
            },
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    read["content"].as_str().unwrap().to_string()
}

async fn stores_linked_pictures(store: Arc<Mutex<dyn Store>>) {
    let engine = virtual_engine(store);
    let src = tempfile::tempdir().unwrap();
    converted_tree(src.path());

    // A dry run settles the same links and writes no attachment.
    let preview = engine
        .import_domain("notes", src.path(), false, true)
        .await
        .unwrap();
    assert_eq!(preview["files_linked"], 1, "{preview}");
    assert!(
        engine
            .attachment_read("notes", "assets/report.pdf/page-3.png")
            .await
            .is_err(),
        "a dry run stores nothing"
    );

    let report = engine
        .import_domain("notes", src.path(), false, false)
        .await
        .unwrap();
    assert_eq!(report["files_written"], 1, "{report}");
    assert_eq!(report["files_linked"], 1, "{report}");
    assert_eq!(report["not_linked"], 1, "{report}");
    assert_eq!(
        report["not_taken"],
        serde_json::json!([{
            "note": "report.pdf.md",
            "target": "missing.png",
            "reason": "missing",
        }]),
        "{report}"
    );

    let (bytes, row) = engine
        .attachment_read("notes", "assets/report.pdf/page-3.png")
        .await
        .unwrap();
    assert_eq!(bytes, PNG);
    assert_eq!(row.path, "assets/report.pdf/page-3.png");

    let text = stored_text(&engine, "report-pdf").await;
    assert!(
        text.contains("![p3](assets/report.pdf/page-3.png)"),
        "the body links the stored attachment: {text}"
    );
    assert!(
        text.contains("![gone](missing.png)"),
        "a link that was not taken is left as written: {text}"
    );

    // The same source again: the picture is reused by its hash, no `-2` copy.
    let again = engine
        .import_domain("notes", src.path(), true, false)
        .await
        .unwrap();
    assert_eq!(again["files_linked"], 1, "{again}");
    let paths: Vec<String> = engine
        .attachment_list("notes")
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.path)
        .collect();
    assert_eq!(paths, vec!["assets/report.pdf/page-3.png".to_string()]);
}
both_backends!(
    a_virtual_import_stores_linked_pictures_as_attachments,
    stores_linked_pictures
);

async fn completes_files(store: Arc<Mutex<dyn Store>>) {
    let engine = virtual_engine(store);
    let src = tempfile::tempdir().unwrap();
    converted_tree(src.path());
    engine
        .import_domain("notes", src.path(), false, false)
        .await
        .unwrap();

    let text = stored_text(&engine, "report-pdf").await;
    assert!(text.contains("status: stable"), "{text}");
    assert!(text.contains("- imported"), "{text}");
    assert!(text.contains("permalink: report-pdf"), "{text}");
    assert!(text.contains("recorded_at:"), "{text}");
    let issues =
        crystalline_core::verify::check_document("notes", Path::new("report.pdf.md"), &text);
    assert!(
        issues
            .iter()
            .all(|issue| issue.severity != crystalline_core::Severity::Error),
        "{issues:?}"
    );
}
both_backends!(a_virtual_import_completes_files, completes_files);
