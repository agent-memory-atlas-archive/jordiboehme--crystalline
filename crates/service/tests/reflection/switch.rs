//! The switch: the policy PATCH, its refusals and the reflection state.

use crystalline_service::Scope;

use crate::fixture::{engram, fixture, fixture_with, manifest, page};

#[tokio::test]
async fn reflection_home_is_never_set_by_hand() {
    let fx = fixture(&[]).await;
    let err = fx
        .engine
        .set_manifest_policies(
            "eng",
            &[("reflection_home".into(), "https://kb.example.com".into())],
            &Scope::Unrestricted,
        )
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("filled in when Reflection is switched on"),
        "{err}"
    );
}

use crystalline_core::config::{OriginConfig, ServiceConfig};
use crystalline_service::params::EditParams;
use crystalline_service::{ReflectionCaller, ReflectionState};

fn on() -> Vec<(String, String)> {
    vec![("reflection".into(), "on".into())]
}

fn with_origin(cfg: &mut crystalline_core::config::GlobalConfig, url: Option<&str>) {
    let entry = cfg.domains.get_mut("eng").unwrap();
    entry.origin = Some(OriginConfig {
        repo: "acme/kb".into(),
        path: None,
        branch: None,
        poll_secs: None,
    });
    if let Some(url) = url {
        cfg.service = Some(ServiceConfig {
            public_url: Some(url.into()),
            ..Default::default()
        });
    }
}

#[tokio::test]
async fn switching_on_refuses_while_engrams_live_in_reflections_and_names_them() {
    let fx = fixture(&[
        (
            "reflections/old.md",
            &engram("Old", "reflections/old", "- [fact] old"),
        ),
        (
            "reflections/deep/older.md",
            &engram("Older", "reflections/deep/older", "- [fact] older"),
        ),
    ])
    .await;
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("reflections/old.md") && err.contains("reflections/deep/older.md"),
        "{err}"
    );
    assert!(err.contains("move_engram"), "{err}");
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::Off,
        "nothing was written"
    );
}

/// The refusal names exactly the files the one predicate calls pending
/// (R48): a page with a section id line under `reflections/` is the
/// Reflection's already, so it is neither named nor in the way.
#[tokio::test]
async fn the_switch_names_only_the_files_the_pending_predicate_names() {
    let fx = fixture(&[
        ("reflections/guide.md", &page("Guide")),
        (
            "reflections/old.md",
            &engram("Old", "reflections/old", "- [fact] old"),
        ),
    ])
    .await;
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("reflections/old.md"), "{err}");
    assert!(!err.contains("reflections/guide.md"), "{err}");

    let fx = fixture(&[("reflections/guide.md", &page("Guide"))]).await;
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::On {
            home: crystalline_service::ReflectionHome::Local
        }
    );
}

/// An engram whose frontmatter the line-preserving editor cannot cut (an
/// anchor and alias, a flow-style mapping) is still an engram under R48:
/// it is named by the switch-on refusal, and a switch that arrives out of
/// band stays pending while it is there.
#[tokio::test]
async fn an_engram_whose_frontmatter_cannot_be_cut_holds_the_switch() {
    let anchored = "---\ntype: note\nstatus: &s draft\nphase: *s\ntitle: Anchored\n---\n\n# Anchored\n\n## Part\n\nText.\n";
    let flow = "---\n{type: note, status: draft, title: Flow}\n---\n\n# Flow\n";
    let fx = fixture(&[
        ("reflections/anchored.md", anchored),
        ("reflections/flow.md", flow),
    ])
    .await;
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("reflections/anchored.md") && err.contains("reflections/flow.md"),
        "{err}"
    );
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    let ReflectionState::Pending { engrams } = fx.engine.reflection_state("eng").await.unwrap()
    else {
        panic!("the switch waits for the engrams");
    };
    assert_eq!(
        engrams,
        vec!["reflections/anchored.md", "reflections/flow.md"]
    );
}

