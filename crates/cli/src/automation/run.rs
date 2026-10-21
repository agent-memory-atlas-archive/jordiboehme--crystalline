//! `run` and `watch`: take the lease, run the agent, share, record.

use super::*;

pub(super) struct RunOptions {
    pub(super) max_items: u32,
    pub(super) max_turns: u32,
    pub(super) model: Option<String>,
    pub(super) log_dir: Option<PathBuf>,
    pub(super) runner: String,
    pub(super) no_share: bool,
    pub(super) dry_run: bool,
    pub(super) json: bool,
}

/// Work `domain`, or every due domain in scope: 1 when nothing is due or
/// every due domain is already running, else the last agent exit code that
/// was not 0 (or 0).
pub(super) async fn run_due(
    lp: Loop,
    client: &AutomationClient,
    domain: Option<&str>,
    opts: &RunOptions,
    stop: &watch::Receiver<bool>,
) -> anyhow::Result<u8> {
    let named: Vec<String> = domain.map(str::to_string).into_iter().collect();
    let answer = client.status(lp, &named).await?;
    let due: Vec<String> = domains_of(&answer)
        .iter()
        .filter(|d| d["due"] == true)
        .filter_map(|d| d["domain"].as_str().map(str::to_string))
        .collect();
    if due.is_empty() {
        for d in domains_of(&answer) {
            let name = d["domain"].as_str().unwrap_or("?");
            if d["running"].is_object() {
                println!("{name}: already running");
            } else if let Some(home) = d["runs_on"].as_str() {
                println!("{name}: runs on {home}");
            }
        }
        println!("Nothing is due.");
        return Ok(EXIT_NOTHING);
    }
    let claude = find_claude()?;
    let mut code = None;
    for name in &due {
        if *stop.borrow() {
            break;
        }
        match run_one(lp, client, name, &claude, opts, stop).await? {
            Ran::Busy => {}
            Ran::Exited(c) => {
                if c != 0 || code.is_none() {
                    code = Some(c);
                }
            }
        }
    }
    Ok(code.unwrap_or(EXIT_NOTHING))
}

/// What one domain's run came to.
pub(super) enum Ran {
    /// The lease was held elsewhere; nothing ran.
    Busy,
    /// The agent ran and ended with this code.
    Exited(u8),
}

/// How the agent session ended.
pub(super) enum Ended {
    /// It exited by itself, with this code (`None` when a signal killed it).
    Exited(Option<i32>),
    /// This process got a stop signal and stopped it.
    Stopped,
    /// A renew was refused: another run holds the lease now.
    LeaseLost(String),
    /// It could not be started or watched.
    Broken(String),
}

