# T3 Code-Inspired Ideas For Jean

Assumption: "T3 code" refers to the T3 Code app documented at `t3.codes`.

## Summary

T3 Code’s documented feature set overlaps with Jean on the core foundation: chat sessions, worktree support, git-aware workflows, diff viewing, integrated terminal usage, open-in-editor flows, and approval-aware agent execution.

The most useful ideas for Jean are the places where T3 Code is more opinionated about project-scoped automation, runtime controls, checkpoint UX, and monorepo project modeling.

## High-Value Ideas

1. **Richer project script system**
   Extend `jean.json` and project settings beyond the current `setup` / `run` / `teardown` / `build` model.
   Add first-class named scripts with stable IDs, labels, icons, and direct keyboard binding support for common tasks like test, lint, build, and dev server.

2. **Auto-run script slots on worktree creation**
   Jean already supports a single setup script, but T3 Code’s model suggests a better shape:
   allow multiple project scripts to opt into auto-run when a new worktree/session is created, with visible background progress and failure states.

3. **More explicit runtime-mode UX**
   Jean already carries execution-mode and Codex sandbox/approval state, but it could present this more clearly as a stable security posture:
   e.g. supervised vs full-access presets with approval history, pending-request visibility, and session-scoped "allow for this session" controls.

4. **Turn-level checkpoint and revert UI**
   T3 Code leans heavily on checkpoint-based revert tied to conversation turns.
   Jean already has file revert and commit revert primitives, but a turn-scoped "undo this run" workflow would be significantly stronger.

5. **Stronger per-turn diff summaries**
   Jean already renders file changes and has a diff modal, but T3 Code’s docs point toward a tighter flow:
   concise per-turn file delta summaries, easy jump-to-editor behavior, and filtered diffs scoped to a specific turn or run.

6. **Opinionated project modeling for monorepos**
   T3 Code explicitly recommends one project per package in a monorepo when useful.
   Jean has linked projects and cross-project context already; the next step is stronger UX for package-scoped projects, defaults, and navigation in monorepo-heavy repos.

## Lower-Priority Ideas

1. **Project metadata polish**
   T3 Code emphasizes project-level defaults like title and model selection.
   Jean already has strong defaults support, but project identity and quick-edit affordances could be more visible.

2. **Thread status polish**
   T3 Code documents explicit thread states like working, completed, and approval pending.
   Jean already has waiting/reviewing/sending state, but the canvas and modal surfaces could expose lifecycle state more consistently.

3. **Project bootstrap ergonomics**
   T3 Code supports auto-bootstrapping a project from the current working directory.
   Jean could benefit from a similarly fast "open this repo in Jean" entry point for users starting from the terminal.

## Existing Jean Coverage

Jean already has:

- Multi-project and worktree management
- Session management with plan/build/yolo execution modes
- GitHub and Linear flows
- Diff viewer and file change rendering
- Integrated terminal
- Open-in-editor support
- MCP support
- Queued messages, approval/waiting state, and plan-question flows
- Project/worktree defaults and linked-project support
- Shared `jean.json` scripts (`setup`, `run`, `teardown`, `build`)

## Recommended Priority Order

1. Richer project script system
2. Turn-level checkpoint and revert UI
3. Auto-run script slots on worktree creation
4. Stronger per-turn diff summaries
5. Monorepo project modeling improvements
6. More explicit runtime-mode UX
