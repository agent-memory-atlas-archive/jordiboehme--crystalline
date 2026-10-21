//! `crystalline reflect` and `crystalline evolve` run their loop headless:
//! `status` says whether work is due, `run` works one due domain with a
//! Claude Code agent, `watch` polls and runs, and `prompt` prints the shipped
//! prompt for a runner outside the CLI.
//!
//! Every call goes through the automation verbs: to the local daemon over
//! its control socket, or to a server over the ctl route when
//! `CRYSTALLINE_REMOTE_URL` and `CRYSTALLINE_REMOTE_TOKEN` are set (ruling
//! R2). The agent reaches Crystalline the same way: the stdio `crystalline
//! mcp` entry locally, the server's HTTP MCP endpoint with the bearer
//! remotely.
//!
//! A run holds its lease from the take to the record. Every path after the
//! take ends in a record (which releases), so a failure never leaves a lease
//! behind that only the five-minute expiry could clear.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use clap::Subcommand;
use crystalline_core::automation::{
    HEADLESS_DISALLOWED_TOOLS, LEASE_RENEW_SECS, Loop, RunOutcome, RunSummary, headless_prompt,
    parse_run_summary,
};
use crystalline_remote::{Connection, RemoteFailure};
use serde_json::{Value, json};
use tokio::io::AsyncBufReadExt as _;
use tokio::sync::watch;

use crate::ExitWith;

/// Where a person installs Claude Code, named when `claude` is missing.
pub const CLAUDE_INSTALL_DOCS: &str = "https://code.claude.com/docs/en/setup";

/// Overrides the lease renew interval in seconds. A test seam: the server's
/// `renew_secs` (60) is the rule.
const RENEW_SECS_ENV: &str = "CRYSTALLINE_LEASE_RENEW_SECS";

/// The prefix Claude Code gives the tools of the MCP server registered as
/// `crystalline`.
const MCP_TOOL_PREFIX: &str = "mcp__crystalline";

/// How long a server may take for one automation verb. A share opens a pull
/// request and an evolve status sweeps the domain, so the ctl default is too
/// short.
const REMOTE_VERB_LIMIT: Duration = Duration::from_secs(300);

/// How long a stopped agent gets to end before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);

/// Exit code of `status`, `run` and `watch` when something went wrong, so a
/// shell `if` never reads an error as "nothing due".
const EXIT_ERROR: u8 = 2;

/// Exit code of `status` and `run` when nothing is due or a run already
/// holds the lease.
const EXIT_NOTHING: u8 = 1;

/// The four things a loop command does.
#[derive(Subcommand, Debug)]
pub enum LoopCommand {
    /// Show what is due, per domain. Exit 0 when something is due, 1 when
    /// nothing is due, 2 on an error.
    Status {
        /// Only these domains (repeatable). Omit for every domain you may run
        /// the loop on.
        #[arg(long)]
        domain: Vec<String>,
    },
    /// Work what is due with a headless Claude Code agent: take the lease,
    /// run the agent with the shipped prompt, share its changes as a pull
    /// request, record the run and release the lease. Exit 1 when nothing is
    /// due or a run is already going, 2 on an error, else the agent's exit
    /// code.
    Run {
        /// The domain to work. Omit to work every due domain in turn.
        #[arg(long)]
        domain: Option<String>,
        /// The most items the agent works in one run.
        #[arg(long, default_value_t = 20)]
        max_items: u32,
        /// The most agent turns in one run.
        #[arg(long, default_value_t = 60)]
        max_turns: u32,
        /// The model the agent uses. Defaults to Claude Code's own default.
        #[arg(long)]
        model: Option<String>,
        /// Where the agent's stream is written, one file per run. Defaults
        /// to the runs folder in the state directory.
        #[arg(long)]
        log_dir: Option<PathBuf>,
        /// The runner label the lease and the run record show, for example
        /// k8s.
        #[arg(long, default_value = "cli")]
        runner: String,
        /// Keep the run's changes local instead of sharing them as a pull
        /// request.
        #[arg(long)]
        no_share: bool,
        /// Show what would run and stop. Takes no lease and starts no agent.
        #[arg(long)]
        dry_run: bool,
    },
    /// Poll the status and run when something is due. Runs until it gets
    /// SIGTERM or Ctrl-C; a run in progress is stopped and recorded first.
    Watch {
        /// Only these domains (repeatable). Omit for every domain you may run
        /// the loop on.
        #[arg(long)]
        domain: Vec<String>,
        /// Seconds between two status checks.
        #[arg(long, default_value_t = 60)]
        interval: u64,
    },
    /// Print the shipped prompt a headless run starts its agent with, for a
    /// runner outside the CLI.
    Prompt {
        /// The domain the prompt names.
        #[arg(long)]
        domain: String,
        /// The item cap the prompt names.
        #[arg(long, default_value_t = 20)]
        max_items: u32,
    },
}

