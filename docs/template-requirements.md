# Tauri + React App "Walking Skeleton"

## Introduction

This document contains details for creating a "walking skeleton" for building robust, maintainable, and scalable desktop applications using Tauri and React. The goal is to establish a clear, modern, and opinionated project structure and architecture _before_ writing the first feature.

This setup is designed to be highly effective for human developers and AI coding agents alike. It promotes best practices, separation of concerns, and provides clear instructions and patterns to follow, reducing ambiguity and leading to a higher-quality codebase.

# Core Tech Stack

- Base: Tauri 2, React 19+ & TypeScript, Rust
- UI: Tailwind 4 & Shadcn 4
- State: TanStack Query & Zustand 5
- Tests: Built-in for Rust & Vitest 4 for TS
- CI & Releases: GitHub Actions + GitHub
- DX: VSCode/Cursor, Claude Code, Codex

# The Walking Skeleton

## Overview

- Clean Tauri + React App
- Tauri plugins for with clipboard and filesystem access.
- Typechecking, linting and formatting via TypeScript, ESLint, Prettier, Cargo and Clippy with sensible default configs.
- A minimal DX setup for VSCode, Cursor, Claude Code, and Codex.
- Simple bare-bones test framework for Rust (native) and TypeScript (vitest)
- Clear state management "Onion":
  - useState -> Ephemeral internal component UI state
  - Zustand -> Ephemeral global UI state
  - TanStack Query -> All persistent state not "owned" by React app.
- Clear pattern for extracting React behaviour into hooks and utilities.
- Command Bridge -> system for triggering "commands" from Rust to TS or vice versa in a performant, easy-to-understand way.
- Tailwind & shadcn styling with support for themes and dark mode.
- Commonly-used shadcn UI components
- Simple CSS "reset" for a more native app-like experience.
- Simple "root" react setup with:
  - Simple app-level components (`main.tsx`, `App.tsx` etc)
  - `MainWindow` top-level layout component.
  - Extensible unified title bar with OS window controls and main toolbar buttons.
  - "Main" layout with main area and resizable + hideable left & right sidebars.
- Global "Cmd+K" command palette and clear pattern for adding commands.
- Settings dialog with multiple panes, sensible default styles and settings persistence via local disk and/or remote backend.
- Basic OS menu system: about, settings, check for updates, quit, close window, fullscreen, help etc.
- Keyboard shortcut system
- Extensible local crash reporting and data recovery system
- Release process automated via GitHub Actions and helper scripts etc.
- Automatic update system
- Notification system with support for React Toasts and native OS notifications
- Unified logging system
- Developer documentation framework
- User Manual framework
- Markdown-based task management system
- Tailored AI instructions, agents and commands

## App Boilerplate (Tauri & React)

App scaffolding is created with `bunx create-tauri-app@latest -- --template react-ts` , producing a basic directory structure. Other directories are added to provide a basic structure:

```
/
├── public/                  # Static assets
├── src/
│   ├── assets/              # Fonts, images, etc.
│   ├── components/
│   │   ├── layout/          # Main layout components (MainWindow, TitleBar, LeftSidebar, RightSidebar, MainWindowContent)
|   |   |── command-palette/ # Command pallete components
|   |   |── preferences/     # Preferences Dialog components
│   │   └── ui/              # Shadcn-ui components
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Core utilities, helpers, and command system
|       └── commands/        # Command system
│   ├── services/            # The API layer (TanStack Query + Tauri invoke)
│   ├── store/               # Zustand stores for global UI state
│   ├── test/                # Tests
│   └── types/               # Shared TypeScript types
├── src-tauri/               # Rust backend
└── ... (config files)
```

A sensible `.gitignore` file for Tauri projects which also ignores all files with `.local` in their filenames.

### VSCode Settings

These settings allow VSCode or Cursor to play nicely with the stuff that will be installed later.

#### `.vscode/extensions.json`

```json
{
  "recommendations": [
    "tauri-apps.tauri-vscode",
    "rust-lang.rust-analyzer",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "tailwindlabs.tailwindcss-intellisense",
    "dbaeumer.vscode-eslint",
    "ms-vscode.vscode-typescript-tslint-plugin"
  ]
}
```

