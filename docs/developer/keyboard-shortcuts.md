# Keyboard Shortcuts

User-configurable keyboard shortcut system using native DOM event listeners, integrated with the command system for consistent behavior across the app.

## Quick Start

### Current Keybindings

Keybindings are user-configurable in Preferences. The source of truth is `DEFAULT_KEYBINDINGS` and `KEYBINDING_DEFINITIONS` in `src/types/keybindings.ts`; this table mirrors the current defaults:

| Action                                | Default Shortcut      | Description                     |
| ------------------------------------- | --------------------- | ------------------------------- |
| `focus_chat_input`                    | `Cmd+L`               | Move focus to chat textarea     |
| `toggle_left_sidebar`                 | `Cmd+B`               | Show/hide projects sidebar      |
| `open_new_project_dialog`             | `Cmd+Shift+N`         | Open new project dialog         |
| `open_preferences`                    | `Cmd+,`               | Open preferences dialog         |
| `open_commit_modal`                   | `Cmd+Shift+C`         | Open git commit dialog          |
| `open_git_diff`                       | `Cmd+G`               | Open git diff view              |
| `execute_run`                         | `Cmd+R`               | Start/stop workspace run script |
| `open_in_modal`                       | `Cmd+O`               | Open current worktree in...     |
| `open_magic_modal`                    | `Cmd+M`               | Open magic commands menu        |
| `new_session`                         | `Cmd+T`               | Create new chat session         |
| `next_session`                        | `Cmd+Alt+Right`       | Switch to next session          |
| `previous_session`                    | `Cmd+Alt+Left`        | Switch to previous session      |
| `close_session_or_worktree`           | `Cmd+W`               | Close session or worktree       |
| `new_worktree`                        | `Cmd+N`               | Create new worktree             |
| `cycle_execution_mode`                | `Shift+Tab`           | Cycle Plan/Build/Yolo modes     |
| `approve_plan`                        | `Cmd+Enter`           | Approve current plan            |
| `approve_plan_yolo`                   | `Cmd+Y`               | Approve plan in yolo mode       |
| `approve_plan_clear_context`          | `Cmd+Shift+Y`         | Clear context and start yolo    |
| `approve_plan_clear_context_build`    | `Cmd+Shift+Enter`     | Clear context and start build   |
| `approve_plan_worktree_build`         | `Cmd+Alt+Enter`       | Build in a new worktree         |
| `approve_plan_worktree_yolo`          | `Cmd+Alt+Y`           | Yolo in a new worktree          |
| `open_plan`                           | `P`                   | Open selected session plan      |
| `open_recap`                          | `R`                   | Open selected session recap     |
| `restore_last_archived`               | `Cmd+Shift+T`         | Restore most recent archive     |
| `focus_canvas_search`                 | `/`                   | Focus canvas search             |
| `toggle_terminal`                     | `Cmd+Backquote`       | Show/hide terminal              |
| `toggle_browser`                      | `Cmd+Shift+Backquote` | Show/hide browser side pane     |
| `toggle_session_label`                | `Cmd+S`               | Toggle session label            |
| `toggle_parallel_execution_prompting` | `Cmd+Alt+P`           | Toggle parallel prompting       |
| `open_provider_dropdown`              | `Cmd+Shift+P`         | Open provider dropdown          |
| `open_model_dropdown`                 | `Cmd+Shift+M`         | Open model dropdown             |
| `open_thinking_dropdown`              | `Cmd+Shift+E`         | Open thinking/effort dropdown   |
| `open_unread_sessions`                | `Cmd+Shift+F`         | Open finished/unread sessions   |
| `cancel_prompt`                       | `Cmd+Alt+Backspace`   | Cancel current prompt           |
| `scroll_chat_up`                      | `Cmd+Up`              | Scroll chat up one page         |
| `scroll_chat_down`                    | `Cmd+Down`            | Scroll chat down one page       |
| `scroll_chat_up_small`                | `Up`                  | Scroll chat up a small amount   |
| `scroll_chat_down_small`              | `Down`                | Scroll chat down a small amount |
| `open_github_dashboard`               | `Cmd+Shift+D`         | Open GitHub dashboard           |
| `open_quick_menu`                     | `Cmd+.`               | Open quick menu                 |
| `open_usage_dropdown`                 | `Cmd+U`               | Open usage dropdown             |
| `open_agent_board`                    | `Cmd+Shift+A`         | Open agent board                |
| `new_agent_todo`                      | `Cmd+Alt+A`           | Create an agent board todo      |

