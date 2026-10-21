//! The reflect and evolve loops, run headless: whether a loop is due on a
//! domain, the lease a runner takes while it works, the run it records and
//! the pull request it shares its changes in.
//!
//! Status is computed from state alone (R1): what the loop would work now,
//! less what a finished run left for a person at the same version (R3), and
//! nothing while a fresh lease is held. A run shares only the files it
//! changed (R4): the lease keeps the domain's unshared files with their
//! checksums at take time.

use super::*;
use crystalline_core::automation::{
    LEASE_RENEW_SECS, LEASE_STALE_SECS, Loop, RUNS_KEPT, RunOutcome, RunReport, SUMMARY_MAX_BYTES,
    cap_summary,
};
use crystalline_index::{
    AutomationLease, AutomationRun, DueKey, LeaseClaim, LeaseHolder, PathChecksum,
};

use crate::scope::{ReflectionCaller, ReflectionRight, Scope};

/// Why a domain whose loop can run nowhere here is not due.
const NOT_HOSTED_HERE: &str = "not hosted here";

/// The refusal of a take while another run holds a fresh lease.
const ALREADY_RUNNING: &str = "already running";

/// The longest runner label a lease keeps.
const RUNNER_MAX_BYTES: usize = 128;

/// The summary an expired run is recorded with.
const EXPIRED_SUMMARY: &str = "The runner stopped renewing its lease.";

/// Where a loop on a domain may run, seen from this instance.
enum Runs {
    /// Here.
    Here,
    /// On another instance, by its name.
    On(String),
    /// Nowhere right now, for this reason (a Reflection that is off, a
    /// read-only domain).
    Nowhere(EngineError),
}

/// What a loop would work on a domain now: every item with its key and
/// version, before the items a run left are taken out.
#[derive(Default)]
struct Work {
    /// Each item, and for reflect the page it is on.
    items: Vec<(DueKey, String)>,
    /// Judgment findings (evolve), never due.
    judgment: u64,
}

/// [`Work`] less the items a finished run left for a person.
struct Due {
    items: Vec<(DueKey, String)>,
    left: usize,
    judgment: u64,
}

/// The reflection caller a loop's rights are decided for.
fn loop_caller(scope: &Scope) -> ReflectionCaller {
    match scope {
        Scope::Unrestricted => ReflectionCaller::owner(),
        Scope::User { account, .. } => ReflectionCaller::person(scope.clone(), account),
        Scope::Anonymous => ReflectionCaller::person(Scope::Anonymous, "anonymous"),
    }
}

/// Who a run shares as.
fn share_actor(scope: &Scope) -> ShareActor {
    match scope {
        Scope::Unrestricted => ShareActor::Owner,
        Scope::User { account, .. } => ShareActor::Account(account.clone()),
        Scope::Anonymous => ShareActor::HttpAgent,
    }
}

/// The account a runner works as, when it has one.
fn scope_account(scope: &Scope) -> Option<String> {
    match scope {
        Scope::User { account, .. } => Some(account.clone()),
        _ => None,
    }
}

fn same_item(a: &DueKey, b: &DueKey) -> bool {
    a.kind == b.kind && a.key == b.key && a.version == b.version
}

/// A sha256 over `parts`, each closed by a NUL.
fn version_of<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0u8]);
    }
    crystalline_index::hex_lower(&hasher.finalize())
}

/// A run as the answers show it: everything but the items it left, which
/// are bookkeeping keyed by page paths and folder names (`left` counts
/// them).
fn run_json(run: &AutomationRun) -> Value {
    let mut value = json!(run);
    if let Some(obj) = value.as_object_mut() {
        obj.remove("left_items");
    }
    value
}

/// What a status answer shows of a lease that is still fresh.
fn running_json(lease: &AutomationLease) -> Value {
    json!({
        "runner": lease.holder.runner,
        "account": lease.holder.account,
        "taken_at": lease.taken_at,
        "renewed_at": lease.renewed_at,
    })
}