/// Run `command` for loop `lp`.
pub async fn run(lp: Loop, command: LoopCommand, json: bool) -> anyhow::Result<()> {
    if let LoopCommand::Prompt { domain, max_items } = &command {
        print!("{}", headless_prompt(lp, domain, *max_items));
        return Ok(());
    }
    let stop = stop_signal();
    let code = match dispatch(lp, command, json, stop).await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("Error: {e:#}");
            EXIT_ERROR
        }
    };
    if code == 0 {
        Ok(())
    } else {
        Err(ExitWith(code).into())
    }
}

async fn dispatch(
    lp: Loop,
    command: LoopCommand,
    json: bool,
    stop: watch::Receiver<bool>,
) -> anyhow::Result<u8> {
    let client = AutomationClient::from_env().await?;
    match command {
        LoopCommand::Status { domain } => {
            let answer = client.status(lp, &domain).await?;
            if json {
                println!("{answer}");
            } else {
                print_status(&answer);
            }
            Ok(if any_due(&answer) { 0 } else { EXIT_NOTHING })
        }
        LoopCommand::Run {
            domain,
            max_items,
            max_turns,
            model,
            log_dir,
            runner,
            no_share,
            dry_run,
        } => {
            let opts = RunOptions {
                max_items,
                max_turns,
                model,
                log_dir,
                runner,
                no_share,
                dry_run,
                json,
            };
            run_due(lp, &client, domain.as_deref(), &opts, &stop).await
        }
        LoopCommand::Watch { domain, interval } => {
            let opts = RunOptions {
                max_items: 20,
                max_turns: 60,
                model: None,
                log_dir: None,
                runner: "cli".to_string(),
                no_share: false,
                dry_run: false,
                json,
            };
            let claude = find_claude()?;
            watch_loop(lp, &client, &domain, interval.max(1), &claude, &opts, stop).await;
            Ok(0)
        }
        LoopCommand::Prompt { .. } => unreachable!("prompt is answered before any client"),
    }
}

// --- the client ------------------------------------------------------------

/// Where the automation verbs go.
pub enum AutomationClient {
    /// The daemon on this machine, over its control socket.
    Local,
    /// A server, over the ctl route, as the token's account.
    Remote(Box<Connection>),
}

/// No daemon answered on this machine.
#[derive(Debug)]
struct NoDaemon;

impl std::fmt::Display for NoDaemon {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("no Crystalline daemon is running. Start the daemon (crystalline serve).")
    }
}

impl std::error::Error for NoDaemon {}

impl AutomationClient {
    /// The server from `CRYSTALLINE_REMOTE_URL` and `CRYSTALLINE_REMOTE_TOKEN`
    /// when both are set, else the local daemon.
    pub async fn from_env() -> anyhow::Result<AutomationClient> {
        let Some(source) =
            crystalline_remote::env_source(crystalline_core::secret_env::process_var, &[])
        else {
            return Ok(AutomationClient::Local);
        };
        let dir = crystalline_remote::remote_dir()?;
        let connection = tokio::task::spawn_blocking(move || Connection::open(source, &dir))
            .await??
            .with_limit(REMOTE_VERB_LIMIT);
        Ok(AutomationClient::Remote(Box::new(connection)))
    }

    /// Send automation verb `cmd` (a ctl request with `v` and `cmd`) and
    /// return its `data`. A refusal comes back as its bare sentence.
    pub async fn call(&self, cmd: Value) -> anyhow::Result<Value> {
        match self {
            AutomationClient::Local => match crystalline_service::ctl_if_running(cmd).await? {
                Some(data) => Ok(data),
                None => Err(NoDaemon.into()),
            },
            AutomationClient::Remote(connection) => {
                Ok(connection.ctl_data(cmd).await.map_err(anyhow::Error::new)?)
            }
        }
    }

    async fn verb(&self, name: &str, lp: Loop, rest: Value) -> anyhow::Result<Value> {
        let mut request = rest;
        request["v"] = json!(1);
        request["cmd"] = json!(name);
        request["loop"] = json!(lp);
        self.call(request).await
    }