#### `.vscode/settings.json`

```json
{
  "css.lint.unknownAtRules": "ignore",
  "tailwindCSS.includeLanguages": {
    "html": "html",
    "javascript": "javascript",
    "css": "css"
  },
  "files.associations": {
    "*.css": "tailwindcss"
  }
}
```

### Clipboard Manager

The Tauri [Clipboard Manager plugin](https://v2.tauri.app/plugin/clipboard/) is installed and configured.

## Linting, Checks & Formatting

- TypeScript, ESLint, Prettier, Clippy & Cargo Formatter
- Sensible Tauri-friendly default configs for ESLint, Prettier and TypeScript. Ensure `eslint.config.js`, `.prettierrc`, and `src-tauri/rustfmt.toml` are configured with sensible defaults to enforce a consistent code style.
- Suitable commands added to `package.json`:

```json
"scripts": {
  // ... other scripts
  "typecheck": "tsc --noEmit",
  "lint": "eslint . --max-warnings 0",
  "format:check": "prettier --check .",
  "build": "tsc && vite build",
  "rust:fmt:check": "cd src-tauri && cargo fmt --check",
  "rust:clippy": "cd src-tauri && cargo clippy -- -D warnings",
  "rust:test": "cd src-tauri && cargo test",
  "test": "vitest",
  "test:run": "vitest run",
  "check:all": "bun run typecheck && bun run lint && bun run format:check && bun run build && bun run rust:fmt:check && bun run rust:clippy && bun run test:run && bun run rust:test"
},
```

## State Management

### Local Component State -> `useState`

State that is only relevant to a single component (e.g., the value of an input field, whether a dropdown is open) uses the standard React `useState` and `useReducer` hooks.

### Global UI State -> Zustand

Transient global state related to the UI (e.g., `isSidebarVisible`, `isCommandPaletteOpen`) uses small, slices Zustand stores for different UI domains (e.g., `useMainUIStore.ts`, `useMyFancyFeaturePanelStore.ts`).

### All Persisted State -> TanStack Query

Data that originates from outside of the React app, either from the Rust backend (eg read from disk) or from external services and APIs uses TanStack Query. Use **TanStack Query**. Shared backend reads and writes should be wrapped in `useQuery` or `useMutation` hooks within the `src/services/` directory. This handles loading, error, and caching states automatically.

### Data on local disk

Certain settings data should be persisted to local storage (in addition to or instead of to any remote backend system). In Jean this is written under Tauri's app data directory, for example `~/Library/Application Support/com.jean.desktop/` on macOS. File operations are handled by Rust commands and reached from the frontend through `src/lib/transport.ts`, usually wrapped by TanStack Query service hooks.

## Command Bridge

- **Tauri -> React:** In `main.rs`, define your menu items. When a menu item is clicked, emit an event to the frontend (e.g., `window.emit('menu-event', 'new-file')`). Create a `useMenuListeners.ts` hook in React to listen for these events and call the appropriate functions.
- **React -> Tauri/browser backend:** Create a Rust command, register it in `src-tauri/src/lib.rs`, add a web-compatible arm in `src-tauri/src/http_server/dispatch.rs` if it should work in browser/headless mode, and call it via `invoke()` from `src/lib/transport.ts`.
- **Command System:** Create a `lib/commands.ts` file that defines a global command registry. This allows different parts of the app to register and execute commands (e.g., "createNewFile", "toggleTheme") without being directly coupled. The Command Palette and menu listeners can then simply execute commands from this registry.

## Test Framework

- Rust tests live inside the Rust test files in accordance with Rust best practices.
- Other tests are written using vitest and `@testing-library/react` and are colocated with the files they test. Setup, utilities, hooks etc are in `test/` within the relevant `src` directory.

## Styling & UI Components

### Tailwind & shadcn

- Tailwind 4 is used alongside shadcn 4 UI components in the standard way
- UI components are installed in `src/components/ui` and are kebab-case. Generally speaking, they should not be modified heavily **unless** you are modifying their visual appearance.
- Most styling for JSX components should be done with tailwind to keep things simple.
- A shadcn theme can be generated with [Tweakcn](https://tweakcn.com/) and should be used to provide a basic theme via CSS variables.

### Theming

Theming should be done via [Tailwind v4 CSS variables](https://ui.shadcn.com/docs/theming) and a [ThemeProvider](https://ui.shadcn.com/docs/dark-mode/vite). See also <https://tailwindcss.com/docs/theme>.

### CSS

Since we're using Tailwind, there should be very little CSS. Some very complex components _may_ include a `MyComponent.css` but it should be extremely rare. In general, the only CSS should be in `App.css` (loaded by `App.tsx`). This includes:

- Font imports
- Tailwind theme variables
- Other CSS variables
- Tailwind & shadcn initialisation
- Some basic resets to make things work more like a macOS app.
  - Resets to prevent scrolling and overflows.
  - Styling for Tauri windows.
  - Cursor is never a pointer, except on plain text links or when overridden with a utility class
  - No text selection by default, except where overridden or in inputs and textareas.

## React Components System

- Each React component should be in its own `.tsx` file.
- If a component has any non-trivial logic (e.g., `useEffect`, state management, complex event handlers), extract it into a custom hook (e.g., `useFileRenaming.ts`). The component should be left with primarily presentational code.
- All component directories should contain barrel exports.

## Main Window Layout

### `main.tsx`

Renders `<App />` wrapped in the TanStack `QueryClientProvider`. Nothing else.

### `App.tsx`

In Jean, `App.tsx` owns global bootstrap work such as initial browser-mode data seeding, update checks, queue processing, persistence hooks, and recovery listeners, then renders `<MainWindow />` inside the provider tree.

### MainWindow

This is the primary container for the React app. It renders the main app layout components as well as global "hidden" components like toasts, dialogs, and the command palette. In Jean, `MainWindow` coordinates `TitleBar`, `LeftSideBar`, `MainWindowContent`, `RightSideBar`, and global overlays such as preferences, onboarding, update, and modal flows.

### TitleBar

A unified title bar which spans the entire top of the app and is clickable to drag the window around (using `data-tauri-drag-region`). The left side contains a component which renders a custom version of Mac OS "traffic light" Window controls. The rest of the toolbar is ready for minimal buttons to be added to the left or right side of it.

### LeftSideBar

The left sidebar is a simple wrapper whose only purpose is to constrain any other components it contains, and to allow itself to be resized or hidden.

### RightSideBar

The right sidebar is a simple wrapper whose only purpose is to constrain any other components it contains, and to allow itself to be resized or hidden.

### MainWindowContent

The main content window is a simple wrapper that allows for the conditional rendering of other components in the main window. In apps where this isn't required, this component can be replaced with whatever the main window should contain.

## Preferences System

This is intended to provide a simple and obvious pattern for adding settings and configurations. It can be opened with a keyboard shortcut or from the macOS menubar. The left-hand side contains a number of "tabs" Built using shadcn's `Sidebar` components. Each tab loads a new **pane** into the right-hand side. Panes can be added to `src/components/preferences/panes`.

Preferences should be persisted using the standard hooks and pattern for interacting with any other persistent data via TanStack Query.

## Command Palette

The command palette provides a simple overlay with keyboard navigability using Shadcn's `command` components. Current commands are registered from domain files under `src/lib/commands/` and executed with the shared `CommandContext`.

## Native Menu System

The native menu system provides the following through Tauri's menu systems:

- Main Menu
  - About -> Shows a native dialog with some basic info about the app, version etc
  - Check for Updates -> Fires the auto-update checker
  - Preferences -> Opens the preferences dialog
  - Quit -> Quits the app
- Window
  - Enter Full Screen Mode -> Enters macOS fullscreen mode

There is an obvious and easy-to-follow pattern for adding new menu items along with their associated keyboard shortcuts, and for those to fire commands as you would expect.

## Keyboard Shortcuts System

Global keyboard shortcuts are managed by `react-hotkeys-hook` inside an event listeners hook loaded by `MainWindow`. These shortcuts fire events in the same pattern as everywhere else.

## Local Filesystem Access

This app is pre-configured with the Tauri file system access, along with the necessary security measures to deny access to important places on the local file system. This is primarily used to read and write preferences persisted to disc, but it also makes it easy to build apps which need to read and write to the local file system.

## Local Settings Persistence & Crash Reporting

Local preferences are persisted to disc in the application's support directory as JSON files. There is also a pre-built mechanism for writing crash reports to this directory along with any potentially unsaved data which could not be properly written/synced to remote stores.

## Release Process

- GitHub Action to create release from github tags, along with JSON file to enable auto-updates.
- `scripts/prepare-release.js` to assist with preparing and pushing a new release.
- Release process documented in `docs/developer/releases.md` along with instructions for setting up the GitHub action correctly.

## Auto-Updater

- Auto-update mechanism which checks GitHub for new releases on launch or when "Check for Updates" is clicked. Jean stores a pending update, shows `UpdateAvailableModal`, downloads with toast progress, and restarts via `@tauri-apps/plugin-process`.

## Toast & Notification System

Notifications to be sent and displayed as toasts in the bottom right of the application and/or be sent to the native macOS notifications via Tauri's [Notifications](https://v2.tauri.app/plugin/notification/) system. Toasts disappear after a set time and are stylable and dismissible by the user. Notifications can be dispatched either from React or Rust code via easy-to-use helper functions which control the destinations (toast, native), type and content.

## Logging System

Logging helpers are provided in both Rust and TypeScript to facilitate easy logging, both to the JavaScript console and to OS logs via Tauri's [log plugin](https://v2.tauri.app/plugin/logging/).

## Developer Docs

The philosophy, design patterns, architecture, best practices, and development processes are documented in a series of Markdown files in `docs/developer`. This is intended as a starting point, describing the current setup. As new features are added and new patterns are included, these documents should be added to and updated so they remain current.

`docs/developer/architecture-guide.md` is a comprehensive set of instructions on the patterns and rules used in this app. It's intended for AI agents to read when checking their work follows established patterns.

## User Guide Boilerplate

There is no separate `docs/userguide` directory in the current tree. User-facing setup information lives in the root `README.md`, `CONTRIBUTING.md`, and `GETTING_STARTED.md`; create a dedicated user guide only when there is a maintained publishing target for it.

## Task Management

A simple Markdown-based task manager system is included.

`docs/tasks-done` - Completed tasks as markdown files
`docs/tasks-todo` - Uncompleted tasks as markdown files
`docs/tasks.md` - Instructions for AI agents (and humans) about how to manage tasks.

Tasks take the form `task-x-taskname.md`. To prioritise a task, change the "x" to a number. Any with "x" are unprioritised and "on the backlog".

## AI Dev Tooling

### AI Instructions

Repo-local agent instructions live in `AGENTS.md`. `CLAUDE.local.md` may exist as a private ignored overlay on individual machines. Cursor and Codex configuration are tracked separately in `.cursor/rules/main.mdc` and `.codex/environments/environment.toml`.

### Claude Code Agents

Five Claude Code agents specific to this project are included under `.claude/agents/`:

- `codebase-mental-model-documenter` -> Developer documentation and architecture mental models.
- `react-architect` -> React architecture, component design, state patterns, and performance.
- `tauri-rust-expert` -> Tauri v2, Rust backend, plugins, commands, permissions, and distribution.
- `ui-design-expert` -> Native-feeling desktop UI/UX design for Tauri React surfaces.
- `user-guide-expert` -> User-facing guide content when a maintained user guide exists.

### Claude Code Commands

Two Claude Code commands are included:

- `/check` -> Checks everything meets `docs/developer/architecture-guide.md`, runs `bun run check:all`, and fixes any problems.
- `/init` -> Helps initialize or refresh project context.

## Other Boilerplate Bits

Eg...

- .gitignore
- .prettierignore
- .cursorignore
- AGENTS.md
- CLAUDE.local.md # Ignored by git when present. Use only for private local overlay instructions.
- LICENSE.md
- README.md
- docs/SECURITY.md
- docs/CONTRIBUTING.md
- icon.svg (standard macOS icon which can be used in build process and/or in react app)

# Future Additions

I suspect these are feature creep for a Tauri/React Boilerplate, but they're noted here just in case...

- [ ] Typesafe integration with convex.dev backend
- [ ] Utilities for authenticated interaction with external web APIs & services
- [ ] Utilities for working with AI models
- [ ] Multi-window orchestration & communication framework
