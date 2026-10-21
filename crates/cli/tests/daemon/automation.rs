//! `crystalline evolve` and `crystalline reflect` status, run, watch and
//! prompt against a real daemon, with a fake `claude` on PATH that prints
//! the stream a headless session prints and notes how it was called.
//!
//! Evolve is the loop under test: a summary pair without its reciprocal
//! (V103) is a mechanical finding, so the domain is due without any
//! Reflection set up.

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::daemon_env::DaemonEnv;

/// The summary block a fake agent ends with.
const SUMMARY: &str =
    "Fixed one reciprocal.\\n\\nDone: 1\\nLeft for a person: 0\\nErrors: 0\\nNothing waits.";

fn manifest(name: &str) -> String {
    format!(
        "---\ntype: manifest\ntitle: {name}\npermalink: manifest\ntags:\n  - manifest\nstatus: stable\nrecorded_at: 2026-01-01\n---\n\n# {name}\n\n## Scope\n\n- Everything about {name}\n\n## When to Use\n\n- Route here for {name} questions\n"
    )
}

fn engram(title: &str, permalink: &str, body: &str) -> String {
    format!(
        "---\ntype: engram\ntitle: {title}\npermalink: {permalink}\ntags:\n  - eng\nstatus: stable\nrecorded_at: 2026-09-01\n---\n\n# {title}\n\n{body}\n"
    )
}

/// A daemon serving `busy` (one mechanical finding) and `quiet` (none).
fn env_with_domains(tag: &str) -> DaemonEnv {
    let mut env = DaemonEnv::new(tag);
    let busy = env.dir.join("kb-busy");
    let quiet = env.dir.join("kb-quiet");
    std::fs::create_dir_all(&busy).unwrap();
    std::fs::create_dir_all(&quiet).unwrap();
    std::fs::write(busy.join("MANIFEST.md"), manifest("busy")).unwrap();
    std::fs::write(
        busy.join("summary-doc.md"),
        engram(
            "Summary doc",
            "summary-doc",
            "The distilled version of the migration write-up.\n\n- summarizes [[Full text doc]]\n- [context] written after the migration closed",
        ),
    )
    .unwrap();
    std::fs::write(
        busy.join("full-text-doc.md"),
        engram(
            "Full text doc",
            "full-text-doc",
            "The full migration write-up with the shard tables.\n\n- [context] the source the summary was cut from\n- [lesson] keep the tables out of the summary",
        ),
    )
    .unwrap();
    std::fs::write(quiet.join("MANIFEST.md"), manifest("quiet")).unwrap();
    let config = env.config_path();
    std::fs::create_dir_all(config.parent().unwrap()).unwrap();
    std::fs::write(
        &config,
        format!(
            "service:\n  response_format: json\ndomains:\n  busy:\n    path: {}\n  quiet:\n    path: {}\n",
            busy.display(),
            quiet.display()
        ),
    )
    .unwrap();
    env.serve();
    let start = Instant::now();
    loop {
        let s = status_json(&env, "busy");
        if s["domains"][0]["counts"]["mechanical"].as_u64() >= Some(1) {
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(30),
            "busy never became due: {s}"
        );
        std::thread::sleep(Duration::from_millis(200));
    }
    env
}

impl DaemonEnv {
    fn bin_dir(&self) -> PathBuf {
        self.dir.join("bin")
    }

    fn calls_file(&self) -> PathBuf {
        self.dir.join("claude-calls")
    }