/// An engram whose frontmatter broke after it was indexed holds the switch
/// (R48a), and the refusals name it as a file that does not read as an
/// engram now, not as an engram to move.
#[tokio::test]
async fn a_broken_engram_is_named_as_a_file_to_fix_not_an_engram() {
    let fx = fixture(&[
        (
            "reflections/old.md",
            &engram("Old", "reflections/old", "- [fact] old"),
        ),
        (
            "reflections/kept.md",
            &engram("Kept", "reflections/kept", "- [fact] kept"),
        ),
    ])
    .await;
    std::fs::write(
        fx.root.join("reflections/old.md"),
        "---\n: [\n---\n\n# Old\n",
    )
    .unwrap();
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(
        err,
        "These engrams live in reflections/, which Reflection would take over: reflections/kept.md. Move them to another folder first (move_engram). These files in reflections/ do not read as engrams now: reflections/old.md. Fix them so they read again (frontmatter that parses, UTF-8 text), then move them out. Then switch Reflection on"
    );
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    let err = fx
        .engine
        .read_reflection_tree(
            "eng",
            &ReflectionCaller::person(Scope::Unrestricted, "jordi"),
        )
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(
        err,
        format!(
            "Reflection for 'eng' {}: reflections/kept.md. Reflection for 'eng' {}: reflections/old.md. Fix them so they read again (frontmatter that parses, UTF-8 text), then move them out",
            crystalline_service::engine::REFUSED_PENDING_NAMED,
            crystalline_service::engine::REFUSED_PENDING_UNREADABLE
        )
    );
}

#[tokio::test]
async fn a_manifest_edit_that_switches_on_is_screened_like_the_policy_patch() {
    let fx = fixture(&[(
        "reflections/old.md",
        &engram("Old", "reflections/old", "- [fact] old"),
    )])
    .await;
    // `set_frontmatter` takes only engram keys, so the switch is written
    // the way an agent writes a policy key into the MANIFEST by hand.
    let edit = EditParams {
        domain: "eng".into(),
        identifier: "manifest".into(),
        operation: "find_replace".into(),
        find_text: Some("recorded_at: 2026-01-01\n".into()),
        content: Some("recorded_at: 2026-01-01\nreflection: on\n".into()),
        ..Default::default()
    };
    let err = fx.engine.edit_engram(&edit).await.unwrap_err().to_string();
    assert!(err.contains("reflections/old.md"), "{err}");
    let source = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    let markdown = source.replace(
        "recorded_at: 2026-01-01\n",
        "recorded_at: 2026-01-01\nreflection: on\n",
    );
    let checksum = crate::support::sha256_hex(source.as_bytes());
    let err = fx
        .engine
        .save_manifest("eng", &markdown, &checksum, &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("reflections/old.md"), "{err}");
}

/// `configure` with a domain (MCP) reaches the same switch branch as the
/// policy PATCH (REST), so it refuses with the same sentence and writes
/// nothing; removing the key is a switch-off and always passes.
#[tokio::test]
async fn configure_switching_on_is_screened_like_the_policy_patch() {
    let fx = fixture(&[(
        "reflections/old.md",
        &engram("Old", "reflections/old", "- [fact] old"),
    )])
    .await;
    let rest = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    let set = std::collections::BTreeMap::from([("reflection".to_string(), "on".to_string())]);
    let mcp = fx
        .engine
        .change_domain_settings("eng", &set, &[], &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(mcp, rest, "one sentence on both surfaces");
    assert!(mcp.contains("reflections/old.md"), "{mcp}");
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::Off,
        "nothing was written"
    );
    assert!(
        !std::fs::read_to_string(fx.root.join("MANIFEST.md"))
            .unwrap()
            .contains("reflection:")
    );

    // A domain whose MANIFEST says on (pending) switches off by removing the key.
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    fx.engine
        .change_domain_settings(
            "eng",
            &Default::default(),
            &["reflection".to_string()],
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    assert_eq!(
        fx.engine.reflection_switch("eng"),
        crystalline_core::ReflectionSwitch::Off
    );
}

#[tokio::test]
async fn a_team_domain_refuses_while_the_team_copy_still_holds_reflections() {
    // The owner moved the engram out locally and has not shared the move:
    // the base snapshot (the team's branch) still holds it under reflections/.
    let fx = fixture_with(
        &[("old.md", &engram("Old", "old", "- [fact] moved out"))],
        |cfg, _| with_origin(cfg, Some("https://kb.example.com")),
    )
    .await;
    let mut state = crystalline_remote::state::OriginState::new("acme/kb", "main");
    state.files.insert(
        "reflections/old.md".into(),
        crystalline_remote::state::BaseStamp {
            sha256: "x".into(),
            size: 1,
        },
    );
    state
        .save(&fx.tmp.path().join("origins").join("eng"))
        .unwrap();
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("reflections/old.md") && err.contains("share_changes"),
        "{err}"
    );
}

