# Claude Code UI-Inspired Ideas For Jean

Assumption: "Claude Code UI app" refers to Anthropic's current Claude Code experience across its IDE integrations and Claude Code on the web.

## Summary

Claude Code already spans more than the terminal. Anthropic documents IDE integrations with quick launch, in-editor diff viewing, automatic selection sharing, file-reference insertion, and diagnostic sharing. Claude Code also supports slash commands, MCP-exposed slash commands, hooks, GitHub Actions automation, sandboxed execution, and isolated cloud execution via Claude Code on the web.

Jean already overlaps with much of the local coding workflow, especially around worktrees, sessions, diffs, MCP, and approvals. The highest-value opportunities are the places where Claude Code is more tightly integrated with editors, automation hooks, cloud execution, and team-level tooling.

## High-Value Ideas

1. **Deeper IDE bridge**
   Add a tighter editor integration layer for Jean, beyond "open in editor."
   The target experience is quick launch from the editor, current-selection sharing, file-reference insertion, and better "jump from Jean to IDE diff/editor" behavior.

2. **IDE diagnostics as first-class session context**
   Claude Code shares IDE diagnostics like lint and syntax errors automatically while you work.
   Jean could import current diagnostics from supported editors and expose them directly in session context, review flows, and fix loops.

3. **Project/session hook system**
   Claude Code exposes hooks that run from settings files and can work with MCP tools.
   Jean would benefit from a first-class hook model for events like session start, plan approval, message send, command approval, run completion, and worktree lifecycle changes.

4. **Safer autonomous execution modes**
   Claude Code now has sandboxing with filesystem and network isolation, plus a newer auto mode intended to reduce approval fatigue safely.
   Jean already has execution modes and approval flows, but there is room for a more explicit "safe autonomy" layer with policy-driven auto-approval inside clear boundaries.

5. **Cloud sandbox / web execution handoff**
   Claude Code on the web runs each session in an isolated cloud sandbox with guarded git operations through a proxy.
   Jean could eventually support a remote execution target for long-running or higher-isolation tasks while preserving the local-first desktop experience.

6. **GitHub comment-driven automation**
   Claude Code GitHub Actions supports `@claude` in issues and PRs, slash-command-style prompts, and custom workflows built on the Claude Code SDK.
   Jean already has GitHub features, but a comment-triggered automation path would extend it into async repo workflows in a useful way.

7. **Connector directory / remote MCP install UX**
   Anthropic's connectors directory and remote MCP support make tool discovery and installation much easier than raw config-file editing.
   Jean could add a curated MCP directory, one-click installation, permission review, and better remote-connector onboarding.

8. **Team usage analytics**
   Claude Code exposes organization usage analytics for Team and Enterprise owners.
   Jean already has some usage telemetry; the next step would be a team-facing analytics layer for adoption, token usage, approval load, and workflow outcomes.

## Lower-Priority Ideas

1. **Slash-command UX polish**
   Claude Code's slash-command model is broad and includes MCP-exposed prompts discovered dynamically.
   Jean already supports slash commands and skills, but discovery, docs, and command browsing could be cleaner.

2. **Settings-driven policy management**
   Claude Code centralizes behavior in settings files and command-driven config like `/config` and `/sandbox`.
   Jean could make runtime and policy configuration more inspectable and easier to change in-app.

3. **Cross-device continuity**
   Claude Code increasingly spans terminal, IDE, web, and account-level tool connections.
   Jean could benefit from stronger continuity between native desktop, browser/headless mode, and any future remote surfaces.

## Existing Jean Coverage

Jean already has:

- Multi-project and worktree management
- Session management with plan/build/yolo-style execution modes
- Diff viewer and file-change rendering
- Integrated terminal
- Open-in-editor support
- MCP support and local skill discovery
- Approval flows and waiting-state handling
- Background task infrastructure
- GitHub and Linear integrations
- Browser/headless access

## Recommended Priority Order

1. Deeper IDE bridge
2. Project/session hook system
3. Safer autonomous execution modes
4. IDE diagnostics as first-class session context
5. Connector directory / remote MCP install UX
6. GitHub comment-driven automation
7. Cloud sandbox / web execution handoff
8. Team usage analytics
