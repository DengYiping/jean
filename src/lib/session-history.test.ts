import { describe, expect, it } from 'vitest'
import type { ChatMessage, Session } from '@/types/chat'
import { mergeSessionHistory, prependSessionHistory } from './session-history'

function message(
  id: string,
  timestamp: number,
  content = id,
  role: ChatMessage['role'] = 'assistant'
): ChatMessage {
  return { id, session_id: 'session', role, timestamp, content, tool_calls: [] }
}
function session(messages: ChatMessage[], start = 0): Session {
  return {
    id: 'session',
    name: 'Session',
    order: 0,
    created_at: 0,
    updated_at: 0,
    messages,
    loaded_run_start_index: start,
    total_runs: 60,
  }
}
describe('paged session history', () => {
  it('updates the recent tail while keeping older pages', () => {
    const cached = {
      ...session([message('old', 1), message('overlap', 2, 'partial')], 0),
      history_expanded: true,
    }
    const fresh = session(
      [message('overlap', 2, 'complete'), message('new', 3)],
      20
    )
    const result = mergeSessionHistory(fresh, cached)
    expect(result.messages.map(m => m.content)).toEqual([
      'old',
      'complete',
      'new',
    ])
    expect(result.loaded_run_start_index).toBe(0)
  })
  it('preserves a pending user message but removes it once persisted', () => {
    const cached = session([
      message('reply', 1),
      message('optimistic', 2, 'hello', 'user'),
    ])
    expect(
      mergeSessionHistory(session([message('reply', 1)]), cached, true).messages
    ).toHaveLength(2)
    const fresh = session([
      message('reply', 1),
      message('persisted', 2, 'hello', 'user'),
    ])
    expect(
      mergeSessionHistory(fresh, cached, true).messages.map(m => m.id)
    ).toEqual(['reply', 'persisted'])
  })
  it('returns a reloadable recent window when reconnecting across a history gap', () => {
    const cached = {
      ...session([message('old', 1)]),
      total_runs: 20,
      history_expanded: true,
    }
    const result = mergeSessionHistory(
      session([message('new', 100)], 60),
      cached
    )
    expect(result.messages.map(m => m.id)).toEqual(['new'])
    expect(result.loaded_run_start_index).toBe(60)
    expect(result.history_expanded).toBe(false)
  })
  it('deduplicates late pages without overwriting newer status or messages', () => {
    const current = {
      ...session([message('overlap', 2, 'new')], 20),
      waiting_for_input: true,
    }
    const result = prependSessionHistory(
      session([message('old', 1), message('overlap', 2, 'stale')]),
      current
    )
    expect(result.messages.map(m => m.content)).toEqual(['old', 'new'])
    expect(result.waiting_for_input).toBe(true)
    expect(result.loaded_run_start_index).toBe(0)
  })
  it('keeps a bounded refreshed window when the user has not loaded older pages', () => {
    const cached = session([message('old', 1), message('overlap', 2)], 20)
    const fresh = session([message('overlap', 2), message('new', 3)], 21)
    expect(mergeSessionHistory(fresh, cached).messages.map(m => m.id)).toEqual([
      'overlap',
      'new',
    ])
  })
})
