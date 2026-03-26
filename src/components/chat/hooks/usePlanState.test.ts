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

function createQuestionAndPlanMessage(id = 'plan-msg-1') {
  return {
    id,
    session_id: 'session-1',
    role: 'assistant' as const,
    content: '',
    timestamp: 1,
    tool_calls: [
      {
        id: 'question-1',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Which path?' }] },
      },
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
        isQuestionAnswered: vi.fn(() => false),
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
        isQuestionAnswered: vi.fn(() => false),
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
        isQuestionAnswered: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage?.id).toBe('plan-msg-2')
  })

  it('keeps a persisted codex plan pending when the session is reopened', () => {
    const session = createSession({
      backend: 'codex',
      waiting_for_input: true,
      waiting_for_input_type: 'plan',
      pending_plan_message_id: 'plan-msg-1',
      is_reviewing: false,
      messages: [createPlanMessage()],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
        isQuestionAnswered: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage?.id).toBe('plan-msg-1')
  })

  it('falls back to the latest terminal plan when waiting metadata points to a stale message id', () => {
    const session = createSession({
      backend: 'codex',
      waiting_for_input: true,
      waiting_for_input_type: 'plan',
      pending_plan_message_id: 'missing-plan-msg',
      is_reviewing: false,
      messages: [createPlanMessage('plan-msg-2')],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
        isQuestionAnswered: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage?.id).toBe('plan-msg-2')
  })

  it('recovers the latest completed plan-mode message when waiting metadata is missing', () => {
    const session = createSession({
      waiting_for_input: false,
      is_reviewing: false,
      selected_execution_mode: 'plan',
      last_run_status: 'completed',
      last_run_execution_mode: 'plan',
      messages: [createPlanMessage()],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
        isQuestionAnswered: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage?.id).toBe('plan-msg-1')
  })

  it('does not recover stale plan history after a build-mode completion', () => {
    const session = createSession({
      waiting_for_input: false,
      is_reviewing: true,
      selected_execution_mode: 'build',
      last_run_status: 'completed',
      last_run_execution_mode: 'build',
      messages: [
        createPlanMessage(),
        {
          id: 'build-msg-1',
          session_id: 'session-1',
          role: 'assistant' as const,
          content: 'Implemented the fix.',
          timestamp: 2,
          tool_calls: [],
          content_blocks: [],
          cancelled: false,
          plan_approved: false,
        },
      ],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
        isQuestionAnswered: vi.fn(() => false),
      })
    )

    expect(result.current.pendingPlanMessage).toBeNull()
  })

  it('surfaces plan approval once mixed-message questions are answered', () => {
    const session = createSession({
      backend: 'codex',
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      pending_plan_message_id: 'plan-msg-1',
      is_reviewing: false,
      messages: [createQuestionAndPlanMessage()],
    })

    const { result } = renderHook(() =>
      usePlanState({
        session,
        currentToolCalls: [],
        isSending: false,
        activeSessionId: 'session-1',
        isStreamingPlanApproved: vi.fn(() => false),
        isQuestionAnswered: vi.fn(
          (_sessionId, toolCallId) => toolCallId === 'question-1'
        ),
      })
    )

    expect(result.current.pendingPlanMessage?.id).toBe('plan-msg-1')
  })
})