    /// A `claude` that notes its argv, its MCP config's path and mode, runs
    /// `extra` (shell), prints an init line, an assistant message with
    /// `text` and a result line, and exits `code`.
    fn fake_claude(&self, extra: &str, text: &str, code: i32) {
        let dir = self.bin_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let calls = self.calls_file();
        let script = format!(
            r#"#!/bin/sh
cfg=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--mcp-config" ]; then cfg="$a"; fi
  prev="$a"
done
mode=$(stat -c %a "$cfg" 2>/dev/null || stat -f %Lp "$cfg")
{{
  echo "call"
  echo "cfg=$cfg"
  echo "mode=$mode"
  for a in "$@"; do echo "arg=$a"; done
}} >> "{calls}"
echo '{{"type":"system","subtype":"init","tools":[]}}'
{extra}
printf '%s\n' '{{"type":"assistant","message":{{"content":[{{"type":"text","text":"{text}"}}]}}}}'
printf '%s\n' '{{"type":"result","subtype":"success","is_error":false,"result":"{text}"}}'
exit {code}
"#,
            calls = calls.display(),
        );
        let path = dir.join("claude");
        std::fs::write(&path, script).unwrap();
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn calls(&self) -> String {
        std::fs::read_to_string(self.calls_file()).unwrap_or_default()
    }

    /// The CLI with this environment and the fake's folder first on PATH.
    fn cli(&self, args: &[&str]) -> Command {
        let mut cmd = crate::common::crystalline_std();
        self.apply(&mut cmd);
        let path = format!("{}:/usr/bin:/bin", self.bin_dir().display());
        cmd.env("PATH", path)
            .env(
                "CRYSTALLINE_BIN",
                assert_cmd::cargo::cargo_bin("crystalline"),
            )
            .args(args);
        cmd
    }

    fn output(&self, args: &[&str]) -> Output {
        self.cli(args).output().unwrap()
    }
}

fn status_json(env: &DaemonEnv, domain: &str) -> Value {
    let out = env.output(&["--json", "evolve", "status", "--domain", domain]);
    let text = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str(text.trim()).unwrap_or_else(|e| {
        panic!(
            "status json: {e}: {text} {}",
            String::from_utf8_lossy(&out.stderr)
        )
    })
}

fn code(out: &Output) -> Option<i32> {
    out.status.code()
}

fn explain(out: &Output) -> String {
    format!(
        "code {:?}\nstdout: {}\nstderr: {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

#[test]
fn status_exit_codes_follow_due() {
    let env = env_with_domains("st");
    let busy = env.output(&["evolve", "status", "--domain", "busy"]);
    assert_eq!(code(&busy), Some(0), "{}", explain(&busy));
    let line = String::from_utf8_lossy(&busy.stdout).into_owned();
    assert!(
        line.starts_with("busy: due (") && line.contains("mechanical 1"),
        "{}",
        explain(&busy)
    );
    let quiet = env.output(&["evolve", "status", "--domain", "quiet"]);
    assert_eq!(code(&quiet), Some(1), "{}", explain(&quiet));
    assert!(
        String::from_utf8_lossy(&quiet.stdout).contains("quiet: nothing due"),
        "{}",
        explain(&quiet)
    );
    let all = env.output(&["evolve", "status"]);
    assert_eq!(code(&all), Some(0), "{}", explain(&all));
    let unknown = env.output(&["evolve", "status", "--domain", "nope"]);
    assert_eq!(code(&unknown), Some(2), "{}", explain(&unknown));
    // Reflect is another loop: nothing is due there, and that is exit 1.
    let reflect = env.output(&["reflect", "status", "--domain", "busy"]);
    assert_ne!(code(&reflect), Some(0), "{}", explain(&reflect));
}

#[test]
fn status_without_a_daemon_is_an_error_that_says_how_to_start_one() {
    let env = DaemonEnv::new("nod");
    let out = env.output(&["evolve", "status"]);
    assert_eq!(code(&out), Some(2), "{}", explain(&out));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("Start the daemon (crystalline serve)"),
        "{}",
        explain(&out)
    );
}

#[test]
fn run_records_the_run_and_releases_the_lease() {
    let env = env_with_domains("rr");
    env.fake_claude("", SUMMARY, 0);
    let logs = env.dir.join("logs");
    let out = env.output(&[
        "evolve",
        "run",
        "--domain",
        "busy",
        "--runner",
        "k8s",
        "--log-dir",
        logs.to_str().unwrap(),
    ]);
    assert_eq!(code(&out), Some(0), "{}", explain(&out));

    let calls = env.calls();
    assert_eq!(calls.matches("call\n").count(), 1, "{calls}");
    assert!(calls.contains("mode=600"), "{calls}");
    assert!(calls.contains("arg=--strict-mcp-config"), "{calls}");
    assert!(
        calls.contains("arg=You run the evolve loop of the Crystalline domain `busy`"),
        "{calls}"
    );
    let cfg = calls
        .lines()
        .find_map(|l| l.strip_prefix("cfg="))
        .expect("the fake saw a config");
    assert!(!Path::new(cfg).exists(), "the MCP config was left behind");

    let log: Vec<PathBuf> = std::fs::read_dir(&logs)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(log.len(), 1, "{log:?}");
    let name = log[0].file_name().unwrap().to_string_lossy().into_owned();
    assert!(
        name.starts_with("evolve-busy-") && name.ends_with(".jsonl"),
        "{name}"
    );
    assert!(
        std::fs::read_to_string(&log[0])
            .unwrap()
            .contains("\"type\":\"result\"")
    );

    let s = status_json(&env, "busy");
    let d = &s["domains"][0];
    assert_eq!(d["running"], Value::Null, "the lease was released: {s}");
    assert_eq!(d["last_run"]["outcome"], "done", "{s}");
    assert_eq!(d["last_run"]["runner"], "k8s", "{s}");
    assert_eq!(d["last_run"]["done"], 1, "{s}");
    // The fake fixed nothing, so the finding is left for a person and not
    // due again.
    assert_eq!(d["due"], false, "{s}");
    assert_eq!(d["left_for_person"], 1, "{s}");
}

#[test]
fn a_run_without_a_summary_is_recorded_as_failed() {
    let env = env_with_domains("ns");
    env.fake_claude("", "I could not finish.", 0);
    let out = env.output(&["evolve", "run", "--domain", "busy"]);
    assert_eq!(code(&out), Some(0), "the agent's code: {}", explain(&out));
    let s = status_json(&env, "busy");
    assert_eq!(s["domains"][0]["last_run"]["outcome"], "failed", "{s}");
    // A failed run leaves nothing for a person: the finding stays due.
    assert_eq!(s["domains"][0]["due"], true, "{s}");
}

#[test]
fn a_run_at_the_cap_is_recorded_as_stopped_at_cap() {
    let env = env_with_domains("cap");
    env.fake_claude("", SUMMARY, 0);
    let out = env.output(&["evolve", "run", "--domain", "busy", "--max-items", "1"]);
    assert_eq!(code(&out), Some(0), "{}", explain(&out));
    let s = status_json(&env, "busy");
    assert_eq!(
        s["domains"][0]["last_run"]["outcome"], "stopped_at_cap",
        "{s}"
    );
}

#[test]
fn the_agent_exit_code_is_the_run_exit_code() {
    let env = env_with_domains("ec");
    env.fake_claude("", SUMMARY, 3);
    let out = env.output(&["evolve", "run", "--domain", "busy"]);
    assert_eq!(code(&out), Some(3), "{}", explain(&out));
    let s = status_json(&env, "busy");
    assert_eq!(s["domains"][0]["last_run"]["outcome"], "failed", "{s}");
    assert_eq!(s["domains"][0]["running"], Value::Null, "{s}");
}

#[test]
fn run_renews_the_lease_while_the_agent_runs() {
    let env = env_with_domains("rn");
    let seen = env.dir.join("seen");
    env.fake_claude(
        &format!(
            r#""$CRYSTALLINE_BIN" --json evolve status --domain busy > "{seen}.1"
sleep 3
"$CRYSTALLINE_BIN" --json evolve status --domain busy > "{seen}.2""#,
            seen = seen.display()
        ),
        SUMMARY,
        0,
    );
    let out = env
        .cli(&["evolve", "run", "--domain", "busy"])
        .env("CRYSTALLINE_LEASE_RENEW_SECS", "1")
        .output()
        .unwrap();
    assert_eq!(code(&out), Some(0), "{}", explain(&out));
    let read = |n: u8| -> Value {
        let text = std::fs::read_to_string(format!("{}.{n}", seen.display())).unwrap();
        serde_json::from_str(text.trim()).unwrap_or_else(|e| panic!("{e}: {text}"))
    };
    let first = read(1);
    let second = read(2);
    let running = &first["domains"][0]["running"];
    assert!(running.is_object(), "the lease is held: {first}");
    assert_eq!(first["domains"][0]["due"], false, "{first}");
    let later = &second["domains"][0]["running"];
    assert!(
        later["renewed_at"].as_str() > running["renewed_at"].as_str(),
        "the lease was renewed: {first} then {second}"
    );
    assert_eq!(later["taken_at"], running["taken_at"]);
}

#[test]
fn run_exits_1_when_nothing_is_due_without_starting_claude() {
    let env = env_with_domains("nd");
    env.fake_claude("", SUMMARY, 0);
    let out = env.output(&["evolve", "run", "--domain", "quiet"]);
    assert_eq!(code(&out), Some(1), "{}", explain(&out));
    assert!(
        env.calls().is_empty(),
        "claude was started: {}",
        env.calls()
    );
    let s = status_json(&env, "quiet");
    assert_eq!(s["domains"][0]["last_run"], Value::Null, "{s}");
}

#[test]
fn a_missing_claude_names_the_install_docs() {
    let env = env_with_domains("mc");
    let out = env.output(&["evolve", "run", "--domain", "busy"]);
    assert_eq!(code(&out), Some(2), "{}", explain(&out));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("https://code.claude.com/docs/en/setup"),
        "{}",
        explain(&out)
    );
    // Nothing was taken: the domain is still due and no run was recorded.
    let s = status_json(&env, "busy");
    assert_eq!(s["domains"][0]["due"], true, "{s}");
    assert_eq!(s["domains"][0]["last_run"], Value::Null, "{s}");
}

#[test]
fn a_dry_run_takes_no_lease_and_starts_no_agent() {
    let env = env_with_domains("dr");
    env.fake_claude("", SUMMARY, 0);
    let out = env.output(&["evolve", "run", "--domain", "busy", "--dry-run"]);
    assert_eq!(code(&out), Some(0), "{}", explain(&out));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("--strict-mcp-config"), "{stdout}");
    assert!(env.calls().is_empty(), "{}", env.calls());
    let s = status_json(&env, "busy");
    assert_eq!(s["domains"][0]["running"], Value::Null, "{s}");
    assert_eq!(s["domains"][0]["last_run"], Value::Null, "{s}");
}