#[tokio::test]
async fn switching_on_a_virtual_domain_is_refused() {
    let fx = fixture_with(&[], |cfg, _| {
        cfg.domains.insert(
            "vd".into(),
            crystalline_core::config::DomainEntry::virtual_domain(),
        );
    })
    .await;
    let err = fx
        .engine
        .set_manifest_policies("vd", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("virtual"), "{err}");
}

#[tokio::test]
async fn a_local_domain_switches_on_with_no_home_key_and_seeds_its_pact() {
    let fx = fixture(&[]).await;
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    let manifest_text = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    assert!(manifest_text.contains("reflection: on") && !manifest_text.contains("reflection_home"));
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::On {
            home: crystalline_service::ReflectionHome::Local
        }
    );
    let pact = std::fs::read_to_string(fx.root.join("reflections/PACT.md")).unwrap();
    assert!(
        pact.contains("## Audience") && pact.contains("## Structure"),
        "{pact}"
    );
    // The seeded pact carries its section ids, so an unedited pact never
    // holds the switch pending (R48): after a switch off and on again, or
    // after a rebuild of the index.
    assert!(
        !crystalline_core::is_pending_engram(
            &fx.root,
            "reflections/PACT.md",
            crystalline_core::EngramRow::Unknown
        ),
        "{pact}"
    );
}

#[tokio::test]
async fn a_github_domain_fills_its_home_or_refuses_without_a_public_url() {
    let fx = fixture_with(&[], |cfg, _| with_origin(cfg, None)).await;
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("switch Reflection on at the team server"),
        "{err}"
    );

    let fx = fixture_with(&[], |cfg, _| {
        with_origin(cfg, Some("https://kb.example.com"))
    })
    .await;
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    let manifest_text = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    assert!(
        manifest_text.contains("reflection_home: https://kb.example.com"),
        "{manifest_text}"
    );
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::On {
            home: crystalline_service::ReflectionHome::Here
        }
    );
}

/// `service.public_url` written in another spelling (upper-case host, the
/// default port, a trailing slash) is the same instance: the home is
/// written and compared in the one canonical spelling, so the instance
/// that filled the home reads it back as its own.
#[tokio::test]
async fn the_home_is_the_canonical_spelling_of_the_public_url() {
    let fx = fixture_with(&[], |cfg, _| {
        with_origin(cfg, Some("https://KB.Example.com:443/team/"))
    })
    .await;
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    let manifest_text = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    assert!(
        manifest_text.contains("reflection_home: https://kb.example.com/team\n"),
        "{manifest_text}"
    );
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::On {
            home: crystalline_service::ReflectionHome::Here
        }
    );
}

#[tokio::test]
async fn a_non_home_instance_refuses_and_points_to_the_home() {
    let fx = fixture_with(
        &[(
            "MANIFEST.md",
            &manifest("reflection: on\nreflection_home: https://team.example.com\n"),
        )],
        |cfg, _| with_origin(cfg, Some("https://laptop.example.com")),
    )
    .await;
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::Elsewhere {
            url: "https://team.example.com".into()
        }
    );
    let status = fx
        .engine
        .reflection_status("eng", &ReflectionCaller::owner())
        .await
        .unwrap();
    assert_eq!(status["state"], "elsewhere");
    assert_eq!(status["home_url"], "https://team.example.com");
    // Unset public_url: not the home either.
    let fx = fixture_with(
        &[(
            "MANIFEST.md",
            &manifest("reflection: on\nreflection_home: https://team.example.com\n"),
        )],
        |cfg, _| with_origin(cfg, None),
    )
    .await;
    assert!(matches!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::Elsewhere { .. }
    ));
}