    async fn status(&self, lp: Loop, domains: &[String]) -> anyhow::Result<Value> {
        let rest = if domains.is_empty() {
            json!({})
        } else {
            json!({ "domains": domains })
        };
        self.verb("automation_status", lp, rest).await
    }

    /// The MCP config the agent connects with. The remote one holds the
    /// bearer, so it is only ever written to [`PrivateConfig`].
    async fn mcp_config(&self) -> anyhow::Result<Value> {
        match self {
            AutomationClient::Local => {
                let exe = std::env::current_exe()?;
                Ok(local_mcp_config(&exe))
            }
            AutomationClient::Remote(connection) => {
                let token = connection.bearer().await.map_err(anyhow::Error::new)?;
                Ok(remote_mcp_config(&connection.source().url, &token))
            }
        }
    }
}

/// Whether `e` is the other side's answer (a refusal), not a failure to
/// reach it. A refused renew means the lease is lost; an unreachable one is
/// retried on the next tick.
fn is_refusal(e: &anyhow::Error) -> bool {
    if let Some(failure) = e.downcast_ref::<RemoteFailure>() {
        return matches!(
            failure,
            RemoteFailure::Refused(_) | RemoteFailure::Invalid(_)
        );
    }
    e.downcast_ref::<NoDaemon>().is_none()
        && e.downcast_ref::<std::io::Error>().is_none()
        && e.downcast_ref::<serde_json::Error>().is_none()
}

/// The stdio entry for the local daemon: this binary's `mcp` verb.
///
/// It carries no `--harness`, unlike the entry `crystalline install`
/// registers. With `--harness claude-code` on a machine where Claude Code's
/// session hooks are installed the server leaves the `skills` tool out of
/// its list, since that harness reads the skills from disk. A headless run
/// loads no settings, hooks or skills from disk (`--setting-sources ""`), and
/// its prompt starts with the `skills` tool, so it needs the served surface.
fn local_mcp_config(exe: &Path) -> Value {
    json!({
        "mcpServers": {
            "crystalline": {
                "command": exe.to_string_lossy(),
                "args": ["mcp"],
            }
        }
    })
}

/// The HTTP entry for a server: its MCP endpoint is the root of `url` (the
/// transport answers there, under any base path), with the bearer header.
fn remote_mcp_config(url: &str, token: &str) -> Value {
    json!({
        "mcpServers": {
            "crystalline": {
                "type": "http",
                "url": format!("{}/", url.trim_end_matches('/')),
                "headers": { "Authorization": format!("Bearer {token}") },
            }
        }
    })
}

// --- the private MCP config ------------------------------------------------

/// The agent's MCP config in a fresh directory only this user can read. The
/// file and the directory go away when this is dropped: at the end of a
/// run, on an error and after a stop signal alike.
struct PrivateConfig {
    /// Removed with everything in it on drop.
    _dir: tempfile::TempDir,
    path: PathBuf,
}

impl PrivateConfig {
    fn write(config: &Value) -> anyhow::Result<PrivateConfig> {
        let dir = tempfile::Builder::new()
            .prefix("crystalline-run-")
            .tempdir()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700))?;
        }
        let path = dir.path().join("mcp.json");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut file = options.open(&path)?;
        file.write_all(serde_json::to_string(config)?.as_bytes())?;
        file.sync_all()?;
        Ok(PrivateConfig { _dir: dir, path })
    }
}

// --- the claude command ----------------------------------------------------

/// What one headless agent session is started with.
pub struct ClaudeRun {
    /// The `claude` binary.
    pub program: PathBuf,
    /// The MCP config file.
    pub mcp_config: PathBuf,
    /// The filled-in shipped prompt.
    pub prompt: String,
    /// `--max-turns`.
    pub max_turns: u32,
    /// `--model`, when one is named.
    pub model: Option<String>,
}

