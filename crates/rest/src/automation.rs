//! What the reflect and evolve loops did on a domain, for the pages that
//! show it. A read, with the session cookie: the tokens a runner works with
//! stay off this API, but a person looking at Fluid needs to see when each
//! loop last ran, what it left for them and whether its webhook works.
//!
//! The engine answers ([`crate::engine::Engine::automation_overview`]); this
//! only gives its entries a typed shape. Nothing is computed here. A run
//! carries counts only, never the items it left, which are keyed by page
//! paths.

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use super::auth::Identity;
use super::{ApiError, ApiPath, ProblemDetail, RestState};

/// One recorded run of a loop.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoopRun {
    /// When the run started, RFC 3339.
    #[schema(example = "2026-10-21T09:00:00+00:00")]
    pub started_at: String,
    /// When the run ended, RFC 3339.
    #[schema(example = "2026-10-21T09:04:00+00:00")]
    pub ended_at: String,
    /// The runner's label.
    #[schema(example = "n8n")]
    pub runner: String,
    /// The account the run worked as, when it had one.
    #[schema(example = "robot")]
    pub account: Option<String>,
    /// `done`, `stopped_at_cap`, `failed`, `nothing_due` or `expired`.
    #[schema(example = "done")]
    pub outcome: String,
    /// Items done.
    #[schema(example = 4)]
    pub done: u64,
    /// Items the run left for a person.
    #[schema(example = 3)]
    pub left: u64,
    /// Judgment findings waiting when the run ended (evolve).
    #[schema(example = 2)]
    pub judgment_waiting: u64,
    /// A short summary the runner wrote.
    pub summary: String,
    /// The pull request the run shared its changes in, when it shared.
    pub pr_url: Option<String>,
}

/// What a loop's trigger webhook last did on a domain.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoopDelivery {
    /// Whether this instance has a webhook URL and a secret to sign with.
    pub configured: bool,
    /// When the receiver last took a webhook, RFC 3339.
    pub last_sent: Option<String>,
    /// Why the last delivery failed; cleared by the next one that works.
    pub last_error: Option<String>,
}

/// A runner holding the loop's lease right now.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoopRunning {
    /// The runner's label.
    pub runner: String,
    /// When the run took the lease, RFC 3339.
    pub taken_at: String,
}

/// One loop on one domain.
#[derive(Debug, Serialize, ToSchema)]
pub struct LoopState {
    /// The last recorded run; `null` when the loop never ran here.
    pub last_run: Option<LoopRun>,
    /// The runner working now; `null` when none is.
    pub running: Option<LoopRunning>,
    /// Items a finished run left for a person that have not changed since.
    /// Zero when the caller may not run the loop.
    #[schema(example = 3)]
    pub left_for_person: u64,
    /// Judgment findings waiting for a person (evolve); zero for reflect and
    /// for a caller who may not run the loop.
    #[schema(example = 2)]
    pub judgment_waiting: u64,
    /// The trigger webhook; `null` unless the MANIFEST turns the loop's
    /// trigger on.
    pub delivery: Option<LoopDelivery>,
}

/// What `GET /domains/{domain}/automation` answers.
#[derive(Debug, Serialize, ToSchema)]
pub struct AutomationResponse {
    /// The reflect loop.
    pub reflect: LoopState,
    /// The evolve loop.
    pub evolve: LoopState,
}

fn field<T: serde::de::DeserializeOwned>(entry: &Value, key: &str) -> Option<T> {
    entry
        .get(key)
        .filter(|v| !v.is_null())
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}

fn state(entry: &Value) -> LoopState {
    LoopState {
        last_run: field(entry, "last_run"),
        running: field(entry, "running"),
        left_for_person: entry
            .get("left_for_person")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        judgment_waiting: entry
            .pointer("/counts/judgment")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        delivery: field(entry, "delivery"),
    }
}

/// `GET /domains/{domain}/automation`
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/automation",
    tag = "domains",
    operation_id = "read_automation",
    summary = "When the reflect and evolve loops last ran on this domain.",
    description = "For each loop: the last recorded run (counts and a short \
                   summary, never the items it left), the runner working now, \
                   how many items wait for a person and, where the MANIFEST \
                   turns the loop's webhook trigger on, whether the last \
                   webhook was taken. Reading needs only the right to read \
                   the domain. A caller who may not run a loop sees its last \
                   run and delivery with nothing counted.",
    params(("domain" = String, Path, description = "The domain.")),
    responses(
        (status = 200, description = "Both loops on this domain.", body = AutomationResponse),
        (
            status = 404,
            description = "No such domain, or none this caller may see.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn read(
    State(state_): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
) -> Result<Json<AutomationResponse>, ApiError> {
    let overview = state_
        .engine
        .automation_overview(&domain, &identity.scope())
        .await?;
    Ok(Json(AutomationResponse {
        reflect: state(&overview["reflect"]),
        evolve: state(&overview["evolve"]),
    }))
}