/// Take the lease on `domain`, run the agent, share, record. `Busy` when the
/// take was refused because a run is going or the loop runs elsewhere.
pub(super) async fn run_one(
    lp: Loop,
    client: &AutomationClient,
    domain: &str,
    claude: &Path,
    opts: &RunOptions,
    stop: &watch::Receiver<bool>,
) -> anyhow::Result<Ran> {
    let prompt = headless_prompt(lp, domain, opts.max_items);
    if opts.dry_run {
        let shown = ClaudeRun {
            program: claude.to_path_buf(),
            mcp_config: PathBuf::from("<mcp config>"),
            prompt: "<prompt>".to_string(),
            max_turns: opts.max_turns,
            model: opts.model.clone(),
        };
        let mut words = vec![claude.to_string_lossy().into_owned()];
        words.extend(
            claude_args(&shown).into_iter().map(
                |a| {
                    if a.is_empty() { "\"\"".to_string() } else { a }
                },
            ),
        );
        println!("Would run the {lp} loop on {domain}:");
        println!("  {}", words.join(" "));
        return Ok(Ran::Exited(0));
    }
    let take = match client
        .verb(
            "automation_lease_take",
            lp,
            json!({ "domain": domain, "runner": opts.runner }),
        )
        .await
    {
        Ok(take) => take,
        Err(e) if is_refusal(&e) && is_busy(&e) => {
            println!("{domain}: {e}");
            return Ok(Ran::Busy);
        }
        Err(e) => return Err(e),
    };
    let token = take["token"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("the lease answer carried no token"))?
        .to_string();
    let renew_secs = renew_secs(take["renew_secs"].as_u64());
    let started = chrono::Utc::now();
    let lease = Lease {
        client,
        lp,
        domain,
        token: &token,
    };

    let log_path = match log_path(opts.log_dir.as_deref(), lp, domain, &started) {
        Ok(path) => path,
        Err(e) => return lease.fail_and_err(&started, e).await,
    };
    let config = match client
        .mcp_config()
        .await
        .and_then(|c| PrivateConfig::write(&c))
    {
        Ok(config) => config,
        Err(e) => return lease.fail_and_err(&started, e).await,
    };
    if !opts.json {
        println!(
            "Running the {lp} loop on {domain}. The stream goes to {}.",
            log_path.display()
        );
    }
    let run = ClaudeRun {
        program: claude.to_path_buf(),
        mcp_config: config.path.clone(),
        prompt,
        max_turns: opts.max_turns,
        model: opts.model.clone(),
    };
    let (ended, last) = run_agent(&run, &log_path, &lease, renew_secs, stop.clone()).await;
    drop(config);

    let summary = last.as_deref().and_then(parse_run_summary);
    let (outcome, text) = judge(&ended, summary.as_ref(), opts.max_items);
    let exit = match &ended {
        Ended::Exited(Some(c)) => u8::try_from(*c).unwrap_or(1),
        Ended::Exited(None) | Ended::LeaseLost(_) | Ended::Broken(_) => 1,
        Ended::Stopped => 143,
    };

    let share = if opts.no_share || !matches!(ended, Ended::Exited(_)) {
        None
    } else {
        match client
            .verb(
                "automation_share",
                lp,
                json!({ "domain": domain, "token": token, "summary": text }),
            )
            .await
        {
            Ok(answer) => Some(answer),
            Err(e) => {
                eprintln!("Sharing the run's changes failed: {e:#}");
                None
            }
        }
    };
    let report = json!({
        "started_at": started.to_rfc3339(),
        "outcome": outcome,
        "done": summary.as_ref().map_or(0, |s| s.done),
        "summary": text,
    });
    let record = client
        .verb(
            "automation_run_record",
            lp,
            json!({ "domain": domain, "token": token, "report": report }),
        )
        .await;
    let record = match (&ended, record) {
        (_, Ok(record)) => record,
        (Ended::LeaseLost(why), Err(_)) => {
            anyhow::bail!("{domain}: the lease was lost during the run: {why}")
        }
        (_, Err(e)) => return Err(e.context(format!("recording the run on {domain}"))),
    };
    if opts.json {
        println!(
            "{}",
            json!({
                "domain": domain,
                "loop": lp,
                "exit_code": exit,
                "log": log_path,
                "share": share,
                "run": record["run"],
            })
        );
    } else {
        if let Some(url) = share.as_ref().and_then(|s| s["url"].as_str()) {
            println!("Shared the changes for review: {url}");
        }
        println!(
            "Recorded the run on {domain}: {}, {} done.",
            outcome.as_str(),
            summary.as_ref().map_or(0, |s| s.done)
        );
    }
    Ok(Ran::Exited(exit))
}

/// A take refusal that means "not now": a run is going, or the loop runs on
/// another instance.
pub(super) fn is_busy(e: &anyhow::Error) -> bool {
    let text = e.to_string();
    text == "already running" || text.starts_with("runs on ")
}

pub(super) fn renew_secs(server: Option<u64>) -> u64 {
    std::env::var(RENEW_SECS_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .or(server)
        .unwrap_or(LEASE_RENEW_SECS)
        .max(1)
}

/// The outcome a run is recorded with, and its summary text.
///
/// `stopped_at_cap` when the summary's `done` reached the cap, `done` when
/// the agent exited 0 with a summary below it, `failed` otherwise: no
/// summary, an exit code that is not 0, a stop signal or a lost lease. Never
/// `done` without a parsed summary.
pub(super) fn judge(
    ended: &Ended,
    summary: Option<&RunSummary>,
    max_items: u32,
) -> (RunOutcome, String) {
    let counts = summary.map(|s| {
        let mut text = format!(
            "Done: {}. Left for a person: {}. Errors: {}.",
            s.done, s.left, s.errors
        );
        if !s.text.is_empty() {
            text.push_str("\n\n");
            text.push_str(&s.text);
        }
        text
    });
    let why = match ended {
        Ended::Exited(Some(0)) => None,
        Ended::Exited(Some(c)) => Some(format!("The agent exited with code {c}.")),
        Ended::Exited(None) => Some("The agent was killed by a signal.".to_string()),
        Ended::Stopped => Some("The run was stopped by a signal.".to_string()),
        Ended::LeaseLost(_) => Some("Another run took the lease.".to_string()),
        Ended::Broken(e) => Some(format!("The agent could not run: {e}")),
    };
    match (why, summary, counts) {
        (None, Some(s), Some(text)) => {
            let outcome = if s.done >= u64::from(max_items) {
                RunOutcome::StoppedAtCap
            } else {
                RunOutcome::Done
            };
            (outcome, text)
        }
        (None, _, _) => (
            RunOutcome::Failed,
            "The agent ended without a summary block.".to_string(),
        ),
        (Some(why), _, Some(text)) => (RunOutcome::Failed, format!("{why}\n\n{text}")),
        (Some(why), _, None) => (RunOutcome::Failed, why),
    }
}

/// The lease a run holds, for the paths that must record before they fail.
pub(super) struct Lease<'a> {
    client: &'a AutomationClient,
    lp: Loop,
    domain: &'a str,
    token: &'a str,
}

