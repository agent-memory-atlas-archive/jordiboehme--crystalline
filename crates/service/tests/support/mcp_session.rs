//! The server half of an in-memory MCP connection, and the one moment it may
//! be waited on.
//!
//! `rmcp::serve_server` returns once rmcp has chosen a lifecycle: on
//! `initialize`, or on the first complete modern request (one whose `_meta`
//! carries both required keys and names a revision this server serves). Since
//! rmcp 3.5.1 (#1248) a `server/discover` chooses none: rmcp answers it from
//! its start-up loop and keeps waiting for either lifecycle, and it does the
//! same for a `ping` and for a request it refuses there. A harness that opened
//! with discover and then awaited the server task therefore waited forever.
//!
//! A **notification** (or a response) in that window is not neutral: the
//! start-up loop accepts only requests, so it ends the session with
//! `ExpectedInitializeRequest`. Under rmcp 3.5.0 the discover had already
//! chosen the modern lifecycle and such a notification was served.
//!
//! [`ServedSession`] holds that task and is waited on only after a message
//! that chooses the lifecycle was answered. [`chooses_lifecycle`] names those
//! messages for the harnesses that write JSON-RPC lines by hand.

use std::time::Duration;

use crystalline_service::mcp::SERVED_PROTOCOL_VERSIONS;
use rmcp::service::{RoleServer, RunningService, ServerInitializeError, Service};
use serde_json::Value;
use tokio::io::DuplexStream;
use tokio::task::JoinHandle;

/// How long [`ServedSession::started`] waits for rmcp once a message that
/// chooses the lifecycle was answered. rmcp returns before it dispatches that
/// message, so the task is done long before its answer arrives; the bound only
/// turns a harness mistake into a failure instead of a hang.
const START_TIMEOUT: Duration = Duration::from_secs(5);

type InitTask<S> = JoinHandle<Result<RunningService<RoleServer, S>, ServerInitializeError>>;

/// One `rmcp::serve_server` run over an in-memory transport.
///
/// Keep it alive for the whole conversation: dropping it ends the session (a
/// start-up loop that is still waiting is aborted, a running service is
/// cancelled).
pub struct ServedSession<S: Service<RoleServer>> {
    task: Option<InitTask<S>>,
    running: Option<RunningService<RoleServer, S>>,
}

impl<S: Service<RoleServer>> ServedSession<S> {
    /// Serve `server` over `io` on a task of its own.
    pub fn spawn(server: S, io: DuplexStream) -> Self {
        let task = tokio::spawn(async move { rmcp::serve_server(server, io).await });
        Self {
            task: Some(task),
            running: None,
        }
    }

    /// Whether the harness has collected the running service yet. This is
    /// the harness's own state; ask [`Self::rmcp_returned`] what rmcp did.
    pub fn is_started(&self) -> bool {
        self.running.is_some()
    }

    /// Whether `rmcp::serve_server` has returned, that is, whether rmcp has
    /// left its start-up loop (with a running session or with an error).
    /// rmcp returns before it dispatches the message that chose the lifecycle,
    /// so once that message's answer was read this is reliable.
    pub fn rmcp_returned(&self) -> bool {
        self.running.is_some() || self.task.as_ref().is_some_and(JoinHandle::is_finished)
    }

    /// The error rmcp's start-up loop ended the session with. Panics if the
    /// loop has not ended within [`START_TIMEOUT`] or opened a session instead.
    pub async fn start_error(mut self) -> ServerInitializeError {
        let task = self
            .task
            .take()
            .expect("the session was not collected as started");
        match tokio::time::timeout(START_TIMEOUT, task)
            .await
            .expect("rmcp's start-up loop is still waiting")
            .expect("the start-up task did not panic")
        {
            Ok(_) => panic!("rmcp opened a session instead of ending the start-up loop"),
            Err(error) => error,
        }
    }

    /// The running service. Call it only after `initialize` or a complete
    /// modern request was answered (see [`chooses_lifecycle`]); a discover
    /// answered on its own leaves rmcp in its start-up loop, and this panics
    /// after [`START_TIMEOUT`] instead of waiting forever.
    pub async fn started(&mut self) -> &RunningService<RoleServer, S> {
        if let Some(task) = self.task.take() {
            let running = tokio::time::timeout(START_TIMEOUT, task)
                .await
                .expect(
                    "rmcp chose no lifecycle: answer `initialize` or a complete modern \
                     request before waiting on the session (a `server/discover` alone \
                     chooses none since rmcp 3.5.1)",
                )
                .expect("the start-up task did not panic")
                .expect("the server opened a session");
            self.running = Some(running);
        }
        self.running
            .as_ref()
            .expect("the running service is kept once it was handed back")
    }

    /// [`Self::started`], taking the running service out.
    pub async fn into_running(mut self) -> RunningService<RoleServer, S> {
        self.started().await;
        self.running
            .take()
            .expect("started() just stored the running service")
    }
}

impl<S: Service<RoleServer>> Drop for ServedSession<S> {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

/// Whether rmcp chooses the lifecycle on `message` when it is the first such
/// message of a stdio session: an `initialize`, or a request other than
/// `server/discover` and `ping` whose `_meta` carries both required keys and a
/// revision this server serves. Any other request is answered (or refused) from
/// rmcp's start-up loop, which then keeps waiting; a notification there ends
/// the session (see the module doc).
pub fn chooses_lifecycle(message: &Value) -> bool {
    if message.get("id").is_none() {
        return false;
    }
    match message["method"].as_str() {
        Some("initialize") => true,
        Some("server/discover") | Some("ping") | None => false,
        Some(_) => {
            let meta = &message["params"]["_meta"];
            let served = meta["io.modelcontextprotocol/protocolVersion"]
                .as_str()
                .is_some_and(|v| SERVED_PROTOCOL_VERSIONS.iter().any(|s| s.as_str() == v));
            served
                && meta
                    .get("io.modelcontextprotocol/clientCapabilities")
                    .is_some()
        }
    }
}
