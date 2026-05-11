import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/types/chat'
import { formatDuration, getAssistantDurationMs } from './time-utils'

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [59_999, '59s'],
    [60_000, '1m 00s'],
    [65_000, '1m 05s'],
    [3_599_000, '59m 59s'],
    [3_600_000, '1h 00m 00s'],
    [3_723_000, '1h 02m 03s'],
  ])('formats %dms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe('getAssistantDurationMs', () => {
  const messages: ChatMessage[] = [
    {
      id: 'user-1',
      session_id: 'session-1',
      role: 'user',
      content: 'Prompt',
      timestamp: 100,
      tool_calls: [],
    },
    {
      id: 'assistant-1',
      session_id: 'session-1',
      role: 'assistant',
      content: 'Reply',
      timestamp: 123,
      tool_calls: [],
    },
  ]

  it('prefers stored duration for the final assistant message', () => {
    expect(getAssistantDurationMs(messages, 1, 145_000)).toBe(145_000)
  })

  it('falls back to the user-to-assistant timestamp delta', () => {
    expect(getAssistantDurationMs(messages, 1, null)).toBe(23_000)
  })

  it('returns null for user messages', () => {
    expect(getAssistantDurationMs(messages, 0, 145_000)).toBeNull()
  })
})
