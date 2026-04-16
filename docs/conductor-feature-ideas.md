# Conductor-Inspired Ideas For Jean

Assumption: "Conductor" refers to the desktop app at `conductor.build`.

## Summary

Conductor and Jean overlap heavily on the baseline workflow: worktrees, chat sessions, GitHub and Linear integration, diff viewing, terminal usage, open-in-editor flows, MCP support, slash commands, and collaborative/todo visibility.

The most useful ideas for Jean are the areas where Conductor appears to have stronger workflow support rather than broad surface-area differences.

## High-Value Ideas

1. **Turn checkpoints and revert**
   Save a checkpoint for each major agent turn and allow reverting both code state and session state together.
   Jean already restores plan/question state from run history, so this is a natural extension.

2. **Spotlight testing / repo-root sync mode**
   Support a mode where a worktree can sync tracked changes back into the repo root for hot reload and reuse of existing build artifacts.
   This would help projects that do not run cleanly from isolated worktree paths or depend on shared local services and caches.

3. **Run-script orchestration parity**
   Extend `jean.json` script support with more explicit run behavior, including concurrent vs nonconcurrent execution and a stable reserved-port contract.
   Jean already supports `setup`, `run`, `teardown`, and `build`, so this is an incremental improvement rather than a new subsystem.

4. **Stronger shared team automation config**
   Keep building on committed `jean.json` as the shared workflow contract.
   Likely additions: run mode, reserved ports, and any future spotlight-style config needed for testing or local app boot.

5. **Guided path-to-merge UX**
   Build a more opinionated workflow from diff review to testing to PR creation to failing-check triage to merge.
   Jean already has many of these primitives, but they are less unified than Conductor's documented flow.

## Lower-Priority Ideas

1. **Archive and restore polish**
   Jean already supports archived worktrees and sessions, but the UX could be tightened around restoring the exact working context.

2. **Deep-link entry points**
   Add richer app-level deep links for opening a project, worktree, session, or review state directly from external tools.

3. **Stronger multi-repo workflow affordances**
   Jean has linked projects and cross-project context sharing already; the opportunity is better UX around hopping between related repos in a single task flow.

## Existing Jean Coverage

Jean already has:

- Project/worktree/session management
- GitHub and Linear flows
- Diff viewer
- Integrated terminal
- Open-in-editor support
- MCP support
- Slash-command discovery
- Queued messages
- Active todo visibility
- Sub-agent visibility
- Shared `jean.json` scripts (`setup`, `run`, `teardown`, `build`)

## Recommended Priority Order

1. Turn checkpoints and revert
2. Spotlight testing / repo-root sync mode
3. Run-script orchestration parity
4. Guided path-to-merge UX
5. Shared team automation config improvements
