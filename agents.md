# AI Agent Instructions

This file is the canonical repo-local guide for AI agents working in this repository.

## Local Overlay

If `CLAUDE.local.md` exists on a machine, treat it as a private overlay on top of this file. Do not assume it exists.

## Repository Overview

This repository is a fork of the upstream `coollabsio/jean` project. It is a Tauri v2 application with a React frontend and Rust backend for managing projects, worktrees, terminals, and chat sessions across Claude CLI, Codex CLI, and OpenCode.

This fork also supports browser/headless access through the embedded HTTP/WebSocket server, so native-only assumptions are often wrong.

## Fork Baseline

When evaluating fork-specific behavior, use:

- `coollabsio/jean:main` as the upstream baseline
- `ydeng-main` as the fork baseline

## Current Focus Areas

The implementation in this fork is currently centered on:

- Codex collaboration parity, including plan approval, question restoration, and run-history-derived state
- Live Codex session visibility, including sub-agent progress, todo tracking, and file change rendering
- Web/headless parity through the HTTP server and WebSocket transport
- OpenCode support, CLI source overrides, custom launcher commands, and custom provider profiles
- Session recap/context telemetry, including floating token/context usage UI
- Project/worktree/session UX polish, including canvas flows, PR/review helpers, and cleanup behavior

## Read First

Before changing code, read the relevant docs and inspect the implementation:

- `docs/tasks.md`
- `docs/developer/architecture-guide.md`
- `docs/developer/state-management.md`
- `docs/developer/testing.md`
- `docs/developer/command-system.md` when touching commands, menus, or shortcuts
- `docs/developer/performance-patterns.md` when touching rendering or store subscriptions

Also check the current branch, git status, and the files already touched by the user.

## Current Stack

As of the current implementation:

- React `19.2`
- Vite `7.2`
- TanStack Query `5`
- Zustand `5`
- Tailwind `4.1`
- shadcn/ui + Radix UI
- Sonner for toasts
- Vitest `4`
- Playwright for browser-mode E2E
- Tauri `2`

## Architecture Snapshot

High-level UI structure:

- `MainWindow` is the top-level orchestrator
- `ChatWindow` is the main worktree session surface
- `ProjectCanvasView` is the project-level dashboard when no worktree is active
- `SessionChatModal` is used to open sessions from the canvas
- Global overlays live in `src/components/`

Important backend domains:

- `src-tauri/src/chat/`
- `src-tauri/src/projects/`
- `src-tauri/src/http_server/`
- `src-tauri/src/terminal/`
- `src-tauri/src/claude_cli/`
- `src-tauri/src/codex_cli/`
- `src-tauri/src/opencode_cli/`
- `src-tauri/src/opencode_server/`
- `src-tauri/src/background_tasks/`

## Transport Rule

Frontend code that talks to the backend should use `src/lib/transport.ts`, not direct `@tauri-apps/api/*` imports, unless the code is intentionally native-only.

Use:

- `invoke()` from `src/lib/transport`
- `listen()` from `src/lib/transport`
- `convertFileSrc()` from `src/lib/transport`

Reason: the app runs in native Tauri, browser/headless mode, and browser-based E2E with mocked transport.

## State Model

The state model is still the same onion:

```text
useState -> Zustand -> TanStack Query
```

Use:

- `useState` for local presentation state
- Zustand for transient global UI/session state
- TanStack Query for persisted/backend-owned state

Relevant files:

- `src/store/chat-store.ts`
- `src/store/projects-store.ts`
- `src/store/ui-store.ts`
- `src/services/chat.ts`
- `src/services/projects.ts`
- `src/services/preferences.ts`

## Persistence Split

Do not treat all persisted state as `ui-state.json`. The implementation is now split:

- UI-wide persisted state lives in `src/types/ui-state.ts` and `src/hooks/useUIStatePersistence.ts`
- Session-scoped persisted state lives in Session files and is coordinated by `src/hooks/useSessionStatePersistence.ts`

Session-scoped persisted state includes things like:

- answered questions
- submitted answers
- fixed findings
- pending permission denials
- denied message context
- reviewing state
- waiting-for-input state
- plan file path / pending plan message
- enabled MCP servers
- selected execution mode

Do not add new session-scoped persistence to `ui-state.json` unless there is a strong reason.

## Serialization Convention

There are two active serialization patterns in this codebase:

1. Persisted/settings structs use `snake_case`
2. Command/API payloads often use `camelCase` with Rust `#[serde(rename_all = "camelCase")]`

Practical rules:

- `src/types/ui-state.ts` and persisted preference/state types must match Rust field names exactly
- For new command payload structs, pick one convention and keep Rust/TypeScript aligned
- In `src-tauri/src/http_server/dispatch.rs`, prefer `field()` / `field_opt()` for dual camelCase + snake_case extraction

## Chat And Session Gotchas

The current chat/session implementation has a few important invariants:

