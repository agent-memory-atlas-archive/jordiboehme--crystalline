//! The Reflection: the routes Fluid's Reflection mode and review screen
//! read and write. Every verb is the engine's; this module builds the caller,
//! maps the four "not here" states to 409 and passes the engine's JSON
//! through unchanged, so the MCP tools and this surface describe one thing.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use utoipa::{IntoParams, ToSchema};

use super::auth::Identity;
use super::{ApiError, ApiJson, ApiPath, ApiQuery, ProblemDetail, RestState, refuse_read_only};
use crate::engine::{
    ANONYMOUS_COMMENT, EngineError, REFUSED_ELSEWHERE_START, REFUSED_HOMELESS, REFUSED_OFF_START,
    REFUSED_PENDING, REFUSED_PENDING_NAMED,
};
use crate::params::{DiscussParams, WriteReflectionParams};
use crate::scope::ReflectionCaller;

/// The person behind a request, as a reflection verb sees them.
fn caller(identity: &Identity) -> ReflectionCaller {
    let name = identity
        .user
        .as_ref()
        .map(|u| u.name.clone())
        .unwrap_or_else(|| "anonymous".to_string());
    ReflectionCaller::person(identity.scope(), &name)
}

/// The anonymous viewer's answer to a page write (save, move, delete).
const ANONYMOUS_EDIT: &str =
    "anonymous visitors read this Reflection and cannot change it; sign in to edit";

/// Refuse a reflection write by the anonymous viewer, before the engine
/// reads anything else of the request. Where it may not read the domain it
/// learns nothing: the domain answers the 404 an unregistered name answers,
/// on every route. Where it reads the Reflection (a public domain), the
/// answer is 401 with `sentence`, since signing in is what fixes it, and it
/// comes whatever the Reflection's state, the answer every other write on
/// this surface gives the anonymous tier.
async fn refuse_anonymous(
    state: &RestState,
    identity: &Identity,
    domain: &str,
    sentence: &str,
) -> Result<(), ApiError> {
    if identity.user.is_some() {
        return Ok(());
    }
    state
        .engine
        .reflection_status(domain, &caller(identity))
        .await
        .map_err(reflection_error)?;
    Err(ApiError::unauthorized(sentence))
}

/// Engine errors as this surface answers them: the four Reflection states a
/// verb refuses on are 409 (the request is fine, the Reflection is not where
/// it could serve it), with `home_url` when it lives elsewhere; a stale
/// checksum, a create over an existing page and a move or delete of a page
/// somebody is editing are 409 (the shared mapping answers every other
/// `Conflict` 422); everything else keeps the shared mapping.
fn reflection_error(e: EngineError) -> ApiError {
    match &e {
        EngineError::Refused(text) if text.starts_with(REFUSED_ELSEWHERE_START) => {
            let url = text[REFUSED_ELSEWHERE_START.len()..].to_string();
            ApiError::conflict(text.clone()).home_url(url)
        }
        EngineError::Refused(text)
            if text.starts_with(REFUSED_OFF_START)
                || text.contains(REFUSED_PENDING_NAMED)
                || text.contains(REFUSED_PENDING)
                || text == REFUSED_HOMELESS =>
        {
            ApiError::conflict(text.clone())
        }
        // The anonymous visitor of a public domain reads and never comments:
        // logging in is what fixes it, so 401 like every other anonymous write.
        EngineError::Forbidden(text) if text == ANONYMOUS_COMMENT => {
            ApiError::unauthorized(text.clone())
        }
        EngineError::Conflict(text)
            if text.starts_with("stale edit")
                || text.starts_with("a reflection already lives at")
                || text.starts_with("somebody is editing") =>
        {
            ApiError::conflict(text.clone())
        }
        _ => ApiError::from(e),
    }
}