**Note:** `Cmd` on Mac, `Ctrl` on Windows/Linux.

## Architecture

### TypeScript Type Definitions

All keybinding actions, defaults, display metadata, formatting helpers, and keyboard-event parsing live in `src/types/keybindings.ts`:

```typescript
// Shortcut string format: "mod+key" or "mod+shift+key"
export type ShortcutString = string

// Stored in preferences
export type KeybindingsMap = Record<string, ShortcutString>
```

### Default Keybindings

```typescript
export const DEFAULT_KEYBINDINGS: KeybindingsMap = {
  focus_chat_input: 'mod+l',
  toggle_left_sidebar: 'mod+b',
  open_new_project_dialog: 'mod+shift+n',
  open_preferences: 'mod+comma',
  open_commit_modal: 'mod+shift+c',
  open_git_diff: 'mod+g',
  execute_run: 'mod+r',
  open_in_modal: 'mod+o',
  open_magic_modal: 'mod+m',
  new_session: 'mod+t',
  next_session: 'mod+alt+arrowright',
  previous_session: 'mod+alt+arrowleft',
  close_session_or_worktree: 'mod+w',
  new_worktree: 'mod+n',
  cycle_execution_mode: 'shift+tab',
  approve_plan: 'mod+enter',
  // ... see src/types/keybindings.ts for the complete current set
  restore_last_archived: 'mod+shift+t',
}
```

### Centralized Event Handler

All keyboard shortcuts are managed in `useMainWindowEventListeners.ts`:

```typescript
export function useMainWindowEventListeners() {
  const commandContext = useCommandContext()
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()

  // Keep keybindings in a ref so the event handler always has the latest
  const keybindingsRef = useRef<KeybindingsMap>(DEFAULT_KEYBINDINGS)

  // Update ref when preferences change
  useEffect(() => {
    keybindingsRef.current = preferences?.keybindings ?? DEFAULT_KEYBINDINGS
  }, [preferences?.keybindings])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Convert the keyboard event to our shortcut string format
      const shortcut = eventToShortcutString(e)
      if (!shortcut) return

      // Look up matching action in keybindings
      const keybindings = keybindingsRef.current
      for (const [action, binding] of Object.entries(keybindings)) {
        if (binding === shortcut) {
          e.preventDefault()
          executeKeybindingAction(
            action as KeybindingAction,
            commandContext,
            queryClient
          )
          return
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [commandContext, queryClient])
}
```

### Action Execution

Each action is handled in the `executeKeybindingAction` function:

```typescript
function executeKeybindingAction(
  action: KeybindingAction,
  commandContext: ReturnType<typeof useCommandContext>,
  queryClient: QueryClient
) {
  switch (action) {
    case 'focus_chat_input':
      window.dispatchEvent(new CustomEvent('focus-chat-input'))
      break
    case 'toggle_left_sidebar': {
      const { leftSidebarVisible, setLeftSidebarVisible } =
        useUIStore.getState()
      setLeftSidebarVisible(!leftSidebarVisible)
      break
    }
    case 'open_preferences':
      commandContext.openPreferences()
      break
    // ... etc for all actions
  }
}
```

## Keybinding Migration

When default keybindings change, the `migrateKeybindings` function ensures users get the new defaults if they haven't customized them:

```typescript
// src/services/preferences.ts

// Old default keybindings that have been changed - used for migration
const MIGRATED_KEYBINDINGS: Partial<Record<keyof KeybindingsMap, string>> = {
  toggle_left_sidebar: 'mod+1', // Changed to 'mod+b'
}

// Migrate keybindings: if a stored value matches an old default, use the new default
function migrateKeybindings(
  stored: KeybindingsMap | undefined
): KeybindingsMap {
  if (!stored) return DEFAULT_KEYBINDINGS

  const migrated = { ...stored }
  for (const [action, oldDefault] of Object.entries(MIGRATED_KEYBINDINGS)) {
    if (stored[action] === oldDefault) {
      // User had the old default, update to new default
      const newDefault = DEFAULT_KEYBINDINGS[action]
      if (newDefault) {
        migrated[action] = newDefault
      }
    }
  }
  return migrated
}
```

