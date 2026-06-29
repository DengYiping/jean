// Cross-platform abstractions for shell execution and process management

pub mod cli_detect;
pub mod editor;
pub mod process;
pub mod shell;

pub use cli_detect::*;
pub use editor::*;
pub use process::*;
pub use shell::*;
