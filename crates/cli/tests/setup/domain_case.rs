//! Domain names that differ only in letter case: refused for a new domain
//! on the CLI, and reported by `doctor` for a pair an older install already
//! holds. On a disk that ignores case such a pair shares one state folder.

use std::path::Path;

use serde_json::Value;

fn run(home: &Path, args: &[&str]) -> std::process::Output {
    let mut cmd = crate::common::crystalline();
    crate::common::isolate(&mut cmd, home);
    cmd.env("CRYSTALLINE_SERVICE_HTTP", "false")
        .env("CRYSTALLINE_TEST_DAEMON_TASK", "ready")
        .args(args)
        .output()
        .unwrap()
}

fn folder(home: &Path, name: &str, declared: Option<&str>) -> String {
    let dir = home.join("docs").join(name);
    std::fs::create_dir_all(&dir).unwrap();
    let declared = declared
        .map(|d| format!("domain_name: {d}\n"))
        .unwrap_or_default();
    std::fs::write(
        dir.join("MANIFEST.md"),
        format!(
            "---\ntype: manifest\ntitle: {name}\npermalink: manifest\ntags:\n  - manifest\nstatus: current\nrecorded_at: 2026-01-01\n{declared}---\n\n# {name}\n\n## Scope\n\n- {name}\n\n## When to Use\n\n- {name}\n"
        ),
    )
    .unwrap();
    dir.display().to_string()
}

fn domains(home: &Path) -> Vec<String> {
    let out = run(home, &["--json", "domain", "list"]);
    let body: Value = serde_json::from_slice(&out.stdout).unwrap();
    let rows = body
        .as_array()
        .or_else(|| body["domains"].as_array())
        .cloned()
        .unwrap_or_default();
    rows.iter()
        .map(|d| d["name"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[test]
fn domain_add_refuses_a_name_that_differs_only_in_case() {
    let home = tempfile::tempdir().unwrap();
    let a = folder(home.path(), "a", None);
    let b = folder(home.path(), "b", None);
    assert!(
        run(home.path(), &["domain", "add", "eng", &a])
            .status
            .success()
    );
    for args in [
        vec!["domain", "add", "ENG", b.as_str()],
        vec!["domain", "add", "Eng", "--virtual"],
    ] {
        let out = run(home.path(), &args);
        assert!(!out.status.success(), "{args:?}");
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(
            err.contains("differs from the domain 'eng' only in letter case"),
            "{args:?}: {err}"
        );
    }
    // A name the folder's MANIFEST declares steps aside instead.
    let c = folder(home.path(), "c", Some("Eng"));
    assert!(
        run(home.path(), &["domain", "add", "--path", &c])
            .status
            .success()
    );
    let names = domains(home.path());
    assert!(names.contains(&"eng".to_string()), "{names:?}");
    assert!(names.contains(&"Eng-2".to_string()), "{names:?}");
    assert!(!names.contains(&"ENG".to_string()) && !names.contains(&"Eng".to_string()));
}

/// A pair an older install registered keeps working, and doctor warns,
/// naming both domains and the rename.
#[test]
fn doctor_warns_about_a_pair_that_differs_only_in_case() {
    let home = tempfile::tempdir().unwrap();
    let a = folder(home.path(), "a", None);
    let b = folder(home.path(), "b", None);
    let config = crate::common::isolation_env(home.path())
        .into_iter()
        .find(|(name, _)| *name == "XDG_CONFIG_HOME" || *name == "APPDATA")
        .map(|(_, dir)| dir.join("crystalline").join("config.yaml"))
        .unwrap();
    std::fs::create_dir_all(config.parent().unwrap()).unwrap();
    std::fs::write(
        &config,
        format!("domains:\n  eng:\n    path: {a}\n  Eng:\n    path: {b}\n"),
    )
    .unwrap();
    let out = run(home.path(), &["doctor", "--json"]);
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["case_twins"], serde_json::json!([["eng", "Eng"]]));
    let human = String::from_utf8_lossy(&run(home.path(), &["doctor"]).stdout).into_owned();
    assert!(
        human.contains("[warning] 'eng' and 'Eng' differ only in letter case")
            && human.contains("crystalline domain rename Eng <new name>"),
        "{human}"
    );
}
