import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/transport'
import { chatQueryKeys } from '@/services/chat'
import type { WorktreeSessions } from '@/types/chat'
import { closeOriginalApprovedSession } from './close-original-approved-session'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

describe('closeOriginalApprovedSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(null)
  })

  it('does nothing when the preference is disabled', () => {
    const queryClient = new QueryClient()

    closeOriginalApprovedSession({
      queryClient,
      preferences: {
        close_original_on_clear_context: false,
        removal_behavior: 'archive',
      },
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      logContext: 'test',
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryData(chatQueryKeys.sessions('worktree-1'))
    ).toBeUndefined()
  })

  it('optimistically removes the original session and replaces the active session when provided', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorktreeSessions>(
      chatQueryKeys.sessions('worktree-1'),
      {
        sessions: [
          { id: 'session-1', name: 'Old' },
          { id: 'session-2', name: 'New' },
        ],
        active_session_id: 'session-1',
      } as WorktreeSessions
    )

    closeOriginalApprovedSession({
      queryClient,
      preferences: {
        close_original_on_clear_context: true,
        removal_behavior: 'archive',
      },
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      replacementSessionId: 'session-2',
      logContext: 'test',
    })

    expect(
      queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions('worktree-1')
      )
    ).toMatchObject({
      sessions: [{ id: 'session-2', name: 'New' }],
      active_session_id: 'session-2',
    })
    expect(invoke).toHaveBeenCalledWith('archive_session', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
    })
  })

  it('uses close_session and leaves active session unchanged without a replacement', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorktreeSessions>(
      chatQueryKeys.sessions('worktree-1'),
      {
        sessions: [
          { id: 'session-1', name: 'Old' },
          { id: 'session-2', name: 'Other' },
        ],
        active_session_id: 'session-1',
      } as WorktreeSessions
    )

    closeOriginalApprovedSession({
      queryClient,
      preferences: {
        close_original_on_clear_context: true,
        removal_behavior: 'delete',
      },
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      logContext: 'test',
    })

    expect(
      queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions('worktree-1')
      )
    ).toMatchObject({
      sessions: [{ id: 'session-2', name: 'Other' }],
      active_session_id: 'session-1',
    })
    expect(invoke).toHaveBeenCalledWith('close_session', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
    })
  })
})