/// `GET /reflection/domains` - the domains whose Reflection this caller
/// reaches, including the ones it cannot see as engrams.
#[utoipa::path(
    get,
    path = "/api/v1/reflection/domains",
    tag = "reflection",
    operation_id = "list_reflection_domains",
    summary = "The domains whose Reflection this caller reaches.",
    description = "Every registered domain whose Reflection is not off and \
                   where the caller's reflection right is at least `read`, \
                   including domains the caller cannot see as engrams \
                   (knowledge `none` with a Reflection level): this is how \
                   Fluid finds them, since `GET /domains` leaves them out. \
                   The anonymous viewer gets the public domains, at `read`. \
                   Sorted by name.",
    responses(
        (
            status = 200,
            description = "ReflectionDomains: `{ domains: [{ domain, state, right, \
                           engrams_visible, home, home_url, open_threads }] }`. \
                           `state` is `on`, `pending`, `homeless` or `elsewhere`; \
                           `home` is `here`, `local`, `elsewhere` (then \
                           `home_url` is set) or `null` (`pending`, \
                           `homeless`); `open_threads` is 0 unless `state` is \
                           `on`.",
            body = Object,
            example = json!({ "domains": [ { "domain": "eng", "state": "on",
                "right": "edit", "engrams_visible": false, "home": "here",
                "home_url": null, "open_threads": 3 } ] }),
        ),
    ),
)]
pub async fn domains(
    State(state): State<RestState>,
    identity: Identity,
) -> Result<Json<Value>, ApiError> {
    let caller = caller(&identity);
    let mut out = Vec::new();
    let mut names: Vec<String> = state.engine.registered_domain_names().into_iter().collect();
    names.sort();
    for name in names {
        // A domain this caller may not see is left out; any other failure is
        // the store's and is answered, not hidden.
        let status = match state.engine.reflection_status(&name, &caller).await {
            Ok(status) => status,
            Err(EngineError::UnknownDomain { .. } | EngineError::NotFound(_)) => continue,
            Err(e) => return Err(reflection_error(e)),
        };
        if status["state"] == "off" || status["right"] == "none" {
            continue;
        }
        let open = if status["state"] == "on" {
            state
                .engine
                .list_reflection_threads(&name, None, "open", &caller)
                .await
                .map(|v| v["threads"].as_array().map(Vec::len).unwrap_or(0))
                .unwrap_or(0)
        } else {
            0
        };
        out.push(json!({
            "domain": name,
            "state": status["state"],
            "right": status["right"],
            "engrams_visible": status["engrams_visible"],
            "home": status["home"],
            "home_url": status["home_url"],
            "open_threads": open,
        }));
    }
    Ok(Json(json!({ "domains": out })))
}

