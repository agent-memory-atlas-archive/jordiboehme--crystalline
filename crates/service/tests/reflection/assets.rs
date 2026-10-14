//! A Reflection's files through the engine: rights, refusals, moves, the
//! findings, and the engram side never seeing them.

use std::collections::BTreeMap;
use std::sync::Arc;

use crystalline_service::params::{EvolveParams, ReflectParams, WriteReflectionParams};
use crystalline_service::rest::{AuthStore, ReflectionLevel, Role};
use crystalline_service::{DomainAccess, ReflectionCaller, Scope};

use crate::docs::{agent, person, reflecting, write};
use crate::fixture::{Fx, fixture, manifest};

pub const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00flow\xff\xfe\x00";

/// `eng` shared, Reflection on: vera an instance viewer (Read), nora at
/// knowledge `none` with Reflection `contributor` (Edit), ed an editor
/// (Curate).
async fn three_people() -> (Fx, ReflectionCaller, ReflectionCaller, ReflectionCaller) {
    let fx = reflecting().await;
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    auth.add_user("vera", "vera", None, Role::Viewer, "pw12345678")
        .await
        .unwrap();
    auth.add_user("nora", "nora", None, Role::None, "pw12345678")
        .await
        .unwrap();
    auth.set_reflection_level("nora", ReflectionLevel::Contributor)
        .await
        .unwrap();
    auth.add_user("ed", "ed", None, Role::Editor, "pw12345678")
        .await
        .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth)));
    let who = |name: &str| {
        ReflectionCaller::person(
            Scope::User {
                account: name.into(),
                admin: false,
            },
            name,
        )
    };
    (fx, who("vera"), who("nora"), who("ed"))
}

fn curated(path: &str, markdown: &str) -> WriteReflectionParams {
    let mut p = write(path, markdown);
    p.sources = BTreeMap::from([("_top".to_string(), vec!["runbooks/deploy".to_string()])]);
    p
}

async fn feedback_total(fx: &Fx) -> u64 {
    let p = ReflectParams {
        kinds: vec!["feedback".into()],
        ..Default::default()
    };
    fx.engine.reflect(&p, &agent()).await.unwrap()["total"]
        .as_u64()
        .unwrap()
}

#[tokio::test]
async fn a_reader_reads_a_contributor_adds_and_a_curator_replaces_and_removes() {
    let (fx, vera, nora, ed) = three_people().await;
    let err = fx
        .engine
        .reflection_asset_write("eng", "assets/flow.png", PNG.to_vec(), &vera)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("read") && err.contains("edit"), "{err}");
    let written = fx
        .engine
        .reflection_asset_write("eng", "assets/flow.png", PNG.to_vec(), &nora)
        .await
        .unwrap();
    assert!(written.created);
    assert_eq!(
        (written.row.path.as_str(), written.row.mime.as_str()),
        ("assets/flow.png", "image/png")
    );
    assert_eq!(
        std::fs::read(fx.root.join("reflections/assets/flow.png")).unwrap(),
        PNG
    );
    // Knowledge none: no engram right at all, every file of the Reflection.
    assert!(fx.engine.require_domain("eng", &nora.scope).await.is_err());
    let (bytes, row) = fx
        .engine
        .reflection_asset_read("eng", "assets/flow.png", &nora)
        .await
        .unwrap();
    assert_eq!((bytes.as_slice(), row.size), (PNG, PNG.len() as u64));
    assert_eq!(
        fx.engine
            .reflection_asset_list("eng", &vera)
            .await
            .unwrap()
            .len(),
        1
    );
    let err = fx
        .engine
        .reflection_asset_write("eng", "assets/flow.png", b"other".to_vec(), &nora)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("curate") && err.contains("new name"),
        "replacing removes the old bytes: {err}"
    );
    let err = fx
        .engine
        .reflection_asset_delete("eng", "assets/flow.png", &nora)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("curate"), "{err}");
    let replaced = fx
        .engine
        .reflection_asset_write("eng", "assets/flow.png", b"other".to_vec(), &ed)
        .await
        .unwrap();
    assert!(!replaced.created);
    fx.engine
        .reflection_asset_delete("eng", "assets/flow.png", &ed)
        .await
        .unwrap();
    assert!(!fx.root.join("reflections/assets/flow.png").exists());
    assert!(
        fx.engine
            .reflection_asset_list("eng", &ed)
            .await
            .unwrap()
            .is_empty()
    );
    let err = fx
        .engine
        .reflection_asset_delete("eng", "assets/flow.png", &ed)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("no file 'assets/flow.png'"), "{err}");
    assert!(
        fx.engine.attachment_list("eng").await.unwrap().is_empty(),
        "never an engram attachment"
    );
}

