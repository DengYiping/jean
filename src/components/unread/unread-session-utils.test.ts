import { describe, expect, it } from 'vitest'
import type { Session } from '@/types/chat'
import {
  getUnreadSessionStatus,
  hasPendingPermissionRequest,
  isUnreadSession,
} from './unread-session-utils'

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    order: 0,
    created_at: 1,
    updated_at: 10,
    messages: [],
    ...overrides,
  }
}

describe('unread-session-utils', () => {
  it('treats pending permission denials as actionable unread state', () => {
    const session = createSession({
      pending_permission_denials: [
        {
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          tool_input: { command: 'echo test' },
        },
      ],
    })

    expect(hasPendingPermissionRequest(session)).toBe(true)
    expect(isUnreadSession(session)).toBe(true)
  })

  it('returns a permission-specific status before generic waiting state', () => {
    const session = createSession({
      waiting_for_input: true,
      waiting_for_input_type: null,
      pending_permission_denials: [
        {
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          tool_input: { command: 'echo test' },
        },
      ],
    })

    expect(getUnreadSessionStatus(session)).toMatchObject({
      label: 'Needs permission',
      className: 'text-amber-500',
    })
  })

  it('treats question waits as unread and labels them as needing input', () => {
    const session = createSession({
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      last_run_status: 'resumable',
    })

    expect(isUnreadSession(session)).toBe(true)
    expect(getUnreadSessionStatus(session)).toMatchObject({
      label: 'Needs input',
      className: 'text-yellow-500',
    })
  })

  it('does not count already-opened idle sessions as unread', () => {
    const session = createSession({
      last_opened_at: 10,
      updated_at: 10,
    })

    expect(isUnreadSession(session)).toBe(false)
  })
})