/// The tools a headless agent may never call, in Claude Code's names.
fn disallowed_tools() -> String {
    HEADLESS_DISALLOWED_TOOLS
        .iter()
        .map(|name| format!("{MCP_TOOL_PREFIX}__{name}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// The argv after the program, in order. The prompt comes last, after `-p`,
/// so none of the list-taking flags (`--tools`, `--allowedTools`,
/// `--disallowedTools`, `--mcp-config`) can take it for one of its values.
fn claude_args(cfg: &ClaudeRun) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--mcp-config".into(),
        cfg.mcp_config.to_string_lossy().into_owned(),
        "--strict-mcp-config".into(),
        "--setting-sources".into(),
        String::new(),
        "--tools".into(),
        String::new(),
        "--allowedTools".into(),
        MCP_TOOL_PREFIX.into(),
        "--disallowedTools".into(),
        disallowed_tools(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--max-turns".into(),
        cfg.max_turns.to_string(),
    ];
    if let Some(model) = &cfg.model {
        args.push("--model".into());
        args.push(model.clone());
    }
    args.push("-p".into());
    args.push(cfg.prompt.clone());
    args
}

/// The `claude -p` command of one headless run: only the Crystalline MCP
/// server, no built-in tools, no settings files, the forbidden tools denied
/// and the stream as JSON lines.
pub fn claude_command(cfg: &ClaudeRun) -> std::process::Command {
    let mut command = std::process::Command::new(&cfg.program);
    command.args(claude_args(cfg));
    command
}

/// `claude` on `PATH`, or the error that names the install docs.
fn find_claude() -> anyhow::Result<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["claude.exe", "claude.cmd", "claude"]
    } else {
        &["claude"]
    };
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in names {
                let candidate = dir.join(name);
                if is_executable(&candidate) {
                    return Ok(candidate);
                }
            }
        }
    }
    anyhow::bail!(
        "claude is not on PATH. A headless run needs Claude Code. Install it: {CLAUDE_INSTALL_DOCS}"
    )
}

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        meta.is_file() && meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        meta.is_file()
    }
}

// --- status ----------------------------------------------------------------

fn domains_of(answer: &Value) -> &[Value] {
    answer["domains"].as_array().map_or(&[], Vec::as_slice)
}

fn any_due(answer: &Value) -> bool {
    domains_of(answer).iter().any(|d| d["due"] == true)
}

fn count_line(counts: &Value) -> String {
    let Some(map) = counts.as_object() else {
        return String::new();
    };
    map.iter()
        .map(|(key, n)| format!("{} {n}", key.replace('_', " ")))
        .collect::<Vec<_>>()
        .join(", ")
}

/// One line per domain, plus the last run when there was one.
fn print_status(answer: &Value) {
    let domains = domains_of(answer);
    if domains.is_empty() {
        println!("No domain to run this loop on.");
        return;
    }
    for d in domains {
        let name = d["domain"].as_str().unwrap_or("?");
        let state = if let Some(home) = d["runs_on"].as_str() {
            format!("runs on {home}")
        } else if let Some(reason) = d["reason"].as_str() {
            reason.to_string()
        } else if d["running"].is_object() {
            format!(
                "running ({} since {})",
                d["running"]["runner"].as_str().unwrap_or("?"),
                d["running"]["taken_at"].as_str().unwrap_or("?")
            )
        } else if d["due"] == true {
            "due".to_string()
        } else {
            "nothing due".to_string()
        };
        let counts = count_line(&d["counts"]);
        if counts.is_empty() {
            println!("{name}: {state}");
        } else {
            println!("{name}: {state} ({counts})");
        }
        let left = d["left_for_person"].as_u64().unwrap_or(0);
        if left > 0 {
            println!("  left for a person: {left}");
        }
        if let Some(run) = d["last_run"].as_object() {
            println!(
                "  last run: {} at {}, {} done",
                run.get("outcome").and_then(Value::as_str).unwrap_or("?"),
                run.get("ended_at").and_then(Value::as_str).unwrap_or("?"),
                run.get("done").and_then(Value::as_u64).unwrap_or(0),
            );
        }
    }
}

// --- run -------------------------------------------------------------------

struct RunOptions {
    max_items: u32,
    max_turns: u32,
    model: Option<String>,
    log_dir: Option<PathBuf>,
    runner: String,
    no_share: bool,
    dry_run: bool,
    json: bool,
}