impl Lease<'_> {
    pub(super) async fn renew(&self) -> anyhow::Result<Value> {
        self.client
            .verb(
                "automation_lease_renew",
                self.lp,
                json!({ "domain": self.domain, "token": self.token }),
            )
            .await
    }

    /// Record a failed run (which releases the lease), then return `e`.
    pub(super) async fn fail_and_err<T>(
        &self,
        started: &chrono::DateTime<chrono::Utc>,
        e: anyhow::Error,
    ) -> anyhow::Result<T> {
        let report = json!({
            "started_at": started.to_rfc3339(),
            "outcome": RunOutcome::Failed,
            "done": 0,
            "summary": format!("The run could not start: {e:#}"),
        });
        if let Err(record) = self
            .client
            .verb(
                "automation_run_record",
                self.lp,
                json!({ "domain": self.domain, "token": self.token, "report": report }),
            )
            .await
        {
            eprintln!("Recording the failed run failed too: {record:#}");
        }
        Err(e)
    }
}

/// `<log_dir>/<loop>-<domain>-<started>.jsonl`, the folder made if needed.
pub(super) fn log_path(
    log_dir: Option<&Path>,
    lp: Loop,
    domain: &str,
    started: &chrono::DateTime<chrono::Utc>,
) -> anyhow::Result<PathBuf> {
    let dir = match log_dir {
        Some(dir) => dir.to_path_buf(),
        None => crystalline_core::config::state_dir()?.join("runs"),
    };
    std::fs::create_dir_all(&dir)?;
    let safe: String = domain
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect();
    Ok(dir.join(format!(
        "{lp}-{safe}-{}.jsonl",
        started.format("%Y%m%dT%H%M%SZ")
    )))
}

/// The text of the session's final answer: the `result` event's `result`,
/// else the last assistant message's text.
#[derive(Default)]
pub(super) struct Scan {
    result: Option<String>,
    assistant: Option<String>,
}

impl Scan {
    pub(super) fn read(&mut self, line: &str) {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            return;
        };
        match event["type"].as_str() {
            Some("result") => {
                if let Some(text) = event["result"].as_str() {
                    self.result = Some(text.to_string());
                }
            }
            Some("assistant") => {
                let text: Vec<&str> = event["message"]["content"]
                    .as_array()
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|b| b["type"] == "text")
                            .filter_map(|b| b["text"].as_str())
                            .collect()
                    })
                    .unwrap_or_default();
                if !text.is_empty() {
                    self.assistant = Some(text.join("\n"));
                }
            }
            _ => {}
        }
    }

    pub(super) fn last(self) -> Option<String> {
        self.result.or(self.assistant)
    }
}

/// Run the agent to its end, renewing the lease, writing its stream to
/// `log_path`. Returns how it ended and the text of its final answer.
pub(super) async fn run_agent(
    run: &ClaudeRun,
    log_path: &Path,
    lease: &Lease<'_>,
    renew_secs: u64,
    mut stop: watch::Receiver<bool>,
) -> (Ended, Option<String>) {
    let log = match std::fs::File::create(log_path) {
        Ok(file) => file,
        Err(e) => return (Ended::Broken(format!("{}: {e}", log_path.display())), None),
    };
    let mut command = tokio::process::Command::from(claude_command(run));
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => return (Ended::Broken(e.to_string()), None),
    };
    let scan = Arc::new(Mutex::new(Scan::default()));
    let reader = child.stdout.take().map(|stdout| {
        let scan = scan.clone();
        tokio::spawn(async move {
            let mut log = std::io::BufWriter::new(log);
            let mut lines = tokio::io::BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = writeln!(log, "{line}");
                scan.lock().unwrap().read(&line);
            }
            let _ = log.flush();
        })
    });

    let period = Duration::from_secs(renew_secs);
    let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
    let ended = loop {
        tokio::select! {
            status = child.wait() => {
                break match status {
                    Ok(status) => Ended::Exited(status.code()),
                    Err(e) => Ended::Broken(e.to_string()),
                };
            }
            _ = stop.wait_for(|stopped| *stopped) => {
                stop_child(&mut child).await;
                break Ended::Stopped;
            }
            _ = ticker.tick() => {
                match lease.renew().await {
                    Ok(_) => {}
                    Err(e) if is_refusal(&e) => {
                        eprintln!("The lease on {} was lost: {e:#}. Stopping the agent.", lease.domain);
                        stop_child(&mut child).await;
                        break Ended::LeaseLost(e.to_string());
                    }
                    Err(e) => eprintln!("Renewing the lease failed, trying again: {e:#}"),
                }
            }
        }
    };
    // What is left of the stream after the agent ended. A process it left
    // behind may hold the pipe open, so the wait is bounded.
    if let Some(reader) = reader {
        let abort = reader.abort_handle();
        if tokio::time::timeout(STOP_GRACE, reader).await.is_err() {
            abort.abort();
        }
    }
    let last = std::mem::take(&mut *scan.lock().unwrap()).last();
    (ended, last)
}

