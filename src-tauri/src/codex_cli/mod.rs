//! Codex CLI management module
//!
//! Handles resolving, installing, and authenticating the Codex CLI binary.

mod commands;
mod config;
pub mod mcp;

pub use commands::*;
pub use config::resolve_cli_binary;