fn sigterm(child: &std::process::Child) {
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(child.id().to_string())
        .status()
        .unwrap();
    assert!(status.success());
}

fn wait_exit(child: &mut std::process::Child, limit: Duration) -> std::process::ExitStatus {
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            panic!("the process did not stop within {limit:?}");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn a_sigterm_during_a_run_records_failed_and_releases() {
    let env = env_with_domains("tm");
    env.fake_claude("sleep 30", SUMMARY, 0);
    let mut child = env
        .cli(&["evolve", "run", "--domain", "busy"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let start = Instant::now();
    while env.calls().is_empty() {
        assert!(
            start.elapsed() < Duration::from_secs(30),
            "claude never ran"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    sigterm(&child);
    let status = wait_exit(&mut child, Duration::from_secs(20));
    assert_eq!(status.code(), Some(143), "{status:?}");
    let cfg = env
        .calls()
        .lines()
        .find_map(|l| l.strip_prefix("cfg=").map(str::to_string))
        .unwrap();
    assert!(!Path::new(&cfg).exists(), "the MCP config was left behind");
    let s = status_json(&env, "busy");
    assert_eq!(s["domains"][0]["running"], Value::Null, "{s}");
    assert_eq!(s["domains"][0]["last_run"]["outcome"], "failed", "{s}");
}

#[test]
fn watch_runs_once_when_due_and_stops_on_sigterm() {
    let env = env_with_domains("wa");
    env.fake_claude("", SUMMARY, 0);
    let mut child = env
        .cli(&["evolve", "watch", "--domain", "busy", "--interval", "1"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let start = Instant::now();
    loop {
        let s = status_json(&env, "busy");
        if s["domains"][0]["last_run"].is_object() {
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(30),
            "watch never ran: {s}"
        );
        std::thread::sleep(Duration::from_millis(200));
    }
    // A few more polls: the finding was left for a person, so nothing is
    // due and no second run starts.
    std::thread::sleep(Duration::from_secs(3));
    sigterm(&child);
    let status = wait_exit(&mut child, Duration::from_secs(20));
    assert_eq!(status.code(), Some(0), "{status:?}");
    assert_eq!(env.calls().matches("call\n").count(), 1, "{}", env.calls());
}

#[test]
fn evolve_without_a_subcommand_still_lists_findings() {
    let env = env_with_domains("fl");
    let out = env.output(&["--json", "evolve", "--domain", "busy"]);
    assert_eq!(code(&out), Some(0), "{}", explain(&out));
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    let rules: Vec<&str> = v["queue"]
        .as_array()
        .unwrap_or_else(|| panic!("no queue: {v}"))
        .iter()
        .filter_map(|f| f["rule"].as_str())
        .collect();
    assert!(rules.contains(&"V103"), "{v}");
}

#[test]
fn prompt_prints_the_shipped_prompt() {
    let env = DaemonEnv::new("pr");
    for (lp, word) in [
        (crystalline_core::automation::Loop::Reflect, "reflect"),
        (crystalline_core::automation::Loop::Evolve, "evolve"),
    ] {
        let out = env.output(&[word, "prompt", "--domain", "work", "--max-items", "7"]);
        assert_eq!(code(&out), Some(0), "{}", explain(&out));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            crystalline_core::automation::headless_prompt(lp, "work", 7)
        );
    }
}