#[tokio::test]
async fn paths_follow_the_attachment_rules_and_stay_in_the_domain() {
    let fx = reflecting().await;
    for bad in [
        "assets/tool.exe",
        "flow.png",
        "assets/../x.png",
        "assets/a b.png",
        "assets/.hidden.png",
        "reflections/assets/x.png",
    ] {
        let err = fx
            .engine
            .reflection_asset_write("eng", bad, PNG.to_vec(), &person())
            .await;
        assert!(err.is_err(), "{bad} was accepted");
    }
    let big = vec![0u8; (crystalline_core::MAX_ATTACHMENT_BYTES + 1) as usize];
    let err = fx
        .engine
        .reflection_asset_write("eng", "assets/big.png", big, &person())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("ceiling"), "{err}");
    let off = fixture(&[]).await;
    let err = off
        .engine
        .reflection_asset_write("eng", "assets/flow.png", PNG.to_vec(), &person())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("Reflection is off"), "{err}");
}

#[cfg(unix)]
#[tokio::test]
async fn a_reflections_folder_that_leaves_the_domain_is_refused() {
    let fx = reflecting().await;
    let outside = fx.tmp.path().join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, fx.root.join("reflections")).unwrap();
    let err = fx
        .engine
        .reflection_asset_write("eng", "assets/flow.png", PNG.to_vec(), &person())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("outside the domain root"), "{err}");
    assert!(!outside.join("assets/flow.png").exists());
}

#[tokio::test]
async fn a_write_that_embeds_an_engram_attachment_is_refused() {
    let fx = reflecting().await;
    for (path, page) in [
        ("a.md", "# A\n\n![shot](../assets/shot.png)\n"),
        ("guides/b.md", "# B\n\n![shot](../../assets/shot.png)\n"),
        ("c.md", "# C\n\n[deck](crystalline://eng/assets/deck.pdf)\n"),
    ] {
        let err = fx
            .engine
            .write_reflection(&write(path, page), &person())
            .await
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("engram attachment") && err.contains("reflections/assets/"),
            "{path}: {err}"
        );
        assert!(
            !fx.root.join("reflections").join(path).exists(),
            "{path} was written"
        );
    }
    fx.engine
        .write_reflection(
            &write(
                "guides/d.md",
                "# D\n\n![flow](../assets/flow.png#right,w=50%)\n",
            ),
            &person(),
        )
        .await
        .unwrap();
    fx.engine
        .write_reflection(
            &write("e.md", "# E\n\n![flow](assets/flow.png)\n"),
            &person(),
        )
        .await
        .unwrap();
    let err = fx
        .engine
        .write_reflection(&write("assets/notes.md", "# Notes\n"), &person())
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("reflections/assets/"),
        "no reflection lives among the files: {err}"
    );
}

#[tokio::test]
async fn moving_a_reflection_keeps_its_file_links_and_owes_no_feedback() {
    let fx = reflecting().await;
    fx.engine
        .reflection_asset_write("eng", "assets/flow.png", PNG.to_vec(), &person())
        .await
        .unwrap();
    fx.engine
        .write_reflection(
            &curated(
                "guides/deploying.md",
                "# Deploying\n\n![flow](../assets/flow.png#right)\n",
            ),
            &agent(),
        )
        .await
        .unwrap();
    assert_eq!(feedback_total(&fx).await, 0);
    fx.engine
        .move_reflection("eng", "guides/deploying.md", "deploying.md", &agent())
        .await
        .unwrap();
    let text = std::fs::read_to_string(fx.root.join("reflections/deploying.md")).unwrap();
    assert!(text.contains("![flow](assets/flow.png#right)"), "{text}");
    assert_eq!(
        feedback_total(&fx).await,
        0,
        "a link that follows a move is no person's change"
    );
}

