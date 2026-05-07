# Stable Worktree Slots

Stable worktree slots are reusable project-local paths for worktrees that benefit from keeping heavyweight local artifacts between runs.

## Lifecycle

- Active slots are real Git worktrees and must contain valid Git metadata.
- Idle slots are reserved paths. They may be missing, empty, or contain only preserved heavyweight directories.
- Slotted delete removes the Git worktree and branch, then restores only preserved heavyweight directories to the slot path.
- Slotted archive moves the Git worktree to a normal archive path, clears `stable_slot_id` on the archived worktree, and restores preserved heavyweight directories to the original slot path.
- The next slotted worktree that reuses an idle slot temporarily moves preserved directories aside, creates a fresh Git worktree at the same path, then moves preserved directories back.

## Preserved Directories

The stable-slot cleanup path preserves these top-level directories:

- `target`
- `.idea`
- `node_modules`
- `.venv`
- `venv`
- `.gradle`
- `build`
- `dist`
- `.next`
- `.pnpm-store`
- `.bun`

Do not preserve `.git`, source files, config files, or arbitrary untracked files during slotted delete/archive. The slot should keep expensive local artifacts, not a stale working tree.

## Implementation Notes

- Use `src-tauri/src/projects/slots.rs` for stable-slot lifecycle logic.
- Route slotted cleanup entrypoints through `release_slot_for_worktree` or the archive restore helper so manual cleanup, merge cleanup, automation cleanup, and Agent Board cleanup stay consistent.
- Reconciliation should only require `.git` for active slots with live worktree records. Idle preserved-directory slots must not be marked as `"Slot path no longer exists"`.