impl Engine {
    /// Whether `lp` is due on each of `domains`, or on every domain `scope`
    /// may run it on when none are named: `{loop, domains: [{domain, loop,
    /// due, counts, left_for_person, running, runs_on, last_run}]}`.
    ///
    /// Reflect counts the queue a headless run works (threads waiting for
    /// the agent, feedback, page updates; no update of a page open in a live
    /// editor), evolve counts its findings and only mechanical ones are due.
    /// An item a finished run left for a person is not due again until it
    /// changes, and is counted in `left_for_person` instead. A held lease
    /// reports `running` and nothing is due; a domain whose loop runs on
    /// another instance names it in `runs_on` and is never due here. A named
    /// domain the caller may not run the loop on is refused; the unnamed
    /// scope leaves it out.
    pub async fn automation_status(
        &self,
        lp: Loop,
        domains: &[String],
        scope: &Scope,
    ) -> Result<Value> {
        let named: Vec<String> = if domains.is_empty() {
            self.loop_domains(lp, scope).await?
        } else {
            let mut once: Vec<String> = Vec::new();
            for name in domains {
                self.require_loop_right(lp, name, scope).await?;
                if !once.contains(name) {
                    once.push(name.clone());
                }
            }
            once
        };
        let mut out = Vec::with_capacity(named.len());
        for domain in &named {
            out.push(self.loop_status(lp, domain, scope).await?);
        }
        Ok(json!({ "loop": lp, "domains": out }))
    }

    /// Take the lease of `lp` on `domain` for `runner`: `{token,
    /// renew_secs}`. Refused with "already running" while another run holds
    /// a fresh lease, and with "runs on" and its name where another instance
    /// runs the loop. A stale lease is taken over, and the run that held it
    /// is recorded as expired, once: the store names the lease the claim
    /// replaced in the claim itself.
    pub async fn automation_lease_take(
        &self,
        lp: Loop,
        domain: &str,
        runner: &str,
        scope: &Scope,
    ) -> Result<Value> {
        let runner = runner.trim();
        if runner.is_empty() || runner.len() > RUNNER_MAX_BYTES {
            return Err(EngineError::Invalid(format!(
                "runner must be a label of 1 to {RUNNER_MAX_BYTES} bytes"
            )));
        }
        self.require_loop_right(lp, domain, scope).await?;
        match self.loop_runs(lp, domain, scope).await {
            Runs::Here => {}
            Runs::On(name) => return Err(EngineError::Refused(format!("runs on {name}"))),
            Runs::Nowhere(e) => return Err(e),
        }
        let id = self.loop_domain_id(domain).await?;
        let due = self.loop_due(lp, domain, id, scope).await?;
        let unshared_at_start = self.unshared_now(domain, scope).await?;
        let (now, stale_before) = self.automation_window();
        let holder = LeaseHolder {
            instance_id: self.instance_id.clone(),
            account: scope_account(scope),
            runner: runner.to_string(),
            unshared_at_start,
            due_at_start: due.items.into_iter().map(|(key, _)| key).collect(),
        };
        let store = self.store.lock().await;
        match store
            .take_automation_lease(id, lp.as_str(), &holder, &now, &stale_before)
            .await?
        {
            LeaseClaim::Held(_) => Err(EngineError::Refused(ALREADY_RUNNING.to_string())),
            LeaseClaim::Acquired { token, replaced } => {
                // A take that lands over a lease means that lease was stale:
                // its runner stopped, and the history says so.
                if let Some(old) = replaced {
                    let run = AutomationRun {
                        started_at: old.taken_at.clone(),
                        ended_at: old.renewed_at.clone(),
                        runner: old.holder.runner.clone(),
                        account: old.holder.account.clone(),
                        outcome: RunOutcome::Expired.as_str().to_string(),
                        done: 0,
                        left: 0,
                        judgment_waiting: 0,
                        summary: EXPIRED_SUMMARY.to_string(),
                        pr_url: old.pr_url.clone(),
                        left_items: Vec::new(),
                    };
                    store
                        .record_automation_run(id, lp.as_str(), &run, RUNS_KEPT)
                        .await?;
                }
                Ok(json!({ "token": token, "renew_secs": LEASE_RENEW_SECS }))
            }
        }
    }

