//! GitHub CLI management module
//!
//! Handles detecting and using the host-system GitHub CLI (gh) binary.

mod commands;
pub(crate) mod config;

pub use commands::*;