- `useChatStore` is still large and central; prefer extracting focused hooks/utilities over making `ChatWindow.tsx` larger
- Waiting state is driven by `AskUserQuestion` and `ExitPlanMode`, not just by whether a run is currently streaming
- Codex and OpenCode plan flows can complete a run and still leave the session waiting for approval/input
- `src/components/chat/hooks/useStreamingEvents.ts` owns a lot of subtle cache, waiting-state, and cross-client synchronization behavior; changes there require extra care
- Codex sub-agent and todo progress is derived from tool calls through `src/components/chat/hooks/useActiveTodosAndAgents.ts`
- `FileChange` tool calls are rendered specially via `FileChangeCard` and are intentionally excluded from the normal inline tool-call timeline in some places

Relevant files:

- `src/components/chat/ChatWindow.tsx`
- `src/components/chat/hooks/useStreamingEvents.ts`
- `src/components/chat/hooks/useMessageHandlers.ts`
- `src/components/chat/hooks/usePlanApproval.ts`
- `src/components/chat/hooks/usePlanDialogApproval.ts`
- `src/components/chat/hooks/useActiveTodosAndAgents.ts`
- `src/components/chat/ToolCallInline.tsx`
- `src/components/chat/FileChangeCard.tsx`

## Canvas And Session Modal Architecture

The current project-level flow is:

- select a project
- show `ProjectCanvasView`
- open a specific session in `SessionChatModal`

The canvas/session-card stack currently depends on:

- `src/components/dashboard/ProjectCanvasView.tsx`
- `src/components/chat/session-card-utils.tsx`
- `src/components/chat/hooks/useCanvasStoreState.ts`
- `src/components/chat/hooks/useCanvasKeyboardNav.ts`
- `src/components/chat/hooks/useCanvasShortcutEvents.ts`
- `src/components/chat/hooks/useClearContextApproval.ts`
- `src/components/chat/hooks/useWorktreeApproval.ts`

If you change canvas behavior, inspect both the full chat view and the modal/canvas path.

## Tauri Command Rules

Every new `#[tauri::command]` that should work outside the native app must be wired in all of these places:

1. `src-tauri/src/lib.rs` in `generate_handler![]`
2. `src-tauri/src/http_server/dispatch.rs`
3. browser E2E mocks in `e2e/fixtures/invoke-handlers.ts`
4. `e2e/fixtures/tauri-mock.ts` if the command needs stateful mock behavior

If you skip `dispatch.rs`, browser/headless mode will fail with `"Unknown command"`.

## Process Spawning Rule

Use `silent_command()` for background CLI/git/process work in Rust. This avoids Windows console flashes and keeps background commands quiet.

Keep `Command::new()` only for commands that intentionally open visible UI, or for the small number of bootstrapping cases that cannot use `silent_command()`.

Relevant file:

- `src-tauri/src/platform/process.rs`

## Worktree And Project Notes

Current project/worktree behavior worth knowing:

- Projects can override worktree location with `worktrees_dir`
- Worktree creation uses event-driven synchronization and pending UI states
- Base sessions and canvas auto-open behavior are part of the current project flow
- Worktree/session status is surfaced both in sidebar items and in canvas cards

Relevant files:

- `src-tauri/src/projects/types.rs`
- `src-tauri/src/projects/storage.rs`
- `src-tauri/src/projects/commands.rs`
- `src/services/projects.ts`
- `src/components/projects/WorktreeItem.tsx`
- `src/components/projects/panes/GeneralPane.tsx`

## Models And Preferences

Model and backend handling is broader than the original upstream app. This fork currently supports:

- Claude models
- Codex models
- OpenCode models
- per-prompt backend/model/provider overrides
- custom CLI profiles

If you add or rename model options, inspect at least:

- `src/types/preferences.ts`
- `src/components/chat/toolbar/toolbar-options.ts`
- `src/components/chat/ChatToolbar.tsx`
- `src/services/preferences.ts`
- related tests under `src/services/` and `src/components/chat/`

## Testing And Quality Gates

Primary commands:

```bash
bun run test:run
bun run rust:test
bun run test:e2e
bun run check:all
```

Guidance:

- Run targeted tests while iterating
- Run `bun run check:all` after code changes
- E2E runs in browser mode with mocked Tauri transport, not in native Tauri
- Adding a new backend command without an E2E mock will break tests

## Development Practices

Keep these repo-specific expectations in mind:

1. Read files before editing them
2. Follow existing patterns before inventing new ones
3. Prefer small, focused hooks/utilities over making central components larger
4. Match the current code style and naming in the touched area
5. Update docs in `docs/developer/` when you add a new pattern or workflow
6. Run the relevant tests/checks for the code you changed
7. Do not create commits unless explicitly asked
8. Use `rm -f` when removing files

## Small But Important Details

- Use Tauri v2 APIs and docs only
- Use modern Rust formatting like `format!("{variable}")`
- Prefer `openUrl` from `@tauri-apps/plugin-opener` over `window.open`
- Prefer query invalidation and event-driven refresh over ad hoc local cache mutations unless the existing code already uses an optimistic pattern
- Be careful with Zustand selectors: subscribing to a getter function does not subscribe to the underlying data
- Guard Zustand `set()` calls against no-op updates to avoid unnecessary renders
