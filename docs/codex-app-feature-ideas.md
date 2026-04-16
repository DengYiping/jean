# Codex App-Inspired Ideas For Jean

Assumption: "Codex.app" refers to OpenAI's Codex desktop app.

## Summary

The Codex app is positioned as a command center for managing multiple agents in parallel across projects, with built-in worktrees, skills, automations, git functionality, diff review, and configurable sandbox rules.

Jean already overlaps heavily with the local collaboration side of that workflow. The most interesting opportunities are the places where Codex.app is more opinionated about cross-surface continuity, reusable workflow packaging, cloud delegation, scheduled background work, and permission policy management.

## High-Value Ideas

1. **Cloud delegation and handoff from Jean**
   Add a first-class way to hand a local Jean task off to a remote/background Codex task runner, then pull the result back into the current worktree or review surface.
   The main value is long-running work that should continue without tying up a local terminal session.

2. **Automation review queue**
   Jean already has background tasks and some automation plumbing, but not a dedicated queue for completed scheduled agent work.
   Add a review inbox for automation results so recurring tasks like triage, CI-failure summaries, release notes, or backlog cleanup land in one place for approval and follow-up.

3. **Packaged workflow distribution**
   Codex now treats plugins as the installable unit for reusable workflows built from skills, integrations, and MCP configuration.
   Jean already has skills and MCP discovery, so the obvious next step is a packageable/shareable workflow format for teams rather than only repo-local skill files.

4. **Project and team rules for permission policy**
   Codex.app emphasizes configurable project/team rules that can pre-authorize specific elevated commands.
   Jean already supports execution modes and approval flows, but it could become much more useful with explicit per-project permission rules, auditability, and reusable policy presets.

5. **Stronger in-thread diff review**
   Codex.app lets users review changes in-thread, comment on diffs, and open them in the editor.
   Jean has file-change rendering and a diff modal already; the gap is a tighter review flow with inline comments, turn-scoped review context, and "accept / discard / open / create PR" actions in one place.

6. **GitHub auto-review integration**
   Codex supports automatic pull-request review in GitHub for personal repos or entire teams.
   Jean already has GitHub and review tooling, so adding an optional "Jean reviews this PR automatically" flow would be a meaningful extension.

7. **Shared skill library UX**
   Codex.app includes a skill library and a dedicated interface for creating and managing skills, and skills can be shared through repository/team config.
   Jean already supports skill discovery and enablement, but a clearer skill library, installation UX, and team sharing model would raise the ceiling significantly.

## Lower-Priority Ideas

1. **Cross-surface continuity polish**
   Codex.app picks up session history and configuration from the Codex CLI and IDE extension.
   Jean could benefit from stronger continuity across its own chat surfaces, browser mode, and any future external integrations.

2. **Personality presets**
   Codex exposes selectable interaction styles without changing capabilities.
   Jean could offer a small set of stable assistant-style presets on top of its existing prompt customization.

3. **Enterprise controls and reporting**
   Codex exposes RBAC, plugin controls, and compliance visibility for cloud/web usage.
   If Jean ever targets shared enterprise deployment more directly, admin controls and audit/reporting would become more important.

## Existing Jean Coverage

Jean already has:

- Multi-project and worktree management
- Session management with Codex-specific plan approval and `request_user_input` flows
- Live todo and sub-agent visibility
- GitHub and Linear workflows
- Diff viewer and file-change rendering
- Integrated terminal and open-in-editor support
- MCP support and skill discovery
- Execution modes, sandbox mapping, and approval handling
- Background task infrastructure

## Recommended Priority Order

1. Project and team rules for permission policy
2. Automation review queue
3. Packaged workflow distribution
4. Stronger in-thread diff review
5. Cloud delegation and handoff from Jean
6. GitHub auto-review integration
7. Shared skill library UX
