import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { chatQueryKeys } from '@/services/chat'
import type { Session, WorktreeSessions } from '@/types/chat'
import { applyOptimisticPlanApproval } from './optimistic-plan-approval'

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...overrides,
  }
}

describe('applyOptimisticPlanApproval', () => {
  it('clears waiting state and marks the approved message in both caches', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const session = createSession({
      waiting_for_input: true,
      waiting_for_input_type: 'plan',
      pending_plan_message_id: 'plan-msg-1',
      is_reviewing: true,
      approved_plan_message_ids: [],
      messages: [
        {
          id: 'plan-msg-1',
          session_id: 'session-1',
          role: 'assistant',
          content: '',
          timestamp: 1,
          tool_calls: [
            {
              id: 'tool-1',
              name: 'ExitPlanMode',
              input: { plan: '- [ ] Test' },
            },
          ],
          content_blocks: [],
          cancelled: false,
          plan_approved: false,
        },
      ],
    })
    const sessions: WorktreeSessions = {
      worktree_id: 'worktree-1',
      active_session_id: 'session-1',
      version: 2,
      sessions: [session],
    }

    queryClient.setQueryData(chatQueryKeys.session('session-1'), session)
    queryClient.setQueryData(chatQueryKeys.sessions('worktree-1'), sessions)

    applyOptimisticPlanApproval({
      queryClient,
      sessionId: 'session-1',
      worktreeId: 'worktree-1',
      messageId: 'plan-msg-1',
    })

    const updatedSession = queryClient.getQueryData<Session>(
      chatQueryKeys.session('session-1')
    )
    const updatedSessions = queryClient.getQueryData<WorktreeSessions>(
      chatQueryKeys.sessions('worktree-1')
    )

    expect(updatedSession?.waiting_for_input).toBe(false)
    expect(updatedSession?.waiting_for_input_type).toBeNull()
    expect(updatedSession?.pending_plan_message_id).toBeUndefined()
    expect(updatedSession?.is_reviewing).toBe(false)
    expect(updatedSession?.approved_plan_message_ids).toEqual(['plan-msg-1'])
    expect(updatedSession?.messages[0]?.plan_approved).toBe(true)

    expect(updatedSessions?.sessions[0]?.waiting_for_input).toBe(false)
    expect(updatedSessions?.sessions[0]?.waiting_for_input_type).toBeNull()
    expect(
      updatedSessions?.sessions[0]?.pending_plan_message_id
    ).toBeUndefined()
    expect(updatedSessions?.sessions[0]?.is_reviewing).toBe(false)
    expect(updatedSessions?.sessions[0]?.approved_plan_message_ids).toEqual([
      'plan-msg-1',
    ])
  })

  it('does not duplicate approved ids when re-applied', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const session = createSession({
      approved_plan_message_ids: ['plan-msg-1'],
      messages: [
        {
          id: 'plan-msg-1',
          session_id: 'session-1',
          role: 'assistant',
          content: '',
          timestamp: 1,
          tool_calls: [],
          content_blocks: [],
          cancelled: false,
          plan_approved: true,
        },
      ],
    })
    const sessions: WorktreeSessions = {
      worktree_id: 'worktree-1',
      active_session_id: 'session-1',
      version: 2,
      sessions: [session],
    }

    queryClient.setQueryData(chatQueryKeys.session('session-1'), session)
    queryClient.setQueryData(chatQueryKeys.sessions('worktree-1'), sessions)

    applyOptimisticPlanApproval({
      queryClient,
      sessionId: 'session-1',
      worktreeId: 'worktree-1',
      messageId: 'plan-msg-1',
    })

    expect(
      queryClient.getQueryData<Session>(chatQueryKeys.session('session-1'))
        ?.approved_plan_message_ids
    ).toEqual(['plan-msg-1'])
    expect(
      queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions('worktree-1')
      )?.sessions[0]?.approved_plan_message_ids
    ).toEqual(['plan-msg-1'])
  })
})