/// Work `domain`, or every due domain in scope: 1 when nothing is due or
/// every due domain is already running, else the last agent exit code that
/// was not 0 (or 0).
async fn run_due(
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
enum Ran {
    /// The lease was held elsewhere; nothing ran.
    Busy,
    /// The agent ran and ended with this code.
    Exited(u8),
}

/// How the agent session ended.
enum Ended {
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
async fn run_one(
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
fn is_busy(e: &anyhow::Error) -> bool {
    let text = e.to_string();
    text == "already running" || text.starts_with("runs on ")
}

fn renew_secs(server: Option<u64>) -> u64 {
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
fn judge(ended: &Ended, summary: Option<&RunSummary>, max_items: u32) -> (RunOutcome, String) {
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
struct Lease<'a> {
    client: &'a AutomationClient,
    lp: Loop,
    domain: &'a str,
    token: &'a str,
}

impl Lease<'_> {
    async fn renew(&self) -> anyhow::Result<Value> {
        self.client
            .verb(
                "automation_lease_renew",
                self.lp,
                json!({ "domain": self.domain, "token": self.token }),
            )
            .await
    }

    /// Record a failed run (which releases the lease), then return `e`.
    async fn fail_and_err<T>(
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
fn log_path(
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
struct Scan {
    result: Option<String>,
    assistant: Option<String>,
}

impl Scan {
    fn read(&mut self, line: &str) {
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

    fn last(self) -> Option<String> {
        self.result.or(self.assistant)
    }
}

/// Run the agent to its end, renewing the lease, writing its stream to
/// `log_path`. Returns how it ended and the text of its final answer.
async fn run_agent(
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
async fn stop_child(child: &mut tokio::process::Child) {
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

// --- watch -----------------------------------------------------------------

/// Poll every `interval` seconds and run each due domain, until a stop
/// signal. An error is printed and the next poll tries again, so a daemon
/// restart or a network gap does not end a sidecar.
async fn watch_loop(
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
fn stop_signal() -> watch::Receiver<bool> {
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

    fn pinned_run(model: Option<&str>) -> ClaudeRun {
        ClaudeRun {
            program: PathBuf::from("/usr/local/bin/claude"),
            mcp_config: PathBuf::from("/tmp/run/mcp.json"),
            prompt: "the prompt".to_string(),
            max_turns: 60,
            model: model.map(str::to_string),
        }
    }

    #[test]
    fn the_claude_command_has_the_pinned_shape() {
        let command = claude_command(&pinned_run(Some("sonnet")));
        assert_eq!(command.get_program(), "/usr/local/bin/claude");
        let args: Vec<String> = command
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "--mcp-config",
                "/tmp/run/mcp.json",
                "--strict-mcp-config",
                "--setting-sources",
                "",
                "--tools",
                "",
                "--allowedTools",
                "mcp__crystalline",
                "--disallowedTools",
                "mcp__crystalline__delete_engram,mcp__crystalline__move_engram,\
                 mcp__crystalline__split_engram,mcp__crystalline__remove_domain,\
                 mcp__crystalline__add_domain,mcp__crystalline__configure,\
                 mcp__crystalline__provision,mcp__crystalline__share_changes,\
                 mcp__crystalline__update_domain,mcp__crystalline__resolve_conflict,\
                 mcp__crystalline__withdraw_proposal,mcp__crystalline__discard_changes",
                "--output-format",
                "stream-json",
                "--verbose",
                "--max-turns",
                "60",
                "--model",
                "sonnet",
                "-p",
                "the prompt",
            ]
        );
        let without: Vec<String> = claude_command(&pinned_run(None))
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert!(!without.iter().any(|a| a == "--model"), "{without:?}");
        assert_eq!(without[without.len() - 2..], ["-p", "the prompt"]);
    }

    #[test]
    fn the_disallowed_tools_are_every_headless_tool_by_its_mcp_name() {
        let list = disallowed_tools();
        let names: Vec<&str> = list.split(',').collect();
        assert_eq!(names.len(), HEADLESS_DISALLOWED_TOOLS.len());
        for (full, bare) in names.iter().zip(HEADLESS_DISALLOWED_TOOLS) {
            assert_eq!(*full, format!("mcp__crystalline__{bare}"));
        }
    }

    #[test]
    fn the_mcp_configs_have_their_pinned_shapes() {
        assert_eq!(
            local_mcp_config(Path::new("/opt/bin/crystalline")),
            json!({ "mcpServers": { "crystalline": {
                "command": "/opt/bin/crystalline", "args": ["mcp"] } } })
        );
        assert_eq!(
            remote_mcp_config("https://team.example.com/base/", "cmt_secret"),
            json!({ "mcpServers": { "crystalline": {
                "type": "http",
                "url": "https://team.example.com/base/",
                "headers": { "Authorization": "Bearer cmt_secret" } } } })
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_mcp_config_is_private_and_goes_away() {
        use std::os::unix::fs::PermissionsExt as _;
        let config = PrivateConfig::write(&remote_mcp_config("https://x", "cmt_t")).unwrap();
        let path = config.path.clone();
        let dir = path.parent().unwrap().to_path_buf();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(&dir), 0o700);
        assert!(std::fs::read_to_string(&path).unwrap().contains("cmt_t"));
        drop(config);
        assert!(!path.exists() && !dir.exists());
    }

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
