import { describe, expect, it } from 'vitest'
import { resolveSessionPersistenceContext } from './useSessionStatePersistence'

describe('resolveSessionPersistenceContext', () => {
  it('uses modal worktree context when no active worktree is set', () => {
    const result = resolveSessionPersistenceContext({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: { 'worktree-1': 'session-1' },
      modalWorktreeId: 'worktree-1',
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
    })

    expect(result).toEqual({
      activeSessionId: 'session-1',
      effectiveWorktreeId: 'worktree-1',
      effectiveWorktreePath: '/tmp/worktree-1',
    })
  })

  it('prefers the active worktree path when the main chat view is active', () => {
    const result = resolveSessionPersistenceContext({
      activeWorktreeId: 'worktree-1',
      activeWorktreePath: '/active/path',
      activeSessionIds: { 'worktree-1': 'session-1' },
      modalWorktreeId: 'worktree-2',
      worktreePaths: {
        'worktree-1': '/stored/path',
        'worktree-2': '/tmp/worktree-2',
      },
    })

    expect(result).toEqual({
      activeSessionId: 'session-1',
      effectiveWorktreeId: 'worktree-1',
      effectiveWorktreePath: '/active/path',
    })
  })
})