/// Switching on a domain that already says on but has no home fills
/// the home and seeds the pact, so the Homeless advice works; on configure
/// and on the PATCH alike. Without a public_url it still refuses.
#[tokio::test]
async fn switching_on_again_fills_the_home_of_a_homeless_domain() {
    let fx = fixture_with(
        &[("MANIFEST.md", &manifest("reflection: on\n"))],
        |cfg, _| with_origin(cfg, Some("https://kb.example.com")),
    )
    .await;
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::Homeless
    );
    assert!(!fx.root.join("reflections/PACT.md").exists());
    let set = std::collections::BTreeMap::from([("reflection".to_string(), "on".to_string())]);
    fx.engine
        .change_domain_settings("eng", &set, &[], &Scope::Unrestricted)
        .await
        .unwrap();
    let manifest_text = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    assert!(
        manifest_text.contains("reflection_home: https://kb.example.com"),
        "{manifest_text}"
    );
    assert_eq!(
        manifest_text.matches("reflection: on").count(),
        1,
        "the switch is not written twice"
    );
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::On {
            home: crystalline_service::ReflectionHome::Here
        }
    );
    assert!(
        fx.root.join("reflections/PACT.md").exists(),
        "the pact is seeded"
    );
    // Once on and at home, a further switch-on is a no-op again.
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();

    let fx = fixture_with(
        &[("MANIFEST.md", &manifest("reflection: on\n"))],
        |cfg, _| with_origin(cfg, None),
    )
    .await;
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("switch Reflection on at the team server"),
        "{err}"
    );
}

/// A restored MANIFEST that says `reflection: on` meets the screens every
/// other MANIFEST writer meets.
#[tokio::test]
async fn a_restored_manifest_that_switches_on_is_screened() {
    let fx = fixture(&[(
        "reflections/old.md",
        &engram("Old", "reflections/old", "- [fact] old"),
    )])
    .await;
    let err = fx
        .engine
        .restore_engram(
            "eng",
            "MANIFEST.md",
            &manifest("reflection: on\n"),
            &Scope::Unrestricted,
        )
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("reflections/old.md"), "{err}");
    assert!(
        !std::fs::read_to_string(fx.root.join("MANIFEST.md"))
            .unwrap()
            .contains("reflection")
    );
}

/// A full-document save of the MANIFEST (the HTTP PUT) is screened too.
#[tokio::test]
async fn a_saved_manifest_that_switches_on_is_screened() {
    let fx = fixture(&[(
        "reflections/old.md",
        &engram("Old", "reflections/old", "- [fact] old"),
    )])
    .await;
    let source = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    let save = crystalline_service::params::SaveParams {
        domain: "eng".into(),
        identifier: "manifest".into(),
        content: manifest("reflection: on\n"),
        expected_checksum: crate::support::sha256_hex(source.as_bytes()),
    };
    let err = fx
        .engine
        .save_engram(&save, &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("reflections/old.md"), "{err}");
    assert_eq!(
        std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap(),
        source
    );
}

