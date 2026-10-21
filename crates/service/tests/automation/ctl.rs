//! The automation verbs on the control socket: the machine owner runs the
//! whole cycle with no account, and a refusal keeps its bare sentence.

use crystalline_service::control::answer_for_test;
use serde_json::{Value, json};

use crate::fixture::{Fx, fixture, manifest};

fn verb(cmd: &str, rest: Value) -> Value {
    let mut body = rest;
    body["v"] = json!(1);
    body["cmd"] = json!(cmd);
    body
}

async fn ask(fx: &Fx, cmd: &str, rest: Value) -> Value {
    answer_for_test(fx.engine.clone(), &verb(cmd, rest)).await
}

#[tokio::test]
async fn the_local_socket_runs_a_full_cycle_without_an_account() {
    let fx = fixture(&[("MANIFEST.md", &manifest(""))]).await;

    let status = ask(
        &fx,
        "automation_status",
        json!({ "loop": "evolve", "domains": ["eng"] }),
    )
    .await;
    assert_eq!(status["ok"], true, "{status}");
    assert_eq!(status["data"]["domains"][0]["domain"], "eng", "{status}");

    let take = ask(
        &fx,
        "automation_lease_take",
        json!({ "loop": "evolve", "domain": "eng", "runner": "cron" }),
    )
    .await;
    assert_eq!(take["ok"], true, "{take}");
    assert_eq!(take["data"]["renew_secs"], 60, "{take}");
    let token = take["data"]["token"]
        .as_str()
        .expect("the take carries the token");

    let again = ask(
        &fx,
        "automation_lease_take",
        json!({ "loop": "evolve", "domain": "eng", "runner": "second" }),
    )
    .await;
    assert_eq!(again["error"], "already running", "{again}");

    let renew = ask(
        &fx,
        "automation_lease_renew",
        json!({ "loop": "evolve", "domain": "eng", "token": token }),
    )
    .await;
    assert_eq!(renew["data"]["renewed"], true, "{renew}");

    let share = ask(
        &fx,
        "automation_share",
        json!({ "loop": "evolve", "domain": "eng", "token": token, "summary": "s" }),
    )
    .await;
    assert_eq!(share["ok"], true, "{share}");
    assert_eq!(share["data"]["attributed"], false, "{share}");

    let record = ask(
        &fx,
        "automation_run_record",
        json!({ "loop": "evolve", "domain": "eng", "token": token,
                "report": { "started_at": "", "outcome": "done", "done": 1, "summary": "ok" } }),
    )
    .await;
    assert_eq!(record["ok"], true, "{record}");

    let release = ask(
        &fx,
        "automation_lease_release",
        json!({ "loop": "evolve", "domain": "eng", "token": token }),
    )
    .await;
    assert_eq!(release["data"]["released"], false, "{release}");

    let runs = ask(
        &fx,
        "automation_runs",
        json!({ "loop": "evolve", "domain": "eng" }),
    )
    .await;
    assert_eq!(runs["data"]["runs"][0]["summary"], "ok", "{runs}");
}