    /// Renew the lease `token` names: `{renewed: true, renew_secs}`. Refused
    /// when the lease is gone or another run took it.
    pub async fn automation_lease_renew(
        &self,
        lp: Loop,
        domain: &str,
        token: &str,
        scope: &Scope,
    ) -> Result<Value> {
        self.require_loop_right(lp, domain, scope).await?;
        let id = self.loop_domain_id(domain).await?;
        let (now, _) = self.automation_window();
        let renewed = {
            let store = self.store.lock().await;
            store
                .renew_automation_lease(id, lp.as_str(), token, &now)
                .await?
        };
        if !renewed {
            return Err(lease_lost(lp, domain));
        }
        Ok(json!({ "renewed": true, "renew_secs": LEASE_RENEW_SECS }))
    }

    /// Release the lease `token` names: `{released}`, `false` when the lease
    /// is gone or another run holds it.
    pub async fn automation_lease_release(
        &self,
        lp: Loop,
        domain: &str,
        token: &str,
        scope: &Scope,
    ) -> Result<Value> {
        self.require_loop_right(lp, domain, scope).await?;
        let id = self.loop_domain_id(domain).await?;
        let released = {
            let store = self.store.lock().await;
            store
                .release_automation_lease(id, lp.as_str(), token)
                .await?
        };
        Ok(json!({ "released": released.is_some() }))
    }