/// Stop the agent and everything it started: SIGTERM to its process group,
/// then SIGKILL after [`STOP_GRACE`].
pub(super) async fn stop_child(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id().and_then(|pid| i32::try_from(pid).ok()) {
        // SAFETY: kill(2) with a negative pid signals that process group;
        // the group is the child's own (`process_group(0)`).
        unsafe {
            libc::kill(-pid, libc::SIGTERM);
        }
        if tokio::time::timeout(STOP_GRACE, child.wait()).await.is_ok() {
            // SAFETY: as above; whatever the agent left in its group goes too.
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
            return;
        }
        // SAFETY: as above.
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
    let _ = child.start_kill();
    let _ = child.wait().await;
}

/// Poll every `interval` seconds and run each due domain, until a stop
/// signal. An error is printed and the next poll tries again, so a daemon
/// restart or a network gap does not end a sidecar.
pub(super) async fn watch_loop(
    lp: Loop,
    client: &AutomationClient,
    domains: &[String],
    interval: u64,
    claude: &Path,
    opts: &RunOptions,
    mut stop: watch::Receiver<bool>,
) {
    loop {
        if *stop.borrow() {
            return;
        }
        match client.status(lp, domains).await {
            Ok(answer) => {
                let due: Vec<String> = domains_of(&answer)
                    .iter()
                    .filter(|d| d["due"] == true)
                    .filter_map(|d| d["domain"].as_str().map(str::to_string))
                    .collect();
                for domain in due {
                    if *stop.borrow() {
                        return;
                    }
                    if let Err(e) = run_one(lp, client, &domain, claude, opts, &stop).await {
                        eprintln!("Error: {e:#}");
                    }
                }
            }
            Err(e) => eprintln!("Error: {e:#}"),
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(interval)) => {}
            _ = stop.wait_for(|stopped| *stopped) => return,
        }
    }
}

/// A flag that turns true on SIGTERM or Ctrl-C.
pub(super) fn stop_signal() -> watch::Receiver<bool> {
    let (tx, rx) = watch::channel(false);
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{SignalKind, signal};
            let Ok(mut term) = signal(SignalKind::terminate()) else {
                return;
            };
            tokio::select! {
                _ = term.recv() => {}
                _ = tokio::signal::ctrl_c() => {}
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
        let _ = tx.send(true);
    });
    rx
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary(done: u64) -> RunSummary {
        RunSummary {
            done,
            left: 1,
            errors: 0,
            text: "One thread waits.".to_string(),
        }
    }

    #[test]
    fn the_outcome_follows_the_exit_the_summary_and_the_cap() {
        let ok = Ended::Exited(Some(0));
        let (o, text) = judge(&ok, Some(&summary(3)), 20);
        assert_eq!(o, RunOutcome::Done);
        assert_eq!(
            text,
            "Done: 3. Left for a person: 1. Errors: 0.\n\nOne thread waits."
        );
        assert_eq!(
            judge(&ok, Some(&summary(20)), 20).0,
            RunOutcome::StoppedAtCap
        );
        assert_eq!(judge(&ok, None, 20).0, RunOutcome::Failed);
        let (o, text) = judge(&Ended::Exited(Some(3)), Some(&summary(1)), 20);
        assert_eq!(o, RunOutcome::Failed);
        assert!(text.starts_with("The agent exited with code 3."), "{text}");
        assert_eq!(
            judge(&Ended::Stopped, Some(&summary(1)), 20).0,
            RunOutcome::Failed
        );
        assert_eq!(judge(&Ended::Exited(None), None, 20).0, RunOutcome::Failed);
    }

    #[test]
    fn the_final_answer_is_the_result_else_the_last_assistant_text() {
        let mut scan = Scan::default();
        scan.read(r#"{"type":"system","subtype":"init"}"#);
        scan.read(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"first"}]}}"#);
        scan.read(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"x"}]}}"#);
        scan.read("not json");
        assert_eq!(std::mem::take(&mut scan).last().as_deref(), Some("first"));
        scan.read(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"a"}]}}"#);
        scan.read(r#"{"type":"result","result":"the end","is_error":false}"#);
        assert_eq!(scan.last().as_deref(), Some("the end"));
    }
}