#[tokio::test]
async fn moving_a_file_rewrites_every_reflection_that_references_it_and_owes_no_feedback() {
    let fx = reflecting().await;
    fx.engine
        .reflection_asset_write("eng", "assets/größe.png", PNG.to_vec(), &person())
        .await
        .unwrap();
    fx.engine
        .write_reflection(
            &curated(
                "guides/a.md",
                "# A\n\n![s](../assets/gr%C3%B6%C3%9Fe.png \"Size\")\n",
            ),
            &agent(),
        )
        .await
        .unwrap();
    fx.engine
        .write_reflection(
            &curated("b.md", "# B\n\n![s](assets/größe.png#left)\n"),
            &agent(),
        )
        .await
        .unwrap();
    fx.engine
        .write_reflection(
            &curated("PACT.md", "# Pact\n\n![s](assets/größe.png)\n"),
            &agent(),
        )
        .await
        .unwrap();
    assert_eq!(feedback_total(&fx).await, 0);
    let moved = fx
        .engine
        .move_reflection_asset(
            "eng",
            "assets/größe.png",
            "assets/diagrams/size.png",
            &agent(),
        )
        .await
        .unwrap();
    assert_eq!(moved["links_rewritten"], 3, "{moved}");
    let read = |rel: &str| std::fs::read_to_string(fx.root.join("reflections").join(rel)).unwrap();
    assert!(read("guides/a.md").contains("![s](../assets/diagrams/size.png \"Size\")"));
    assert!(read("b.md").contains("![s](assets/diagrams/size.png#left)"));
    assert!(
        read("PACT.md").contains("![s](assets/diagrams/size.png)"),
        "PACT.md references count"
    );
    assert!(
        fx.root
            .join("reflections/assets/diagrams/size.png")
            .is_file()
    );
    assert!(!fx.root.join("reflections/assets/größe.png").exists());
    let paths: Vec<String> = fx
        .engine
        .reflection_asset_list("eng", &agent())
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.path)
        .collect();
    assert_eq!(paths, ["assets/diagrams/size.png"]);
    assert_eq!(
        feedback_total(&fx).await,
        0,
        "a link that follows a file is no person's change"
    );
    let err = fx
        .engine
        .move_reflection_asset(
            "eng",
            "assets/diagrams/size.png",
            "assets/diagrams/size.png",
            &agent(),
        )
        .await;
    assert!(err.is_err());
}

#[tokio::test]
async fn a_curators_agent_moves_and_removes_files_through_write_reflection() {
    let (fx, _, nora, ed) = three_people().await;
    fx.engine
        .reflection_asset_write("eng", "assets/a.png", PNG.to_vec(), &ed)
        .await
        .unwrap();
    let mv = WriteReflectionParams {
        domain: "eng".into(),
        action: Some("move_asset".into()),
        path: "assets/a.png".into(),
        to: Some("assets/b.png".into()),
        ..Default::default()
    };
    let err = fx
        .engine
        .write_reflection(&mv, &nora)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("curate"), "{err}");
    fx.engine.write_reflection(&mv, &ed).await.unwrap();
    let rm = WriteReflectionParams {
        domain: "eng".into(),
        action: Some("delete_asset".into()),
        path: "assets/b.png".into(),
        ..Default::default()
    };
    fx.engine.write_reflection(&rm, &ed).await.unwrap();
    assert!(
        fx.engine
            .reflection_asset_list("eng", &ed)
            .await
            .unwrap()
            .is_empty()
    );
}

/// Files and pages written outside Crystalline, then synced. Each page
/// carries a section id line, the page marker that keeps a hand-written page
/// from reading as an engram under `reflections/` (which would hold the
/// switch pending).
async fn with_findings() -> Fx {
    fixture(&[
        ("MANIFEST.md", &manifest("reflection: on\n")),
        ("reflections/assets/orphan.png", "nobody links me"),
        ("reflections/assets/used.png", "linked"),
        ("reflections/guides/a.md", "# A\n\n## Pics\n<!-- r:aaaa0001 -->\n\n![u](../assets/used.png) ![m](../assets/missing.png)\n"),
        ("reflections/PACT.md", "# Pact\n\n## Pictures\n<!-- r:aaaa0002 -->\n\n![p](assets/pact.png)\n"),
        ("reflections/b.md", "# B\n\n## Shot\n<!-- r:aaaa0003 -->\n\n![e](../assets/shot.png)\n"),
        ("assets/shot.png", "an engram attachment"),
    ])
    .await
}

#[tokio::test]
async fn reflect_names_unreferenced_and_missing_files_and_engram_attachments() {
    let fx = with_findings().await;
    let p = ReflectParams {
        kinds: vec!["update".into()],
        limit: Some(100),
        ..Default::default()
    };
    let queue = fx.engine.reflect(&p, &agent()).await.unwrap();
    let rows: Vec<&serde_json::Value> = queue["queue"].as_array().unwrap().iter().collect();
    let find = |what: &str, path: &str| {
        rows.iter()
            .find(|r| r["what"] == what && r["path"] == path)
            .copied()
    };
    let missing = find("asset_missing", "guides/a.md").expect("the missing file of a section");
    assert_eq!(missing["assets"], serde_json::json!(["assets/missing.png"]));
    assert_eq!(missing["heading"], "Pics", "grouped with its section");
    assert_eq!(
        find("asset_missing", "PACT.md").expect("PACT.md references count")["assets"],
        serde_json::json!(["assets/pact.png"])
    );
    let orphan = find("asset_unreferenced", "").expect("the file nobody links");
    assert_eq!(orphan["asset"], "assets/orphan.png");
    assert_eq!(
        find("engram_attachment", "b.md").expect("an embed written outside Crystalline")["targets"],
        serde_json::json!(["../assets/shot.png"])
    );
    assert!(
        !queue.to_string().contains("used.png"),
        "a linked file that is there owes nothing: {queue}"
    );
    assert!(
        queue["guidance"]
            .as_str()
            .unwrap()
            .contains("reflections/assets/")
    );
}

