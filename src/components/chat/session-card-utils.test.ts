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
    pendingCodexMcpElicitations: {},
    sessionDigests: {},
    sessionLabels: {},
    ...overrides,
  }
}

const createBaseSession = createSession
const createBaseStoreState = createStoreState

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

  it('does not keep waiting status for stale local question waits', () => {
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

    expect(data.status).toBe('review')
    expect(data.isWaiting).toBe(false)
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

  it('ignores stale Zustand waiting flag when session is completed and reviewing', () => {
    const session: Session = {
      ...createBaseSession(),
      waiting_for_input: false,
      is_reviewing: true,
      last_run_status: 'completed',
      last_run_execution_mode: 'plan',
    }
    const storeState = createBaseStoreState({
      waitingForInputSessionIds: { 'session-1': true },
      reviewingSessions: { 'session-1': true },
    })

    const card = computeSessionCardData(session, storeState)

    expect(card.isWaiting).toBe(false)
    expect(card.status).toBe('review')
  })

  it('ignores stale persisted waiting_for_input on completed non-plan run', () => {
    const session: Session = {
      ...createBaseSession(),
      waiting_for_input: true,
      waiting_for_input_type: null,
      last_run_status: 'completed',
      last_run_execution_mode: 'yolo',
    }
    const storeState = createBaseStoreState()

    const card = computeSessionCardData(session, storeState)

    expect(card.isWaiting).toBe(false)
    expect(card.status).not.toBe('waiting')
  })

  it('ignores stale local waiting state on completed non-plan runs', () => {
    const session: Session = {
      ...createBaseSession(),
      waiting_for_input: false,
      waiting_for_input_type: null,
      last_run_status: 'completed',
      last_run_execution_mode: 'yolo',
    }
    const storeState = createBaseStoreState({
      waitingForInputSessionIds: { 'session-1': true },
    })

    const card = computeSessionCardData(session, storeState)

    expect(card.isWaiting).toBe(false)
    expect(card.status).toBe('idle')
  })

  it('honors persisted waiting_for_input when run paused for plan approval', () => {
    const session: Session = {
      ...createBaseSession(),
      waiting_for_input: true,
      waiting_for_input_type: 'plan',
      last_run_status: 'completed',
      last_run_execution_mode: 'plan',
    }
    const storeState = createBaseStoreState()

    const card = computeSessionCardData(session, storeState)

    expect(card.isWaiting).toBe(true)
    expect(card.status).toBe('waiting')
  })

  it('honors persisted waiting_for_input while run still active', () => {
    const session: Session = {
      ...createBaseSession(),
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      last_run_status: 'running',
      last_run_execution_mode: 'plan',
    }
    const storeState = createBaseStoreState()

    const card = computeSessionCardData(session, storeState)

    expect(card.isWaiting).toBe(true)
    expect(card.status).toBe('waiting')
  })
})
