# Performance Patterns

### The `getState()` Pattern (Critical)

**Problem**: Subscribing to frequently-changing store data in component callbacks causes render cascades.

**Solution**: Subscribe only to data that should trigger re-renders. For callbacks that need current state, use `getState()`.

```typescript
// ❌ BAD: Causes render cascade on every keystroke
const { currentFile, isDirty, saveFile } = useEditorStore()

const handleSave = useCallback(() => {
  if (currentFile && isDirty) {
    void saveFile()
  }
}, [currentFile, isDirty, saveFile]) // Re-creates on every change!

// ✅ GOOD: No cascade, stable callback
const { setEditorContent } = useEditorStore() // Only subscribe to needed actions

const handleSave = useCallback(() => {
  const { currentFile, isDirty, saveFile } = useEditorStore.getState()
  if (currentFile && isDirty) {
    void saveFile()
  }
}, []) // Stable dependency array
```

### When to Use `getState()` Pattern

1. **In useCallback dependencies**: When you need current state but don't want re-renders
2. **In event handlers**: For accessing latest state without subscriptions
3. **In useEffect with empty deps**: When you need current state on mount only
4. **In async operations**: When state might change during execution

### Store Subscription Optimization

```typescript
// ❌ BAD: Object destructuring triggers re-renders
const { currentFile } = useEditorStore()

// ✅ GOOD: Primitive selectors only change when needed
const hasCurrentFile = useEditorStore(state => !!state.currentFile)
const currentFileName = useEditorStore(state => state.currentFile?.name)
```

### CSS Visibility vs Conditional Rendering

For stateful UI components (like `react-resizable-panels`), use CSS visibility:

```typescript
// ❌ BAD: Conditional rendering breaks stateful components
{sidebarVisible ? <ResizablePanel /> : null}

// ✅ GOOD: CSS visibility preserves component tree
<ResizablePanel className={sidebarVisible ? '' : 'hidden'} />
```

### Strategic React.memo Placement

Use React.memo to break render cascades at component boundaries:

```typescript
// ✅ GOOD: Breaks cascade propagation
const EditorArea = React.memo(({ panelVisible }) => {
  // Component only re-renders when panelVisible changes
  // Not affected by parent re-renders from unrelated state
})
```

### Profiling Hot Paths

Profile the user workflow, not a helper in isolation. Start from a concrete hot
path such as "click an existing worktree in the sidebar and open its session
modal", then build the smallest test harness that exercises that path with warm
cache/state.

Use React Profiler in targeted component tests to count update commits and
capture `actualDuration`:

```typescript
const renderStats: Record<string, { updates: number; actualDuration: number }> =
  {}

const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
  const stat = (renderStats[id] ??= { updates: 0, actualDuration: 0 })
  if (phase === 'update') {
    stat.updates += 1
    stat.actualDuration += actualDuration
  }
}

render(
  <Profiler id="worktree-1" onRender={onRender}>
    <WorktreeItem worktree={worktree} projectId={projectId} />
  </Profiler>
)
```

Make profiling output opt-in so normal test runs stay quiet:

```typescript
if (process.env.PROFILE_WORKTREE_SWITCH_TEST === '1') {
  console.info('[profile] Worktree switch render stats', renderStats)
}
```

Prefer stable assertions over wall-clock timing:

- Assert unaffected rows/components do not re-render.
- Assert affected rows/components stay under a small commit-count budget.
- Assert warm TanStack Query cache entries are reused without invoking IPC.
- Assert duplicated query keys or refetches do not appear on repeated switches.
- Avoid hard `actualDuration` thresholds in Vitest/jsdom; use duration output for
  diagnosis, not pass/fail, unless the threshold is very coarse and stable.

When profiling a Zustand-heavy path, map each commit back to store writes. If a
single click calls several actions, such as `selectProject`, `selectWorktree`,
`clearActiveWorktree`, and `setActiveSession`, expect multiple commits for the
clicked/previously selected rows. The useful regression boundary is whether
unrelated rows also update.

When profiling a TanStack Query path, check both the query key and the fetch
function:

- Shared query keys should reuse warm cache data.
- `staleTime` should match the normal hook if the data shape is the same.
- Extra flags like `includeMessageCounts` should only be present when the UI
  actually consumes the heavier data.

Run focused profiling separately from the required quality gate:

```bash
PROFILE_WORKTREE_SWITCH_TEST=1 bun run test:run src/components/projects/WorktreeItem.test.tsx --reporter verbose --logHeapUsage
bun run check:all
```

---

### Bounded chat history and agent inspection

Interactive chat uses `get_session_history`, which parses at most 20 runs per
request. The load-older button requests the preceding page using `beforeRunIndex`;
programmatic scrolling and search do not trigger additional history reads. Keep `get_session` for explicit
full-history workflows such as copying context into a new worktree. Both commands
are available through native and browser transports.

The session query merges fresh recent messages with explicitly requested older
pages, replacing overlapping messages with authoritative backend data. The
`history_expanded` flag exists only in the frontend query cache; it is not session
persistence. Without that flag, refreshes keep a bounded recent window. Session
query defaults expire inactive history after one minute, including entries seeded
by browser bootstrap. Pending user messages are preserved only while sending.

Both chat layouts use `useMessageVirtualizer` with TanStack Virtual. Rows have
stable keys and measured heights; prepending a page preserves the visible anchor.
Only the viewport and three overscan rows on each side stay mounted. The parent
scroll hook still controls following the live tail. Search uses loaded message
data and navigates via the virtualizer, so it can find unmounted messages. Users
can load older pages before searching older history.

Codex summaries load recent history once and refresh through existing completion
invalidation. Live tool events update agent status without polling parent history.
Only an open agent dialog fetches that agent's thread snapshot; its refresh timer
stops when the dialog closes. Avoid fetching all agent snapshots for badges or
collapsed panels.

Regression coverage includes `MessageVirtualization.test.tsx`,
`chat-history.test.tsx`, `session-history.test.ts`, and the browser test
`chat-history-performance.spec.ts`.