/// `reflections/` and `Reflections/` side by side would land on the same
/// rows, so the switch is refused and both are named. A filesystem that
/// folds case (the macOS and Windows defaults) cannot hold both: there the
/// test has nothing to check and returns, and the engine's unit test
/// `two_spellings_of_the_folder_refuse_the_switch_and_name_both` pins the
/// sentence.
#[tokio::test]
async fn two_spellings_of_the_reflection_folder_refuse_the_switch() {
    let fx = fixture(&[]).await;
    std::fs::create_dir_all(fx.root.join("reflections")).unwrap();
    std::fs::create_dir_all(fx.root.join("Reflections")).unwrap();
    let spellings = std::fs::read_dir(&fx.root)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().eq_ignore_ascii_case("reflections"))
        .count();
    if spellings < 2 {
        eprintln!(
            "skipped: this filesystem folds letter case, so reflections/ and Reflections/ cannot both exist; the engine unit test pins the refusal"
        );
        return;
    }
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("reflections/") && err.contains("Reflections/"),
        "{err}"
    );
    assert_eq!(
        fx.engine.reflection_switch("eng"),
        crystalline_core::ReflectionSwitch::Off
    );
}

/// A switch that arrives out of band (a plain editor, a pull) while the
/// folder is spelled twice is held pending, naming both spellings, even when
/// every file in them is a page: one Reflection cannot read two folders.
/// Skipped on a filesystem that folds letter case.
#[tokio::test]
async fn an_out_of_band_switch_with_two_folder_spellings_stays_pending() {
    let fx = fixture(&[("reflections/a.md", &page("A"))]).await;
    std::fs::create_dir_all(fx.root.join("Reflections")).unwrap();
    if crystalline_core::reflection::reflection_folders(&fx.root).len() < 2 {
        eprintln!(
            "skipped: this filesystem folds letter case, so reflections/ and Reflections/ cannot both exist"
        );
        return;
    }
    std::fs::write(fx.root.join("Reflections/b.md"), page("B")).unwrap();
    std::fs::write(fx.root.join("MANIFEST.md"), manifest("reflection: on\n")).unwrap();
    fx.engine.sync(None).await.unwrap();
    assert_eq!(
        fx.engine.reflection_state("eng").await.unwrap(),
        ReflectionState::Pending {
            engrams: vec!["Reflections/".to_string(), "reflections/".to_string()]
        }
    );
    assert!(
        !fx.engine.reflection_effective("eng").await.unwrap(),
        "the mode shares and refreshes read agrees"
    );
    let err = fx
        .engine
        .read_reflection_tree(
            "eng",
            &ReflectionCaller::person(Scope::Unrestricted, "jordi"),
        )
        .await
        .unwrap_err()
        .to_string();
    assert_eq!(
        err,
        format!(
            "Reflection for 'eng' {}: Reflections/, reflections/. Keep one and move the files of the others out",
            crystalline_service::engine::REFUSED_PENDING_SPELLINGS
        )
    );
}

/// A move onto a missing MANIFEST.md writes the moved text as the MANIFEST,
/// so a text that says `reflection: on` meets the switch-on screen.
#[tokio::test]
async fn a_move_onto_a_missing_manifest_that_switches_on_is_screened() {
    let fx = fixture(&[
        (
            "reflections/old.md",
            &engram("Old", "reflections/old", "- [fact] old"),
        ),
        (
            "drafts/next.md",
            &manifest("reflection: on\n").replace("permalink: manifest", "permalink: drafts/next"),
        ),
    ])
    .await;
    std::fs::remove_file(fx.root.join("MANIFEST.md")).unwrap();
    fx.engine.sync(None).await.unwrap();
    let err = fx
        .engine
        .move_engram(
            &crate::fixture::move_params("drafts/next", "MANIFEST.md"),
            &Scope::Unrestricted,
        )
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("reflections/old.md"), "{err}");
    assert!(!fx.root.join("MANIFEST.md").exists(), "nothing was moved");
    assert!(fx.root.join("drafts/next.md").exists());
}

/// R14 fails closed: a record of the team's copy that exists and cannot be
/// read may hold files under reflections/, so the switch-on is refused and
/// the record is named.
#[tokio::test]
async fn an_unreadable_team_copy_record_refuses_the_switch() {
    let fx = fixture_with(&[], |cfg, _| {
        with_origin(cfg, Some("https://kb.example.com"))
    })
    .await;
    let dir = fx.tmp.path().join("origins").join("eng");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("state.json"), "{ not json").unwrap();
    let err = fx
        .engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("cannot be read") && err.contains(&dir.display().to_string()),
        "{err}"
    );
    assert_eq!(
        fx.engine.reflection_switch("eng"),
        crystalline_core::ReflectionSwitch::Off,
        "nothing was written"
    );
}