#[tokio::test]
async fn the_engram_orphan_check_never_sees_a_reflection_file() {
    let fx = with_findings().await;
    let p = EvolveParams {
        rules: vec!["V107".into(), "V108".into()],
        ..Default::default()
    };
    let found = fx
        .engine
        .evolve_detect(&p, &Scope::Unrestricted)
        .await
        .unwrap()
        .to_string();
    for name in ["orphan.png", "missing.png", "pact.png", "used.png"] {
        assert!(
            !found.contains(name),
            "{name} reached the engram sweep: {found}"
        );
    }
    let attachments: Vec<String> = fx
        .engine
        .attachment_list("eng")
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.path)
        .collect();
    assert_eq!(attachments, ["assets/shot.png"]);
    // The read heal (D4's one missed filter): a file that reached the disk
    // with no sync has no row, so the read writes one, into the home's own
    // table and never into `attachment` (pre-flight scan 2, P8).
    std::fs::write(fx.root.join("reflections/assets/late.png"), PNG).unwrap();
    let (bytes, row) = fx
        .engine
        .reflection_asset_read("eng", "assets/late.png", &agent())
        .await
        .unwrap();
    assert_eq!(
        (bytes.as_slice(), row.path.as_str()),
        (PNG, "assets/late.png")
    );
    let attachments: Vec<String> = fx
        .engine
        .attachment_list("eng")
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.path)
        .collect();
    assert_eq!(
        attachments,
        ["assets/shot.png"],
        "the heal never writes an engram attachment row"
    );
    let files: Vec<String> = fx
        .engine
        .reflection_asset_list("eng", &agent())
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.path)
        .collect();
    assert!(
        files.iter().any(|p| p == "assets/late.png"),
        "the heal writes the Reflection's own row: {files:?}"
    );
}

#[tokio::test]
async fn a_changed_file_reference_is_a_feedback_change_of_its_section() {
    let fx = reflecting().await;
    fx.engine
        .write_reflection(&curated("a.md", "# A\n\n![a](assets/a.png)\n"), &agent())
        .await
        .unwrap();
    fx.engine
        .write_reflection(&write("a.md", "# A\n\n![b](assets/b.png)\n"), &person())
        .await
        .unwrap();
    let p = ReflectParams {
        kinds: vec!["feedback".into()],
        ..Default::default()
    };
    let queue = fx.engine.reflect(&p, &agent()).await.unwrap();
    assert_eq!(queue["total"], 1, "{queue}");
    let diff = queue["queue"][0]["diff"].as_str().unwrap();
    assert!(
        diff.contains("-![a](assets/a.png)") && diff.contains("+![b](assets/b.png)"),
        "{diff}"
    );
}

/// The write list caps the whole account, so an off-list contributor
/// lists the files and adds none, and is told why.
#[tokio::test]
async fn an_off_list_contributor_adds_no_file() {
    let fx = reflecting().await;
    let auth = Arc::new(
        AuthStore::open(&fx.tmp.path().join("web-auth.db"))
            .await
            .unwrap(),
    );
    auth.add_user("lisa", "lisa", None, Role::None, "pw12345678")
        .await
        .unwrap();
    auth.set_reflection_level("lisa", ReflectionLevel::Contributor)
        .await
        .unwrap();
    auth.set_write_list("lisa", &["agents-*".to_string()])
        .await
        .unwrap();
    fx.engine
        .set_domain_access(Arc::new(DomainAccess::new(auth)));
    let lisa = ReflectionCaller::person(
        Scope::User {
            account: "lisa".into(),
            admin: false,
        },
        "lisa",
    );
    fx.engine.reflection_asset_list("eng", &lisa).await.unwrap();
    let err = fx
        .engine
        .reflection_asset_write("eng", "assets/flow.png", PNG.to_vec(), &lisa)
        .await
        .unwrap_err();
    assert_eq!(
        err.to_string(),
        crystalline_service::WriteBlock::WriteList {
            account: "lisa".into()
        }
        .sentence("eng")
    );
    assert!(!fx.root.join("reflections/assets/flow.png").exists());
}
