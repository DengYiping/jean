import { describe, expect, it } from 'vitest'
import {
  computeSessionCardData,
  type ChatStoreState,
} from './session-card-utils'
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

function createStoreState(
  overrides: Partial<ChatStoreState> = {}
): ChatStoreState {
  return {
    sendingSessionIds: {},
    executingModes: {},
    executionModes: {},
    activeToolCalls: {},
    answeredQuestions: {},
    waitingForInputSessionIds: {},
    reviewingSessions: {},
    pendingPermissionDenials: {},
    sessionDigests: {},
    sessionLabels: {},
    ...overrides,
  }
}

describe('computeSessionCardData', () => {
  it('prefers local review state over stale persisted waiting state', () => {
    const session = createSession({
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      last_run_status: 'completed',
    })
    const storeState = createStoreState({
      reviewingSessions: { 'session-1': true },
    })

    const data = computeSessionCardData(session, storeState)

    expect(data.status).toBe('review')
    expect(data.isWaiting).toBe(false)
  })

  it('keeps waiting status when the local store still says waiting', () => {
    const session = createSession({
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      last_run_status: 'completed',
    })
    const storeState = createStoreState({
      reviewingSessions: { 'session-1': true },
      waitingForInputSessionIds: { 'session-1': true },
    })

    const data = computeSessionCardData(session, storeState)

    expect(data.status).toBe('waiting')
    expect(data.isWaiting).toBe(true)
  })

  it('drops stale pending plan metadata once the session is no longer waiting', () => {
    const session = createSession({
      waiting_for_input: false,
      waiting_for_input_type: 'plan',
      pending_plan_message_id: 'plan-msg-1',
      is_reviewing: true,
      last_run_status: 'completed',
    })
    const storeState = createStoreState({
      reviewingSessions: { 'session-1': true },
    })

    const data = computeSessionCardData(session, storeState)

    expect(data.status).toBe('review')
    expect(data.hasExitPlanMode).toBe(false)
    expect(data.pendingPlanMessageId).toBeNull()
  })

  it('uses backend-derived state for persisted waiting plan metadata', () => {
    const session = createSession({
      waiting_for_input: true,
      session_derived_state: {
        status: 'waiting',
        effective_execution_mode: 'plan',
        is_waiting: true,
        waiting_type: 'plan',
        has_question: false,
        has_exit_plan: true,
        pending_plan_message_id: 'plan-msg-1',
        plan_file_path: '/tmp/plan.md',
        plan_content: 'Implement the thing',
        permission_denial_count: 0,
        has_recap: false,
        latest_activity_at: 10,
        is_unread: true,
      },
    })

    const data = computeSessionCardData(session, createStoreState())

    expect(data.status).toBe('waiting')
    expect(data.hasExitPlanMode).toBe(true)
    expect(data.pendingPlanMessageId).toBe('plan-msg-1')
    expect(data.planFilePath).toBe('/tmp/plan.md')
    expect(data.planContent).toBe('Implement the thing')
  })
})
