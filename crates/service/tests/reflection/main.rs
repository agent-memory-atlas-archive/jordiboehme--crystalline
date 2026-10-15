//! One test binary for the Reflection: the switch, reflections, threads, the
//! reflect queue, rights, the MCP tools, the REST contract, co-editing rooms
//! and the backup branch. Modules are added by the tasks that need them.

#[path = "../support/mod.rs"]
mod support;

mod assets;
mod assets_mcp;
mod backup;
mod docs;
mod fixture;
mod guards;
mod hosts;
mod nudges;
mod queue;
mod rest;
mod rights;
mod search;
mod switch;
mod threads;