/// A pact that cannot be seeded leaves the switch off, so the error the
/// caller gets is true and sending the switch again seeds the pact.
#[tokio::test]
async fn a_pact_that_cannot_be_seeded_leaves_the_switch_off_for_a_retry() {
    let fx = fixture(&[]).await;
    // A file where the folder would go: the seed cannot create it.
    std::fs::write(fx.root.join("reflections"), "in the way").unwrap();
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap_err();
    assert_eq!(
        fx.engine.reflection_switch("eng"),
        crystalline_core::ReflectionSwitch::Off,
        "the switch is not written when the pact is not"
    );
    std::fs::remove_file(fx.root.join("reflections")).unwrap();
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    assert!(
        fx.root.join("reflections/PACT.md").exists(),
        "the retry seeds it"
    );
    assert_eq!(
        fx.engine.reflection_switch("eng"),
        crystalline_core::ReflectionSwitch::On
    );
}

/// A switch-off says what it means for sharing on a domain connected to
/// GitHub, on the policy PATCH and on configure alike, and only there: a
/// switch-off of a local domain, or of one already off, says nothing.
#[tokio::test]
async fn a_switch_off_of_a_team_domain_says_not_to_share_while_it_is_off() {
    let fx = fixture_with(&[], |cfg, _| {
        with_origin(cfg, Some("https://kb.example.com"))
    })
    .await;
    let off = vec![("reflection".to_string(), "off".to_string())];
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    let receipt = fx
        .engine
        .set_manifest_policies("eng", &off, &Scope::Unrestricted)
        .await
        .unwrap();
    let note = receipt["note"].as_str().unwrap_or_default();
    assert!(
        note.contains("\"share changes\" offers the files in reflections/")
            && note.contains("Do not share changes while it is off"),
        "{receipt}"
    );
    let again = fx
        .engine
        .set_manifest_policies("eng", &off, &Scope::Unrestricted)
        .await
        .unwrap();
    assert!(again.get("note").is_none(), "already off: {again}");

    // configure, removing the key.
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    let view = fx
        .engine
        .change_domain_settings(
            "eng",
            &Default::default(),
            &["reflection".to_string()],
            &Scope::Unrestricted,
        )
        .await
        .unwrap();
    assert!(
        view["note"]
            .as_str()
            .is_some_and(|n| n.contains("Do not share changes while it is off")),
        "{view}"
    );

    // A local domain: no origin, nothing to share, no note.
    let fx = fixture(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    let receipt = fx
        .engine
        .set_manifest_policies("eng", &off, &Scope::Unrestricted)
        .await
        .unwrap();
    assert!(receipt.get("note").is_none(), "{receipt}");
}

/// Every switch a Crystalline writer makes is announced as one `switched`
/// event with an empty path; a MANIFEST write that leaves the switch where
/// it was announces none.
#[tokio::test]
async fn every_switch_through_crystalline_announces_switched_with_an_empty_path() {
    use crystalline_service::changes::{Change, ReflectionChangeKind};
    let fx = fixture(&[]).await;
    let mut rx = fx.engine.changes().subscribe();
    let off = vec![("reflection".to_string(), "off".to_string())];
    fx.engine
        .set_manifest_policies("eng", &on(), &Scope::Unrestricted)
        .await
        .unwrap();
    fx.engine
        .set_manifest_policies("eng", &off, &Scope::Unrestricted)
        .await
        .unwrap();
    let source = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    let save = crystalline_service::params::SaveParams {
        domain: "eng".into(),
        identifier: "manifest".into(),
        content: manifest("reflection: on\n"),
        expected_checksum: crate::support::sha256_hex(source.as_bytes()),
    };
    fx.engine
        .save_engram(&save, &Scope::Unrestricted)
        .await
        .unwrap();
    fx.engine
        .edit_engram(&EditParams {
            identifier: "manifest".into(),
            domain: "eng".into(),
            operation: "append".into(),
            content: Some("- Also its runbooks".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let mut switched = Vec::new();
    while let Ok(envelope) = rx.try_recv() {
        if let Change::Reflection(change) = envelope.change {
            assert_eq!(change.kind, ReflectionChangeKind::Switched, "{change:?}");
            switched.push((change.path, change.from));
        }
    }
    assert_eq!(switched, vec![(String::new(), None); 3]);
}

/// The actors of the `switched` events the bus holds, in order.
fn switched(
    rx: &mut tokio::sync::broadcast::Receiver<crystalline_service::changes::Envelope>,
) -> Vec<Option<String>> {
    use crystalline_service::changes::{Change, ReflectionChangeKind};
    let mut heard = Vec::new();
    while let Ok(envelope) = rx.try_recv() {
        if let Change::Reflection(change) = envelope.change
            && change.kind == ReflectionChangeKind::Switched
        {
            assert_eq!((change.path.as_str(), change.from), ("", None));
            heard.push(change.actor);
        }
    }
    heard
}

fn ada() -> Scope {
    Scope::User {
        account: "ada".into(),
        admin: true,
    }
}

/// The MANIFEST editor's save announces the switch it moves.
#[tokio::test]
async fn a_manifest_editor_save_announces_the_switch() {
    let fx = fixture(&[]).await;
    let source = std::fs::read_to_string(fx.root.join("MANIFEST.md")).unwrap();
    let mut rx = fx.engine.changes().subscribe();
    fx.engine
        .save_manifest(
            "eng",
            &manifest("reflection: on\n"),
            &crate::support::sha256_hex(source.as_bytes()),
            &ada(),
        )
        .await
        .unwrap();
    assert_eq!(switched(&mut rx), vec![Some("ada".to_string())]);
}

/// A restored MANIFEST announces the switch it moves, under the account
/// that restored it.
#[tokio::test]
async fn a_restored_manifest_announces_the_switch_under_its_account() {
    let fx = fixture(&[]).await;
    let mut rx = fx.engine.changes().subscribe();
    fx.engine
        .restore_engram("eng", "MANIFEST.md", &manifest("reflection: on\n"), &ada())
        .await
        .unwrap();
    assert_eq!(switched(&mut rx), vec![Some("ada".to_string())]);
}

/// A move onto a missing MANIFEST.md announces the switch the moved text
/// sets.
#[tokio::test]
async fn a_move_onto_the_manifest_announces_the_switch() {
    let fx = fixture(&[(
        "drafts/next.md",
        &manifest("reflection: on\n").replace("permalink: manifest", "permalink: drafts/next"),
    )])
    .await;
    std::fs::remove_file(fx.root.join("MANIFEST.md")).unwrap();
    fx.engine.sync(None).await.unwrap();
    let mut rx = fx.engine.changes().subscribe();
    fx.engine
        .move_engram(
            &crate::fixture::move_params("drafts/next", "MANIFEST.md"),
            &ada(),
        )
        .await
        .unwrap();
    assert_eq!(switched(&mut rx), vec![Some("ada".to_string())]);
}

/// An edit of the MANIFEST that moves the switch announces it.
#[tokio::test]
async fn a_manifest_edit_that_moves_the_switch_announces_it() {
    let fx = fixture(&[("MANIFEST.md", &manifest("reflection: on\n"))]).await;
    let mut rx = fx.engine.changes().subscribe();
    fx.engine
        .edit_engram_as(
            &EditParams {
                identifier: "manifest".into(),
                domain: "eng".into(),
                operation: "find_replace".into(),
                find_text: Some("reflection: on".into()),
                content: Some("reflection: off".into()),
                ..Default::default()
            },
            None,
            &ada(),
        )
        .await
        .unwrap();
    assert_eq!(switched(&mut rx), vec![Some("ada".to_string())]);
}
