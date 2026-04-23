<div align="center">

# Jean

A desktop AI assistant for managing multiple projects, worktrees, and chat sessions with Claude CLI, Codex CLI, Cursor CLI, and OpenCode.

Tauri v2 · React 19 · Rust · TypeScript · Tailwind CSS v4 · shadcn/ui v4 · Zustand v5 · TanStack Query · CodeMirror 6 · xterm.js

</div>

> This repository is a fork of the upstream [coollabsio/jean](https://github.com/coollabsio/jean). It stays close to upstream Jean while carrying fork-specific changes focused on Codex collaboration workflows, local skills, usage telemetry, and developer ergonomics.

## About the Project

Jean is an opinionated native desktop app built with Tauri that gives you a powerful interface for working with Claude CLI, Codex CLI, Cursor CLI, and OpenCode across multiple projects. It has strong opinions about how AI-assisted development should work — managing git worktrees, chat sessions, terminals, GitHub and Linear integrations in one cohesive workflow.

No vendor lock-in. Everything runs locally on your machine with your own Claude CLI, Codex CLI, Cursor CLI, or OpenCode installation.

For upstream project information, take a look at [jean.build](https://jean.build).

## Screenshots

<table>
<tr>
<td><img src="screenshots/SCR-20260304-krym.png" width="400" alt="Screenshot 1" /></td>
<td><img src="screenshots/SCR-20260304-ksgh.png" width="400" alt="Screenshot 2" /></td>
</tr>
<tr>
<td><img src="screenshots/SCR-20260304-ksjn.png" width="400" alt="Screenshot 3" /></td>
<td><img src="screenshots/SCR-20260304-ksnq.png" width="400" alt="Screenshot 4" /></td>
</tr>
<tr>
<td><img src="screenshots/SCR-20260304-kstl.png" width="400" alt="Screenshot 5" /></td>
<td><img src="screenshots/SCR-20260304-ktab.png" width="400" alt="Screenshot 6" /></td>
</tr>
<tr>
<td><img src="screenshots/SCR-20260304-ktwr.png" width="400" alt="Screenshot 7" /></td>
<td><img src="screenshots/SCR-20260304-kuhk.png" width="400" alt="Screenshot 8" /></td>
</tr>
</table>

## Features

- **Project & Worktree Management** — Multi-project support, linked projects for cross-project context, git worktree automation (create, archive, restore, delete), custom project avatars
- **Session Management** — Multiple sessions per worktree, execution modes (Plan, Build, Yolo) with plan approval flows, session recap/digest, saved contexts with AI summarization, archiving with retention settings, recovery, auto-naming, canvas views
- **AI Chat (Claude CLI, Codex CLI, Cursor CLI, OpenCode)** — Model selection (Opus 4.5, Opus 4.6, Opus 4.6 1M, Sonnet 4.6, Haiku), thinking/effort levels with per-mode overrides, MCP server support, Codex multi-agent collaboration, file picker & image attachments, chat search, notification sounds, custom system prompts, custom CLI profiles
- **Magic Commands** — Investigate issues/PRs/workflows, code review with finding tracking, AI commit messages, PR content generation, merge conflict resolution, release notes generation, customizable per-prompt model/backend/effort selection
- **GitHub Integration** — Dashboard with Issues, PRs, Security Alerts, and Advisories tabs, Dependabot investigation, checkout PRs as worktrees, auto-archive on PR merge, workflow investigation
- **Linear Integration** — Issue investigation, context loading, per-project API key and team configuration
- **Developer Tools** — Multi-dock terminal (floating, left, right, bottom), command palette, open in editor (Zed, VS Code, Cursor, Xcode, IntelliJ), git operations (status, stash, revert, fetch/merge with conflict detection), diff viewer (unified & side-by-side), file tree with preview, debug panel with token usage tracking
- **Remote Access** — Built-in HTTP server with WebSocket support, token-based auth, web browser access
- **Customization** — Themes (light/dark/system), custom fonts, customizable AI prompts, configurable keybindings, mobile swipe gestures

### Fork-specific additions

- **Codex plan mode parity** — plan approval dialogs, `request_user_input` flows, and restoration of plan/question state from Codex run history
- **Live Codex execution visibility** — streamed todo updates, sub-agent progress, improved file change rendering, and local link handling
- **Skills & usage telemetry** — repo-local Codex skill discovery, a context meter, floating session usage tracking, and corrected token/cache accounting
- **Local tooling flexibility** — custom git executable override, custom OpenCode launcher commands, host-installed AI CLI support, and IntelliJ editor support
- **Worktree/session ergonomics** — shortcuts for creating build/yolo sessions and worktrees, better PR preview/checkout flows, waiting-state cleanup, and improved diff controls

## Installation

If you want the upstream distribution, download the latest version from the [GitHub Releases](https://github.com/coollabsio/jean/releases) page or visit [jean.build](https://jean.build). If you want the fork-specific behavior documented above, build from source from this repository.

### Upstream Homebrew (macOS)

```bash
brew tap coollabsio/jean
brew install --cask jean
```

### Building from Source

Prerequisites:

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install)
- **Windows only**: In the Visual Studio Installer, ensure the **"Desktop development with C++"** workload is selected, which includes:
  - MSVC C++ build tools
  - Windows SDK (provides `kernel32.lib` and other system libraries required by Rust)

See [CONTRIBUTING.md](CONTRIBUTING.md) for full development setup and guidelines.

## Platform Support

- **macOS**: Tested
- **Windows**: Not fully tested
- **Linux**: Community tested (Arch Linux + Hyprland/Wayland)

## Headless Web Access

Run Jean without the desktop window and expose the web UI over HTTP:

```bash
jean --headless --host 127.0.0.1 --port 3456
```

`--host` accepts `localhost` or an IP address. Passing a specific address such
as your Tailscale IP binds Jean only to that interface.

## Desktop CLI

Desktop CLI subcommands can hand work off to the Jean app:

```bash
jean import /path/to/repo
jean yolo "tell me about Iceberg"
```

`jean yolo` opens Jean, creates a fresh yolo session in the configured default
repo's base session, and sends the prompt there. Configure the target repo in
Settings > General > Default repo for CLI yolo.

## Roadmap

- Enhance remote web access

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Upstream Maintainer

|                                                                                                                                                                            Andras Bacsai                                                                                                                                                                             |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
|                                                                                                                                         <img src="https://github.com/andrasbacsai.png" width="200px" alt="Andras Bacsai" />                                                                                                                                          |
| <a href="https://github.com/andrasbacsai"><img src="https://api.iconify.design/devicon:github.svg" width="25px"></a> <a href="https://x.com/heyandras"><img src="https://api.iconify.design/devicon:twitter.svg" width="25px"></a> <a href="https://bsky.app/profile/heyandras.dev"><img src="https://api.iconify.design/simple-icons:bluesky.svg" width="25px"></a> |

## Upstream Philosophy

Learn more about our approach: [Philosophy](https://coollabs.io/philosophy/)

## Upstream Star History

[![Star History Chart](https://api.star-history.com/svg?repos=coollabsio/jean&type=Date)](https://star-history.com/#coollabsio/jean&Date)
