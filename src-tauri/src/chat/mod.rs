pub(crate) mod claude;
pub(crate) mod codex;
pub(crate) mod codex_goal_monitor;
pub(crate) mod codex_server;
mod commands;
pub(crate) mod context_instructions;
pub mod detached;
pub(crate) mod handoff;
pub mod jean_mcp;
mod naming;
mod native_history;
pub(crate) mod opencode;
pub(crate) mod permission_rules;
pub mod registry;
pub mod run_log;
pub mod storage;
pub mod tail;
pub mod types;
pub mod wakeup;

pub use commands::*;
pub use native_history::*;
pub use storage::{preserve_base_sessions, restore_base_sessions, with_sessions_mut};

use std::sync::atomic::{AtomicUsize, Ordering};

/// End-of-turn recap instruction. Appended to backend prompts so the assistant
/// can emit a compact `## Recap` block without removing the existing digest
/// generation flow used elsewhere in the fork.
pub const RECAP_INSTRUCTION: &str = "## End-of-turn recap

When you finish a turn that involved tool calls, edits, or multi-step work, end your response with a final markdown section like this:

## Recap

[If the user asked a question or requested a specific output, restate the actual answer/result here so the recap stands alone as the deliverable. Use a short paragraph, table, or list — whichever fits the answer best.]

- 2-4 short bullets for context that does not fit above: caveats, follow-ups, unresolved questions, or files the user should review.

[Optional `### How to test` subsection — include ONLY when the rules below say to.]

Rules:
- Heading must be the literal string `## Recap` on its own line.
- Place it as the LAST block of the message, after any prose.
- The recap is the user-facing deliverable — it must be self-contained. Include the actual answer/result inline. Do NOT write things like \"I looked it up\" or \"see above\" — restate the answer.
- Add a `### How to test` subsection ONLY when the turn produced code, config, or behavior changes the user can verify. Make it actionable and specific (commands to run, UI flows to click through, files to inspect). OMIT the subsection entirely on read-only turns — questions, explanations, research, planning, code review without edits, or any turn where there is nothing meaningful to test. Do NOT include placeholder content like \"N/A\", \"Nothing to test\", \"No tests needed\", or an empty bullet list. If in doubt, leave it out.
- Skip the recap entirely if the turn was a single one-line answer with no tool calls.
- Do NOT repeat tool inputs, file diffs, or raw command output verbatim. Summarize.";

/// Global counter for active file tailers (sessions being streamed)
static ACTIVE_TAILER_COUNT: once_cell::sync::Lazy<AtomicUsize> =
    once_cell::sync::Lazy::new(|| AtomicUsize::new(0));

pub(crate) fn push_recap_instruction_if_enabled(
    system_prompt_parts: &mut Vec<String>,
    recap_prompting_enabled: bool,
) {
    if recap_prompting_enabled {
        system_prompt_parts.push(RECAP_INSTRUCTION.to_string());
    }
}

pub(crate) fn is_recap_prompting_enabled(app: &tauri::AppHandle) -> bool {
    crate::load_preferences_sync(app)
        .map(|preferences| preferences.recap_prompting_enabled)
        .unwrap_or(false)
}

pub fn increment_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_add(1, Ordering::Relaxed);
}

pub fn decrement_tailer_count() {
    ACTIVE_TAILER_COUNT.fetch_sub(1, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_recap_instruction_if_enabled_skips_when_disabled() {
        let mut parts = vec!["Existing prompt".to_string()];

        push_recap_instruction_if_enabled(&mut parts, false);

        assert_eq!(parts, vec!["Existing prompt".to_string()]);
    }

    #[test]
    fn push_recap_instruction_if_enabled_appends_when_enabled() {
        let mut parts = vec!["Existing prompt".to_string()];

        push_recap_instruction_if_enabled(&mut parts, true);

        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1], RECAP_INSTRUCTION);
    }
}