/// `GET /domains/{domain}/reflection` - the Reflection's status for this
/// caller; never a 409, since this is how Fluid learns off, pending and
/// elsewhere.
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/reflection",
    tag = "reflection",
    operation_id = "get_reflection_status",
    summary = "The Reflection's status for this caller.",
    params(("domain" = String, Path, description = "The domain.")),
    responses(
        (
            status = 200,
            description = "ReflectionStatus. `state` is `off`, `pending` (then \
                           `pending_engrams` lists the engrams still under \
                           `reflections/` for a caller with `engrams_visible`, \
                           and is empty for anyone else), `homeless`, `on` or \
                           `elsewhere` (then `home_url` is set). `member` is \
                           true when the caller holds a membership row it may \
                           leave.",
            body = Object,
            example = json!({ "domain": "eng", "enabled": true, "state": "on",
                "home": "here", "home_url": null, "right": "curate",
                "engrams_visible": true, "member": false, "pending_engrams": [] }),
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn status(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
) -> Result<Json<Value>, ApiError> {
    let mut answer = state
        .engine
        .reflection_status(&domain, &caller(&identity))
        .await
        .map_err(reflection_error)?;
    // Whether the caller holds a membership row it may leave (Fluid G5). Read
    // here, not in the engine: it is an accounts question, and only this
    // surface offers leaving.
    let member = match &identity.user {
        Some(user) => state
            .auth
            .domain_members(&domain)
            .await
            .map_err(|e| ApiError::internal(format!("listing this domain's members: {e:#}")))?
            .iter()
            .any(|m| m.principal == user.name),
        None => false,
    };
    answer["member"] = Value::Bool(member);
    Ok(Json(answer))
}

/// `GET /domains/{domain}/reflection/tree`
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/reflection/tree",
    tag = "reflection",
    operation_id = "get_reflection_tree",
    summary = "The Reflection's folders and reflections.",
    params(("domain" = String, Path, description = "The domain.")),
    responses(
        (
            status = 200,
            description = "ReflectionTree: folders first, then reflections, each \
                           level sorted by name in byte order. `PACT.md` is only \
                           under `pact`, never in `nodes`.",
            body = Object,
            example = json!({ "domain": "eng",
                "pact": { "path": "PACT.md", "title": "How we write about eng",
                          "exists": true, "open_threads": 0 },
                "nodes": [ { "kind": "folder", "name": "guides", "path": "guides",
                    "children": [ { "kind": "reflection", "name": "deploying.md",
                        "path": "guides/deploying.md", "title": "Deploying",
                        "open_threads": 2, "sections": 4 } ] } ] }),
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is off, pending, homeless or lives \
                           elsewhere (then the `home_url` member names where).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn tree(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .engine
        .read_reflection_tree(&domain, &caller(&identity))
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// `GET /domains/{domain}/reflections/{*path}`
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/reflections/{path}",
    tag = "reflection",
    operation_id = "get_reflection",
    summary = "One reflection, or PACT.md.",
    params(
        ("domain" = String, Path, description = "The domain."),
        ("path" = String, Path, description = "The reflection's path inside \
                                               reflections/; may contain slashes."),
    ),
    responses(
        (
            status = 200,
            description = "ReflectionDoc. `markdown` is the whole file for a \
                           caller with `engrams_visible`, and the file without \
                           its `reflection:` frontmatter block for anyone else; \
                           `sections` (and their one-based `line`) are computed \
                           over the `markdown` answered; `checksum` is always the \
                           stored file's. `sections[].sources` is absent, not \
                           empty, without `engrams_visible`. `threads` holds the \
                           open threads; `live` is present while a co-editing \
                           room is open.",
            body = Object,
            example = json!({ "domain": "eng", "path": "guides/deploying.md",
                "title": "Deploying", "markdown": "# Deploying\n...",
                "checksum": "9f2c...", "sections": [ { "id": "7f3a9c2e",
                    "heading": "Night deploys", "line": 12, "changed": true,
                    "sources": [ { "permalink": "runbooks/deploy",
                        "title": "Deploy runbook", "state": "current" } ] } ],
                "threads": [] }),
        ),
        (
            status = 404,
            description = "No such domain or reflection, or none this caller may see.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is not here (off, pending, homeless or \
                           elsewhere, then with `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn read(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath((domain, path)): ApiPath<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    state
        .engine
        .read_reflection(&domain, &path, &caller(&identity))
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// What `PUT /domains/{domain}/reflections/{*path}` takes.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveReflectionBody {
    /// The whole reflection. A body without the `<!-- r:... -->` id lines
    /// keeps them: a heading that matches a stored section gets its id back.
    /// Below curate, the stored `reflection:` block stays whatever this
    /// carries.
    pub markdown: String,
    /// The checksum `GET` answered; a reflection that changed since is 409.
    #[serde(default)]
    pub expected_checksum: Option<String>,
    /// Only create: refuse with 409 when a reflection already lives at this
    /// path, and leave it untouched. Default false: create or replace.
    #[serde(default)]
    pub create: bool,
}

/// `PUT /domains/{domain}/reflections/{*path}`
#[utoipa::path(
    put,
    path = "/api/v1/domains/{domain}/reflections/{path}",
    tag = "reflection",
    operation_id = "save_reflection",
    summary = "Create or replace a reflection, or PACT.md.",
    description = "Needs `edit`; `PACT.md` needs `curate`. While a co-editing \
                   room is open over the reflection the write composes into \
                   the room, and the answer carries `landed: live` and \
                   `present`.",
    params(
        ("domain" = String, Path, description = "The domain."),
        ("path" = String, Path, description = "The reflection's path inside \
                                               reflections/; may contain slashes."),
    ),
    request_body = SaveReflectionBody,
    responses(
        (
            status = 200,
            description = "Written: `{ domain, path, checksum, created, \
                           ids_assigned, curated }`. `curated` says whether \
                           this write advanced the baseline.",
            body = Object,
            example = json!({ "domain": "eng", "path": "guides/deploying.md",
                "checksum": "9f2c...", "created": false,
                "ids_assigned": ["7f3a9c2e"], "curated": false }),
        ),
        (
            status = 401,
            description = "The anonymous viewer of a domain it reads: it reads \
                           the Reflection and never changes it.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 403,
            description = "Below edit access (curate for PACT.md), with a detail \
                           naming the right held and the right needed; the \
                           domain is off the caller's write list; or this \
                           instance is read-only.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "A stale `expected_checksum` (detail starting \"stale \
                           edit\"), a create over an existing page, or the \
                           Reflection is not here (then possibly `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 422,
            description = "A bad path or body.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn save(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath((domain, path)): ApiPath<(String, String)>,
    ApiJson(body): ApiJson<SaveReflectionBody>,
) -> Result<Json<Value>, ApiError> {
    refuse_anonymous(&state, &identity, &domain, ANONYMOUS_EDIT).await?;
    refuse_read_only(&state)?;
    let p = WriteReflectionParams {
        domain,
        path,
        markdown: Some(body.markdown),
        expected_checksum: body.expected_checksum,
        create_only: body.create,
        ..Default::default()
    };
    state
        .engine
        .write_reflection(&p, &caller(&identity))
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// `DELETE /domains/{domain}/reflections/{*path}`
#[utoipa::path(
    delete,
    path = "/api/v1/domains/{domain}/reflections/{path}",
    tag = "reflection",
    operation_id = "delete_reflection",
    summary = "Delete a reflection with its threads and baseline.",
    params(
        ("domain" = String, Path, description = "The domain."),
        ("path" = String, Path, description = "The reflection's path inside \
                                               reflections/; may contain slashes."),
    ),
    responses(
        (status = 204, description = "Deleted with its threads and baseline."),
        (
            status = 401,
            description = "The anonymous viewer of a domain it reads: it reads \
                           the Reflection and never changes it.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 403,
            description = "Below edit access, or this instance is read-only.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "Somebody is editing it, or the Reflection is not here.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 422,
            description = "A bad path, or `PACT.md`, which is edited and never deleted.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn remove(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath((domain, path)): ApiPath<(String, String)>,
) -> Result<StatusCode, ApiError> {
    refuse_anonymous(&state, &identity, &domain, ANONYMOUS_EDIT).await?;
    refuse_read_only(&state)?;
    state
        .engine
        .delete_reflection(&domain, &path, &caller(&identity))
        .await
        .map_err(reflection_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// What `POST /domains/{domain}/reflection/move` takes.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MoveReflectionBody {
    /// The reflection's current path inside reflections/.
    pub from: String,
    /// Its new path inside reflections/.
    pub to: String,
}

/// `POST /domains/{domain}/reflection/move`
#[utoipa::path(
    post,
    path = "/api/v1/domains/{domain}/reflection/move",
    tag = "reflection",
    operation_id = "move_reflection",
    summary = "Move a reflection with its threads and baseline.",
    params(("domain" = String, Path, description = "The domain.")),
    request_body = MoveReflectionBody,
    responses(
        (
            status = 200,
            description = "Moved with its threads and baseline; links to it \
                           rewritten: `{ from, to, links_rewritten, threads_moved }`.",
            body = Object,
            example = json!({ "from": "guides/a.md", "to": "howto/a.md",
                "links_rewritten": 2, "threads_moved": true }),
        ),
        (
            status = 401,
            description = "The anonymous viewer of a domain it reads: it reads \
                           the Reflection and never changes it.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 403,
            description = "Below edit access, or this instance is read-only.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "Somebody is editing it, or the Reflection is not here.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 422,
            description = "A bad path, or `PACT.md`, which is edited and never moved.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn move_to(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
    ApiJson(body): ApiJson<MoveReflectionBody>,
) -> Result<Json<Value>, ApiError> {
    refuse_anonymous(&state, &identity, &domain, ANONYMOUS_EDIT).await?;
    refuse_read_only(&state)?;
    state
        .engine
        .move_reflection(&domain, &body.from, &body.to, &caller(&identity))
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// The query of `GET /domains/{domain}/reflection/threads`.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ThreadsQuery {
    /// open (default), resolved or all.
    #[serde(default)]
    status: Option<String>,
    /// Only this reflection's threads.
    #[serde(default)]
    path: Option<String>,
}

/// `GET /domains/{domain}/reflection/threads`
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/reflection/threads",
    tag = "reflection",
    operation_id = "list_reflection_threads",
    summary = "The Reflection's threads, oldest first.",
    params(("domain" = String, Path, description = "The domain."), ThreadsQuery),
    responses(
        (
            status = 200,
            description = "`{ threads: [ThreadView] }`, oldest first. A thread's \
                           `anchor.section` is the section's id, or its heading \
                           text for a heading with no id yet; `anchor.state` is \
                           `found`, `text_changed` or `section_gone`; \
                           `waiting_on` is `agent` when the last entry is a \
                           person's and `people` when it is an agent's; \
                           `age_secs` counts from the last entry.",
            body = Object,
            example = json!({ "threads": [ { "id": "t-3f9a2c1b",
                "path": "guides/deploying.md",
                "anchor": { "section": "7f3a9c2e", "quote": "Deploys run at night",
                            "occurrence": 1, "state": "found" },
                "status": "open", "waiting_on": "agent",
                "opened_at": "2026-09-30T10:00:00Z", "age_secs": 3600,
                "entries": [ { "at": "2026-09-30T10:00:00Z", "kind": "comment",
                    "author": { "name": "jordi", "agent": false },
                    "text": "Still at night?" } ] } ] }),
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is not here (then possibly `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn threads(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
    ApiQuery(q): ApiQuery<ThreadsQuery>,
) -> Result<Json<Value>, ApiError> {
    state
        .engine
        .list_reflection_threads(
            &domain,
            q.path.as_deref(),
            q.status.as_deref().unwrap_or("open"),
            &caller(&identity),
        )
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// What `POST /domains/{domain}/reflection/threads` takes.
#[derive(Debug, Deserialize, ToSchema)]
pub struct OpenThreadBody {
    /// The reflection, its path inside reflections/.
    pub path: String,
    /// The section the thread is about: its id, or its heading text.
    pub section: String,
    /// The exact passage, when the thread is about one.
    #[serde(default)]
    pub quote: Option<String>,
    /// Which occurrence of the quote, from 1.
    #[serde(default)]
    pub occurrence: Option<u32>,
    /// The first entry.
    pub text: String,
}

/// `POST /domains/{domain}/reflection/threads`
#[utoipa::path(
    post,
    path = "/api/v1/domains/{domain}/reflection/threads",
    tag = "reflection",
    operation_id = "open_reflection_thread",
    summary = "Open a thread on a reflection's section.",
    description = "Reading and commenting are one level: `read` is enough. \
                   The anonymous viewer reads threads and never writes one.",
    params(("domain" = String, Path, description = "The domain.")),
    request_body = OpenThreadBody,
    responses(
        (
            status = 201,
            description = "The new thread as a ThreadView; its `anchor.section` \
                           is the section's id, or its heading text for a \
                           heading with no id yet.",
            body = Object,
            example = json!({ "id": "t-3f9a2c1b", "path": "guides/deploying.md",
                "anchor": { "section": "7f3a9c2e", "quote": "at night",
                            "occurrence": 1, "state": "found" },
                "status": "open", "waiting_on": "agent",
                "opened_at": "2026-09-30T10:00:00Z", "age_secs": 0,
                "entries": [ { "at": "2026-09-30T10:00:00Z", "kind": "comment",
                    "author": { "name": "jordi", "agent": false },
                    "text": "Still at night?" } ] }),
        ),
        (
            status = 401,
            description = "The anonymous viewer of a domain it reads: a comment \
                           needs somebody to sign it.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 403,
            description = "This instance is read-only.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is not here (then possibly `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 422,
            description = "An unknown section, a quote the section does not hold, \
                           or an empty text.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn open(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
    ApiJson(body): ApiJson<OpenThreadBody>,
) -> Result<Response, ApiError> {
    refuse_anonymous(&state, &identity, &domain, ANONYMOUS_COMMENT).await?;
    refuse_read_only(&state)?;
    let p = DiscussParams {
        domain,
        action: Some("open".into()),
        path: Some(body.path),
        section: Some(body.section),
        quote: body.quote,
        occurrence: body.occurrence,
        text: Some(body.text),
        ..Default::default()
    };
    let view = state
        .engine
        .discuss(&p, &caller(&identity))
        .await
        .map_err(reflection_error)?;
    Ok((StatusCode::CREATED, Json(view)).into_response())
}

/// What the three thread actions take.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ThreadStepBody {
    /// The reflection the thread is on.
    pub path: String,
    /// answer: the text, required; reopen: optional.
    #[serde(default)]
    pub text: Option<String>,
    /// resolve: the short outcome, required.
    #[serde(default)]
    pub outcome: Option<String>,
}

/// `POST /domains/{domain}/reflection/threads/{id}/{action}` for answer,
/// resolve and reopen: one handler, the action from the path.
#[utoipa::path(
    post,
    path = "/api/v1/domains/{domain}/reflection/threads/{id}/{action}",
    tag = "reflection",
    operation_id = "step_reflection_thread",
    summary = "Answer, resolve or reopen a thread.",
    params(
        ("domain" = String, Path, description = "The domain."),
        ("id" = String, Path, description = "The thread id (t-...)."),
        ("action" = String, Path, description = "answer, resolve or reopen; any \
                                                 other answers 404."),
    ),
    request_body = ThreadStepBody,
    responses(
        (
            status = 200,
            description = "The thread as a ThreadView after the step; its \
                           `anchor.section` is the section's id, or its heading \
                           text for a heading with no id yet.",
            body = Object,
            example = json!({ "id": "t-3f9a2c1b", "path": "guides/deploying.md",
                "anchor": { "section": "7f3a9c2e", "quote": "at night",
                            "occurrence": 1, "state": "found" },
                "status": "resolved", "waiting_on": "agent",
                "opened_at": "2026-09-30T10:00:00Z", "age_secs": 0,
                "entries": [ { "at": "2026-09-30T10:00:00Z", "kind": "comment",
                    "author": { "name": "jordi", "agent": false },
                    "text": "Still at night?" },
                    { "at": "2026-09-30T11:00:00Z", "kind": "resolve",
                    "author": { "name": "vera", "agent": false },
                    "text": "Yes." } ] }),
        ),
        (
            status = 401,
            description = "The anonymous viewer of a domain it reads: an entry \
                           needs somebody to sign it.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 403,
            description = "This instance is read-only.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 404,
            description = "No such thread, or an action other than answer, \
                           resolve or reopen.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is not here (then possibly `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 422,
            description = "An answer with no text, or a resolve with no outcome \
                           (an empty one included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn step(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath((domain, id, action)): ApiPath<(String, String, String)>,
    ApiJson(body): ApiJson<ThreadStepBody>,
) -> Result<Json<Value>, ApiError> {
    refuse_anonymous(&state, &identity, &domain, ANONYMOUS_COMMENT).await?;
    refuse_read_only(&state)?;
    use crystalline_core::threads::EntryKind;
    let (kind, text) = match action.as_str() {
        "answer" => (EntryKind::Comment, body.text.unwrap_or_default()),
        "resolve" => (
            EntryKind::Resolve,
            body.outcome.or(body.text).unwrap_or_default(),
        ),
        "reopen" => (EntryKind::Reopen, body.text.unwrap_or_default()),
        other => {
            return Err(ApiError::not_found(format!(
                "no thread action '{other}'; use answer, resolve or reopen"
            )));
        }
    };
    state
        .engine
        .reflection_thread_entry(&domain, &body.path, &id, kind, &text, &caller(&identity))
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// The query of the queue route.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct QueueQuery {
    /// Page size, default 10, at most 100.
    #[serde(default)]
    limit: Option<usize>,
    /// One-based page.
    #[serde(default)]
    page: Option<usize>,
}

/// `GET /domains/{domain}/reflection/queue` - read-only: never records a run.
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/reflection/queue",
    tag = "reflection",
    operation_id = "get_reflect_queue",
    summary = "What the domain's Reflection needs next. Read-only.",
    description = "The same detection the MCP `reflect` tool runs, and nothing \
                   recorded: opening the review screen never counts as a run.",
    params(("domain" = String, Path, description = "The domain."), QueueQuery),
    responses(
        (
            status = 200,
            description = "ReflectQueue. `kind` is `feedback` (`what`: `new`, \
                           `changed`, `removed`), `update` (`source_changed`, \
                           `source_retired`, `source_missing`, `unreflected`, \
                           `off_structure`, `pact_changed`) or `review` \
                           (`thread`). `sources`, and an `unreflected` item's \
                           `folder` and `engrams`, are absent for a caller who \
                           cannot read engrams. The MCP `reflect` tool answers \
                           the same shape with `scope: { domains, kinds }` in \
                           place of `domain` and a `domain` member on each row; \
                           its `scope` may carry `unreadable`, the names of the \
                           domains whose queue could not be read.",
            body = Object,
            example = json!({ "domain": "eng", "total": 1, "page": 1, "limit": 10,
                "count": 1, "kinds": { "feedback": 0, "update": 1, "review": 0 },
                "queue": [ { "n": 1, "kind": "update", "what": "source_changed",
                    "path": "guides/deploying.md", "section": "7f3a9c2e",
                    "heading": "Night deploys", "age_secs": 3600,
                    "sources": [ { "permalink": "runbooks/deploy",
                                   "state": "changed" } ] } ],
                "guidance": "..." }),
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is not here (then possibly `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn queue(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
    ApiQuery(q): ApiQuery<QueueQuery>,
) -> Result<Json<Value>, ApiError> {
    state
        .engine
        .reflect_queue(&domain, q.limit, q.page, &caller(&identity))
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// `GET /domains/{domain}/reflection/review`
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/reflection/review",
    tag = "reflection",
    operation_id = "get_reflection_review",
    summary = "The review screen: open threads by who they wait on, and the queue.",
    params(("domain" = String, Path, description = "The domain.")),
    responses(
        (
            status = 200,
            description = "ReflectionReview: open threads only, grouped by \
                           reflection, groups and threads oldest first; \
                           `queue` is the ReflectQueue's page 1 at `limit` 50.",
            body = Object,
            example = json!({ "domain": "eng",
                "waiting_for_people": [],
                "waiting_for_the_agent": [ { "path": "guides/deploying.md",
                    "title": "Deploying", "threads": [] } ],
                "queue": { "domain": "eng", "total": 0, "page": 1, "limit": 50,
                    "count": 0, "kinds": { "feedback": 0, "update": 0, "review": 0 },
                    "queue": [], "guidance": "..." } }),
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is not here (then possibly `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn review(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .engine
        .reflection_review(&domain, &caller(&identity))
        .await
        .map(Json)
        .map_err(reflection_error)
}

/// The query of the search route.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SearchQuery {
    /// The words to find. Required; a missing or empty `q` answers 422.
    #[serde(default)]
    q: Option<String>,
    /// At most this many hits, default 20, at most 100.
    #[serde(default)]
    limit: Option<usize>,
}

/// `GET /domains/{domain}/reflection/search`
#[utoipa::path(
    get,
    path = "/api/v1/domains/{domain}/reflection/search",
    tag = "reflection",
    operation_id = "search_reflections",
    summary = "Text search over the domain's reflections.",
    description = "A hit is one section. A reflection's `reflection:` \
                   frontmatter block is taken off before it is searched, for \
                   every caller, so no hit or snippet comes out of it.",
    params(("domain" = String, Path, description = "The domain."), SearchQuery),
    responses(
        (
            status = 200,
            description = "`{ query, hits: [{ path, title, section, heading, \
                           snippet }] }`, best first. `section` is the section \
                           id, `_top` for the text before the first heading, or \
                           `null` for a heading with no id yet.",
            body = Object,
            example = json!({ "query": "night", "hits": [ {
                "path": "guides/deploying.md", "title": "Deploying",
                "section": "7f3a9c2e", "heading": "Night deploys",
                "snippet": "Deploys run at night." } ] }),
        ),
        (
            status = 404,
            description = "No such domain, or none this caller may see (the \
                           anonymous viewer included).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 409,
            description = "The Reflection is not here (then possibly `home_url`).",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
        (
            status = 422,
            description = "A missing or empty `q`.",
            body = ProblemDetail,
            content_type = "application/problem+json",
        ),
    ),
)]
pub async fn search(
    State(state): State<RestState>,
    identity: Identity,
    ApiPath(domain): ApiPath<String>,
    ApiQuery(q): ApiQuery<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    let Some(words) = q.q.as_deref().map(str::trim).filter(|w| !w.is_empty()) else {
        return Err(ApiError::unprocessable(
            "search needs `q`, the words to find",
        ));
    };
    state
        .engine
        .search_reflection_text(
            &domain,
            words,
            q.limit.unwrap_or(20).clamp(1, 100),
            &caller(&identity),
        )
        .await
        .map(Json)
        .map_err(reflection_error)
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    /// The four "not here" states are 409, and only the elsewhere one names
    /// the home.
    #[test]
    fn the_reflection_states_are_conflicts_and_elsewhere_names_its_home() {
        let elsewhere = reflection_error(EngineError::Refused(format!(
            "{REFUSED_ELSEWHERE_START}https://team.example.com"
        )));
        assert_eq!(elsewhere.status, StatusCode::CONFLICT);
        assert_eq!(
            elsewhere.home_url.as_deref(),
            Some("https://team.example.com")
        );
        for text in [
            format!("{REFUSED_OFF_START}'eng'; its owner switches it on in the domain policies"),
            format!("Reflection for 'eng' {REFUSED_PENDING_NAMED}: a"),
            format!("Reflection for 'eng' {REFUSED_PENDING}"),
            REFUSED_HOMELESS.to_string(),
        ] {
            let e = reflection_error(EngineError::Refused(text.clone()));
            assert_eq!(e.status, StatusCode::CONFLICT, "{text}");
            assert!(e.home_url.is_none(), "{text}");
        }
        // Any other refusal keeps the shared mapping.
        let other = reflection_error(EngineError::Refused("PACT.md is the domain's".into()));
        assert_eq!(other.status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    /// The anonymous comment refusal is a 401: signing in fixes it. Every
    /// other `Forbidden` stays 403.
    #[test]
    fn an_anonymous_comment_is_told_to_sign_in() {
        let e = reflection_error(EngineError::Forbidden(ANONYMOUS_COMMENT.into()));
        assert_eq!(e.status, StatusCode::UNAUTHORIZED);
        let e = reflection_error(EngineError::Forbidden(
            "your access to the Reflection of 'eng' is read, and edit is needed".into(),
        ));
        assert_eq!(e.status, StatusCode::FORBIDDEN);
    }

    /// A stale edit, a create over a page and a busy page are 409; any other
    /// conflict keeps the shared 422.
    #[test]
    fn the_three_reflection_conflicts_are_409() {
        for text in [
            "stale edit: the reflection changed since it was read",
            "a reflection already lives at 'guides/deploying.md'",
            "somebody is editing 'guides/deploying.md'",
        ] {
            let e = reflection_error(EngineError::Conflict(text.into()));
            assert_eq!(e.status, StatusCode::CONFLICT, "{text}");
        }
        let other = reflection_error(EngineError::Conflict("something else".into()));
        assert_eq!(other.status, StatusCode::UNPROCESSABLE_ENTITY);
    }
}
