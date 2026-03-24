import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@/test/test-utils'
import { usePlanState } from './usePlanState'
import type { Session } from '@/types/chat'

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

function createPlanMessage(id = 'plan-msg-1') {
  return {
    id,
    session_id: 'session-1',
    role: 'assistant' as const,
    content: '',
    timestamp: 1,
    tool_calls: [
      { id: 'tool-1', name: 'ExitPlanMode', input: { plan: '- [ ] Test' } },
    ],
    content_blocks: [],
    cancelled: false,
    plan_approved: false,
  }
}

describe('usePlanState', () => {
  it('treats approved_plan_message_ids as approved for persisted plans', () => {
    const session = createSession({
      waiting_for_input: true,
      waiting_for_input_type: 'plan',
      pending_plan_message_id: 'plan-msg-1',
      approved_plan_message_ids: ['plan-msg-1'],
      messages: [createPlanMessage()],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage).toBeNull()
  })

  it('drops stale pending plan metadata once the session is no longer waiting', () => {
    const session = createSession({
      waiting_for_input: false,
      waiting_for_input_type: 'plan',
      pending_plan_message_id: 'plan-msg-1',
      messages: [createPlanMessage()],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage).toBeNull()
  })

  it('returns the latest unresolved plan when the session is actively waiting', () => {
    const session = createSession({
      waiting_for_input: true,
      waiting_for_input_type: 'plan',
      messages: [
        createPlanMessage('plan-msg-1'),
        {
          id: 'user-1',
          session_id: 'session-1',
          role: 'user' as const,
          content: 'follow-up',
          timestamp: 2,
          tool_calls: [],
          content_blocks: [],
          cancelled: false,
          plan_approved: false,
        },
        createPlanMessage('plan-msg-2'),
      ],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage?.id).toBe('plan-msg-2')
  })
})
