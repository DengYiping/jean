//! CodeRabbit CLI management.

pub mod commands;
pub mod config;

pub use commands::*;
pub use config::{resolve_coderabbit_binary, should_auto_use_system_coderabbit};