**Key insight:** This pattern preserves user customizations while updating defaults. If a user explicitly chose `mod+1`, they keep it. If they were using the old default, they get the new one.

## Persistence

Keybindings are stored in `preferences.json` via the Rust backend:

```rust
// src-tauri/src/lib.rs
pub struct AppPreferences {
    // ... other fields
    #[serde(default = "default_keybindings")]
    pub keybindings: std::collections::HashMap<String, String>,
}

fn default_keybindings() -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    map.insert("focus_chat_input".to_string(), "mod+l".to_string());
    map.insert("toggle_left_sidebar".to_string(), "mod+1".to_string());
    // ... etc
    map
}
```

The Rust defaults are a compatibility seed for persisted preferences. The frontend merges loaded preferences with `DEFAULT_KEYBINDINGS`, migrates changed defaults in `src/services/preferences.ts`, and drops stale keys.

## Shortcut String Format

The format uses `mod` as a platform-agnostic modifier:

- `mod+key` → `Cmd+key` on Mac, `Ctrl+key` on Windows/Linux
- `mod+shift+key` → `Cmd+Shift+key` on Mac, `Ctrl+Shift+key` on Windows/Linux
- `shift+tab` → No modifier, just Shift+Tab

### Helper Functions

```typescript
// Convert keyboard event to shortcut string
export function eventToShortcutString(e: KeyboardEvent): ShortcutString | null {
  // Ignore modifier-only presses
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
    return null
  }

  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  // Normalize key names
  let key = e.key.toLowerCase()
  if (key === ',') key = 'comma'
  // ... other normalizations

  parts.push(key)
  return parts.join('+')
}

// Format shortcut for display in UI
export function formatShortcutDisplay(shortcut: ShortcutString): string {
  const isMac = navigator.platform.includes('Mac')

  return shortcut
    .split('+')
    .map(part => {
      switch (part) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl'
        case 'shift':
          return isMac ? '⇧' : 'Shift'
        case 'alt':
          return isMac ? '⌥' : 'Alt'
        case 'comma':
          return ','
        default:
          return part.toUpperCase()
      }
    })
    .join(' + ')
}
```

## Why Native DOM Events Instead of react-hotkeys-hook

We initially tried `react-hotkeys-hook` but encountered issues in the Tauri environment where shortcuts wouldn't fire consistently. Native DOM event listeners provide:

- **Reliable execution** in Tauri environment
- **Full control** over event handling
- **Better performance** with direct DOM access
- **Consistent behavior** across platforms

## Adding New Keybindings

### Step 1: Add Action Type

```typescript
// src/types/keybindings.ts
export type KeybindingAction =
  | /* existing actions */
  | 'my_new_action'
```

### Step 2: Add Default Binding

```typescript
// src/types/keybindings.ts
export const DEFAULT_KEYBINDINGS: KeybindingsMap = {
  // ... existing bindings
  my_new_action: 'mod+shift+m',
}
```

### Step 3: Add UI Definition

```typescript
// src/types/keybindings.ts
export const KEYBINDING_DEFINITIONS: KeybindingDefinition[] = [
  // ... existing definitions
  {
    action: 'my_new_action',
    label: 'My New Action',
    description: 'Does something new',
    default_shortcut: 'mod+shift+m',
    category: 'navigation',
  },
]
```

### Step 4: Handle Action

```typescript
// src/hooks/useMainWindowEventListeners.ts
function executeKeybindingAction(action: KeybindingAction, ...) {
  switch (action) {
    // ... existing cases
    case 'my_new_action':
      // Your implementation
      break
  }
}
```

### Step 5: Update Rust Defaults (optional)

```rust
// src-tauri/src/lib.rs
fn default_keybindings() -> std::collections::HashMap<String, String> {
    // ... existing bindings
    map.insert("my_new_action".to_string(), "mod+shift+m".to_string());
    map
}
```

## Best Practices

1. **Use standard conventions**: Follow platform conventions for common actions
2. **Document shortcuts**: Update this file and the settings UI
3. **Test across platforms**: Verify shortcuts work on macOS and Windows/Linux
4. **Avoid conflicts**: Check existing shortcuts before adding new ones
5. **Support migration**: Add to `MIGRATED_KEYBINDINGS` when changing defaults
6. **Use `mod` prefix**: Allows cross-platform compatibility
7. **Provide feedback**: Use notifications or UI changes to confirm execution