    /// Record the run that holds `token`, then release its lease: `{run}`.
    ///
    /// The release is the authority: it is a compare-and-delete on the
    /// token, and the run is recorded from the lease it returns, in the same
    /// store lock. A token that no longer holds the lease (it expired and
    /// another run took it, or it was never this lease's) is refused and
    /// records nothing.
    ///
    /// Only a `done` run leaves items for a person: every item due when the
    /// lease was taken that is still due at the same version (R3). A run that
    /// stopped at its cap, failed or expired leaves none, so what it did not
    /// reach stays due. An evolve run also counts the judgment findings
    /// waiting. The summary keeps its first 2 KiB, and the pull request the
    /// run shared in rides along from the lease.
    pub async fn automation_run_record(
        &self,
        lp: Loop,
        domain: &str,
        token: &str,
        report: &RunReport,
        scope: &Scope,
    ) -> Result<Value> {
        let started_at = report.started_at.trim();
        if !started_at.is_empty() && DateTime::parse_from_rfc3339(started_at).is_err() {
            return Err(EngineError::Invalid(format!(
                "started_at '{started_at}' is not an RFC 3339 time"
            )));
        }
        self.require_loop_right(lp, domain, scope).await?;
        let id = self.loop_domain_id(domain).await?;
        // A wrong token is refused before the work is counted; the release
        // below decides for good.
        self.held_lease(lp, domain, id, token).await?;
        // Counted before the lock, so a long evolve sweep holds no store
        // lock; it may be a moment old by the time the run is recorded.
        let needs_work = report.outcome == RunOutcome::Done || lp == Loop::Evolve;
        let work = if needs_work {
            self.loop_work(lp, domain, scope).await?
        } else {
            Work::default()
        };
        let (now, _) = self.automation_window();
        let store = self.store.lock().await;
        let Some(lease) = store
            .release_automation_lease(id, lp.as_str(), token)
            .await?
        else {
            return Err(lease_lost(lp, domain));
        };
        let left_items: Vec<DueKey> = if report.outcome == RunOutcome::Done {
            lease
                .holder
                .due_at_start
                .iter()
                .filter(|start| work.items.iter().any(|(now, _)| same_item(start, now)))
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        let run = AutomationRun {
            started_at: if started_at.is_empty() {
                lease.taken_at.clone()
            } else {
                started_at.to_string()
            },
            ended_at: now,
            runner: lease.holder.runner.clone(),
            account: lease.holder.account.clone(),
            outcome: report.outcome.as_str().to_string(),
            done: report.done,
            left: left_items.len() as u64,
            judgment_waiting: work.judgment,
            summary: cap_summary(&report.summary, SUMMARY_MAX_BYTES).to_string(),
            pr_url: lease.pr_url.clone(),
            left_items,
        };
        store
            .record_automation_run(id, lp.as_str(), &run, RUNS_KEPT)
            .await?;
        drop(store);
        Ok(json!({ "domain": domain, "loop": lp, "run": run_json(&run) }))
    }

    /// Note that `account` wrote `paths` in `domain`, for the run whose
    /// lease that account holds there (R4, ruling B). The MCP tool dispatch
    /// calls this after every write-shaped tool that succeeded; nothing else
    /// does, so a write over REST, Fluid, the files or a sync is never noted
    /// and never shared by a run. A domain with no fresh lease of that
    /// account notes nothing.
    pub async fn note_written(&self, domain: &str, account: &str, paths: &[String]) -> Result<()> {
        if paths.is_empty() || account.is_empty() {
            return Ok(());
        }
        let (_, stale_before) = self.automation_window();
        let store = self.store.lock().await;
        let Some(id) = store.domain_id(domain).await? else {
            return Ok(());
        };
        store
            .note_automation_written(id, account, paths, &stale_before)
            .await?;
        Ok(())
    }

    /// Share what the run that holds `token` changed, as a pull request
    /// whatever the domain's `sharing` says (R4): `{outcome: "shared" |
    /// "nothing_to_share" | "no_origin", url?, files, held_back, attributed}`.
    ///
    /// Only the runner's own MCP writes are shared: the paths the lease's
    /// account wrote over MCP while it held the lease
    /// ([`Engine::note_written`]) that are unshared now. A lease with no
    /// account cannot attribute a write; it shares the files that are new
    /// or changed since the take instead, and says `attributed: false`.
    /// Either way a path a person had unshared work on when the lease was
    /// taken is held back, even when the run changed it too: it is listed
    /// in `held_back` and named in the pull request description, so a
    /// person shares it. The title names the loop, the domain and the date;
    /// the description is the summary, capped like the run record's.
    pub async fn automation_share(
        &self,
        lp: Loop,
        domain: &str,
        token: &str,
        summary: &str,
        scope: &Scope,
    ) -> Result<Value> {
        self.require_loop_right(lp, domain, scope).await?;
        let id = self.loop_domain_id(domain).await?;
        let lease = self.held_lease(lp, domain, id, token).await?;
        let attributed = lease.holder.account.is_some();
        if !self.config.read().unwrap().github_enabled() || !self.domain_has_origin(domain)? {
            return Ok(json!({
                "outcome": "no_origin",
                "files": [],
                "held_back": [],
                "attributed": attributed,
            }));
        }
        let start = &lease.holder.unshared_at_start;
        let candidates: Vec<String> = self
            .unshared_now(domain, scope)
            .await?
            .into_iter()
            .filter(|now| {
                if attributed {
                    lease.written.contains(&now.path)
                } else {
                    !start
                        .iter()
                        .any(|s| s.path == now.path && s.checksum == now.checksum)
                }
            })
            .map(|now| now.path)
            .collect();
        let (mut held_back, files): (Vec<String>, Vec<String>) = candidates
            .into_iter()
            .partition(|path| start.iter().any(|s| &s.path == path));
        held_back.sort();
        if files.is_empty() {
            return Ok(json!({
                "outcome": "nothing_to_share",
                "files": [],
                "held_back": held_back,
                "attributed": attributed,
            }));
        }
        let title = format!(
            "{} run on {domain}, {}",
            lp.title_word(),
            self.automation_clock().format("%Y-%m-%d")
        );
        let mut description = cap_summary(summary, SUMMARY_MAX_BYTES).to_string();
        if !held_back.is_empty() {
            let n = held_back.len();
            description.push_str(&format!(
                "\n\n{n} {} held back because a person had unshared work on {}.",
                if n == 1 { "file was" } else { "files were" },
                if n == 1 { "it" } else { "them" },
            ));
        }
        let receipt = self
            .origin_share_with(
                domain,
                Some(&title),
                Some(&description),
                None,
                Some(&files),
                Some(true),
                share_actor(scope),
            )
            .await?;
        let report = match receipt["outcome"].as_str() {
            Some("proposed") => &receipt,
            Some("updated") => &receipt["proposal"],
            Some("nothing_to_share") => {
                return Ok(json!({
                    "outcome": "nothing_to_share",
                    "files": [],
                    "held_back": held_back,
                    "attributed": attributed,
                }));
            }
            _ => &Value::Null,
        };
        let Some(url) = report["url"].as_str().map(str::to_string) else {
            // Anything else (conflicts waiting, a diverged proposal) is the
            // share's own answer, passed on as it came.
            let mut answer = receipt.clone();
            answer["files"] = json!(files);
            answer["held_back"] = json!(held_back);
            answer["attributed"] = json!(attributed);
            return Ok(answer);
        };
        {
            let store = self.store.lock().await;
            store
                .set_automation_pr_url(id, lp.as_str(), token, &url)
                .await?;
        }
        // What the pull request carries, as the share reports it.
        let carried: Vec<&Value> = ["added", "updated", "deleted"]
            .iter()
            .filter_map(|k| report[*k].as_array())
            .flatten()
            .collect();
        Ok(json!({
            "outcome": "shared",
            "url": url,
            "files": carried,
            "held_back": held_back,
            "attributed": attributed,
        }))
    }

    /// The newest `limit` runs of `lp` on `domain`, newest first:
    /// `{domain, loop, runs}`. The items a run left are its own
    /// bookkeeping and stay out; `left` counts them.
    pub async fn automation_runs(
        &self,
        lp: Loop,
        domain: &str,
        limit: usize,
        scope: &Scope,
    ) -> Result<Value> {
        self.require_loop_right(lp, domain, scope).await?;
        let id = self.loop_domain_id(domain).await?;
        let runs = {
            let store = self.store.lock().await;
            store
                .automation_runs(id, lp.as_str(), limit.clamp(1, RUNS_KEPT))
                .await?
        };
        let runs: Vec<Value> = runs.iter().map(run_json).collect();
        Ok(json!({ "domain": domain, "loop": lp, "runs": runs }))
    }

    /// Read `at` as now in the automation verbs, or the real clock again
    /// with `None`.
    #[cfg(any(test, feature = "testing"))]
    pub fn set_automation_now(&self, at: Option<DateTime<FixedOffset>>) {
        *self.automation_now.lock().unwrap() = at;
    }

    /// Now, for the automation verbs: the test clock when one is set.
    fn automation_clock(&self) -> DateTime<FixedOffset> {
        #[cfg(any(test, feature = "testing"))]
        if let Some(at) = *self.automation_now.lock().unwrap() {
            return at;
        }
        now_offset()
    }

    /// `(now, stale_before)` in the one RFC 3339 spelling every lease time
    /// is written in, so the store compares them as strings.
    fn automation_window(&self) -> (String, String) {
        let now = self.automation_clock();
        let stale_before = now - Duration::seconds(LEASE_STALE_SECS);
        (now.to_rfc3339(), stale_before.to_rfc3339())
    }

    /// Refuse a caller who may not run `lp` on `domain`: reflect needs the
    /// right to curate its Reflection, evolve to write its knowledge. The
    /// right alone: where the loop runs is the status's to say.
    async fn require_loop_right(&self, lp: Loop, domain: &str, scope: &Scope) -> Result<()> {
        match lp {
            Loop::Reflect => {
                let (right, _) = self
                    .caller_reflection_right(domain, &loop_caller(scope))
                    .await?;
                if right < ReflectionRight::Curate {
                    return Err(EngineError::Forbidden(format!(
                        "your access to the Reflection of '{domain}' is {}, and curate is needed to run its reflect loop",
                        crate::scope::reflection_right_word(right)
                    )));
                }
            }
            Loop::Evolve => {
                self.require_domain(domain, scope).await?;
                if self.domain_is_read_only(domain).await {
                    return Err(EngineError::DomainReadOnly(domain.to_string()));
                }
                if !self
                    .writable_domains(scope)
                    .await?
                    .iter()
                    .any(|d| d == domain)
                {
                    return Err(EngineError::Forbidden(format!(
                        "you may not write to '{domain}', so you may not run its evolve loop"
                    )));
                }
            }
        }
        Ok(())
    }

    /// Every domain `scope` may run `lp` on: reflect, the domains with
    /// Reflection switched on that it curates (wherever their home is), not
    /// read-only and not a local copy a connected server replaces; evolve,
    /// the domains it may write.
    async fn loop_domains(&self, lp: Loop, scope: &Scope) -> Result<Vec<String>> {
        match lp {
            Loop::Evolve => self.writable_domains(scope).await,
            Loop::Reflect => {
                let hidden = self.hidden_for(scope).await?;
                let caller = loop_caller(scope);
                // Like the unnamed reflect queue: no local copy a connected
                // server replaces, and no read-only domain.
                let shadowed = self.shadowed_domains();
                let mut names = self.known_domain_names();
                names.retain(|name| !hidden.contains(name) && !shadowed.contains(name));
                names.sort();
                names.dedup();
                let mut out = Vec::new();
                for name in names {
                    if self.reflection_switch(&name) == crystalline_core::ReflectionSwitch::Off
                        || self.domain_is_read_only(&name).await
                    {
                        continue;
                    }
                    if matches!(
                        self.caller_reflection_right(&name, &caller).await,
                        Ok((right, _)) if right >= ReflectionRight::Curate
                    ) {
                        out.push(name);
                    }
                }
                Ok(out)
            }
        }
    }

    /// Where `lp` on `domain` runs. Reflect runs on the Reflection's home
    /// ([`Engine::reflection_home_here`]); evolve on the instance that holds
    /// the domain's host lock, which off a shared database is this one.
    async fn loop_runs(&self, lp: Loop, domain: &str, scope: &Scope) -> Runs {
        match lp {
            Loop::Reflect => {
                if self.reflection_home_here(domain).await {
                    return Runs::Here;
                }
                match self.reflection_state(domain).await {
                    Ok(crystalline_core::reflection::ReflectionState::Elsewhere { url }) => {
                        Runs::On(url)
                    }
                    Ok(crystalline_core::reflection::ReflectionState::HostedElsewhere {
                        label: Some(label),
                    }) => Runs::On(label),
                    _ => Runs::Nowhere(
                        match self
                            .require_reflection(
                                domain,
                                &loop_caller(scope),
                                ReflectionRight::Curate,
                            )
                            .await
                        {
                            Err(e) => e,
                            Ok(_) if self.domain_is_read_only(domain).await => {
                                EngineError::DomainReadOnly(domain.to_string())
                            }
                            Ok(_) => EngineError::Refused(format!(
                                "the Reflection of '{domain}' cannot run here right now; try again later"
                            )),
                        },
                    ),
                }
            }
            Loop::Evolve => {
                if self.domain_is_read_only(domain).await {
                    return Runs::Nowhere(EngineError::DomainReadOnly(domain.to_string()));
                }
                if !self.store_is_shared().await {
                    return Runs::Here;
                }
                let store = self.store.lock().await;
                let host = match store.domain_id(domain).await {
                    Ok(Some(id)) => store.domain_host(id).await,
                    Ok(None) => Ok(None),
                    Err(e) => Err(e),
                };
                drop(store);
                match host {
                    Ok(Some(host))
                        if !host.instance_id.is_empty() && host.instance_id != self.instance_id =>
                    {
                        Runs::On(if host.label.is_empty() {
                            host.instance_id
                        } else {
                            host.label
                        })
                    }
                    Ok(_) => Runs::Here,
                    Err(e) => Runs::Nowhere(e.into()),
                }
            }
        }
    }

    /// The index row of `domain`, which the lease and the runs hang on.
    async fn loop_domain_id(&self, domain: &str) -> Result<DomainId> {
        let store = self.store.lock().await;
        store.domain_id(domain).await?.ok_or_else(|| {
            EngineError::Invalid(format!(
                "domain '{domain}' is not indexed yet; try again after its first sync"
            ))
        })
    }

    /// The lease of `lp` on `domain` when `token` holds it, a stale one
    /// included; refused otherwise.
    async fn held_lease(
        &self,
        lp: Loop,
        domain: &str,
        id: DomainId,
        token: &str,
    ) -> Result<AutomationLease> {
        let lease = {
            let store = self.store.lock().await;
            store.automation_lease(id, lp.as_str()).await?
        };
        lease
            .filter(|lease| !token.is_empty() && lease.token == token)
            .ok_or_else(|| lease_lost(lp, domain))
    }

    /// What `lp` would work on `domain` now, every item with its version.
    async fn loop_work(&self, lp: Loop, domain: &str, scope: &Scope) -> Result<Work> {
        match lp {
            Loop::Reflect => {
                let items = self.reflect_due_items(domain, &loop_caller(scope)).await?;
                Ok(Work {
                    items: items.into_iter().map(|due| (due.key, due.page)).collect(),
                    judgment: 0,
                })
            }
            Loop::Evolve => {
                let today = self.automation_clock().date_naive().to_string();
                let swept = self
                    .evolve_findings(
                        &EvolveParams {
                            domains: vec![domain.to_string()],
                            today: Some(today),
                            ..EvolveParams::default()
                        },
                        scope,
                    )
                    .await?;
                // One item per rule, engram and (for a pair rule) pair; the
                // version is the scope an acknowledgment records, which moves
                // only when the evidence does, never with the date. A rule
                // whose scope is empty keeps one constant version, so once a
                // run left it, it stays left until its key changes, as an
                // acknowledgment of it would.
                let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
                let mut judgment = 0u64;
                for f in &swept.findings {
                    if f.class != Class::Mechanical {
                        judgment += 1;
                        continue;
                    }
                    let mut key = format!("{}:{}:{}", f.rule, f.domain, f.permalink);
                    if crystalline_index::is_pair_scoped(f.rule) && !f.scope.is_empty() {
                        key.push(':');
                        key.push_str(&f.scope);
                    }
                    grouped.entry(key).or_default().push(f.scope.clone());
                }
                let items = grouped
                    .into_iter()
                    .map(|(key, mut scopes)| {
                        scopes.sort();
                        let version = version_of(scopes.iter().map(String::as_str));
                        (
                            DueKey {
                                kind: "finding".to_string(),
                                key,
                                version,
                            },
                            String::new(),
                        )
                    })
                    .collect();
                Ok(Work { items, judgment })
            }
        }
    }

    /// [`Engine::loop_work`] less what a finished run among the last
    /// [`RUNS_KEPT`] left for a person at the same version.
    async fn loop_due(&self, lp: Loop, domain: &str, id: DomainId, scope: &Scope) -> Result<Due> {
        let work = self.loop_work(lp, domain, scope).await?;
        let runs = {
            let store = self.store.lock().await;
            store.automation_runs(id, lp.as_str(), RUNS_KEPT).await?
        };
        let left: Vec<&DueKey> = runs.iter().flat_map(|run| run.left_items.iter()).collect();
        let total = work.items.len();
        let items: Vec<(DueKey, String)> = work
            .items
            .into_iter()
            .filter(|(item, _)| !left.iter().any(|l| same_item(l, item)))
            .collect();
        Ok(Due {
            left: total - items.len(),
            items,
            judgment: work.judgment,
        })
    }

    /// One domain's entry in [`Engine::automation_status`].
    async fn loop_status(&self, lp: Loop, domain: &str, scope: &Scope) -> Result<Value> {
        let runs_on = self.loop_runs(lp, domain, scope).await;
        let id = {
            let store = self.store.lock().await;
            store.domain_id(domain).await?
        };
        let (lease, last_run) = match id {
            Some(id) => {
                let store = self.store.lock().await;
                (
                    store.automation_lease(id, lp.as_str()).await?,
                    store
                        .automation_runs(id, lp.as_str(), 1)
                        .await?
                        .into_iter()
                        .next(),
                )
            }
            None => (None, None),
        };
        let (_, stale_before) = self.automation_window();
        let running = lease.filter(|lease| lease.renewed_at.as_str() >= stale_before.as_str());
        let due = match (&runs_on, id) {
            (Runs::Here, Some(id)) => Some(self.loop_due(lp, domain, id, scope).await?),
            _ => None,
        };
        let counts = match lp {
            Loop::Reflect => {
                let items = due.as_ref().map(|d| d.items.as_slice()).unwrap_or_default();
                let of = |kind: &str| items.iter().filter(|(k, _)| k.kind == kind).count();
                let pages = items
                    .iter()
                    .filter(|(k, page)| k.kind == "update" && !page.is_empty())
                    .map(|(_, page)| page.as_str())
                    .collect::<BTreeSet<_>>()
                    .len();
                json!({
                    "waiting_for_the_agent": of("review"),
                    "feedback": of("feedback"),
                    "updates": of("update"),
                    "pages_to_update": pages,
                })
            }
            Loop::Evolve => json!({
                "mechanical": due.as_ref().map_or(0, |d| d.items.len()),
                "judgment": due.as_ref().map_or(0, |d| d.judgment),
            }),
        };
        let is_due = running.is_none() && due.as_ref().is_some_and(|d| !d.items.is_empty());
        Ok(json!({
            "domain": domain,
            "loop": lp,
            "due": is_due,
            "counts": counts,
            "left_for_person": due.as_ref().map_or(0, |d| d.left),
            "running": running.as_ref().map(running_json),
            "runs_on": match &runs_on {
                Runs::On(name) => Some(name.as_str()),
                _ => None,
            },
            "reason": match runs_on {
                Runs::Nowhere(_) => Some(NOT_HOSTED_HERE),
                _ => None,
            },
            "last_run": last_run.as_ref().map(run_json),
        }))
    }

    /// The unshared files of `domain` with their checksums now, the way a
    /// share sees them: a reviewing domain's drafts of the caller, else the
    /// working tree against the base. Empty for a domain with no origin.
    /// A deleted file has an empty checksum.
    async fn unshared_now(&self, domain: &str, scope: &Scope) -> Result<Vec<PathChecksum>> {
        if !self.config.read().unwrap().github_enabled() || !self.domain_has_origin(domain)? {
            return Ok(Vec::new());
        }
        if self.reviews_changes(domain) {
            let Some(actor) = crate::scope::overlay_actor(scope) else {
                return Ok(Vec::new());
            };
            let (_, root, _) = self.origin_spec_for_domain(domain)?;
            return Ok(self
                .overlay_local_changes(domain, &root, &actor)
                .await?
                .into_iter()
                .map(|(path, _, bytes)| PathChecksum {
                    path,
                    checksum: bytes.map(|b| sha256_hex(&b)).unwrap_or_default(),
                })
                .collect());
        }
        let (_, _, _, local) =
            self.team_local_changes(domain, self.reflection_mode(domain).await?)?;
        Ok(local
            .substantive()
            .map(|change| PathChecksum {
                path: change.path().to_string(),
                checksum: match change {
                    crystalline_remote::changes::LocalChange::Added { sha256, .. }
                    | crystalline_remote::changes::LocalChange::Modified { sha256, .. } => {
                        sha256.clone()
                    }
                    crystalline_remote::changes::LocalChange::Deleted { .. } => String::new(),
                },
            })
            .collect())
    }
}

/// The refusal of a renew, a record or a share whose token no longer holds
/// the lease.
fn lease_lost(lp: Loop, domain: &str) -> EngineError {
    EngineError::Refused(format!(
        "lease is not held: this run's {lp} lease of '{domain}' expired or another run took it"
    ))
}
