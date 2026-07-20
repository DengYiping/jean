import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import type { ChatMessage } from '@/types/chat'
import {
  consumeReplayedText,
  hydrateRunningSnapshot,
} from './hydrate-running-snapshot'

const assistantMessage = (
  overrides: Partial<ChatMessage> = {}
): ChatMessage => ({
  id: 'running-session-1',
  session_id: 'session-1',
  role: 'assistant',
  content: '',
  timestamp: 1,
  tool_calls: [],
  content_blocks: [],
  ...overrides,
})

describe('hydrateRunningSnapshot', () => {
  beforeEach(() => {
    useChatStore.setState({
      sendingSessionIds: {},
      streamingContents: {},
      streamingContentBlocks: {},
      activeToolCalls: {},
      streamingThinkingContent: {},
    })
  })

  it('skips hydration while sending by default', () => {
    useChatStore.setState({
      sendingSessionIds: { 'session-1': true },
    })

    const hydrated = hydrateRunningSnapshot(
      'session-1',
      assistantMessage({
        content_blocks: [{ type: 'text', text: 'partial output' }],
      })
    )

    expect(hydrated).toBe(false)
    expect(
      useChatStore.getState().streamingContents['session-1']
    ).toBeUndefined()
    expect(
      useChatStore.getState().streamingContentBlocks['session-1']
    ).toBeUndefined()
  })

  it('hydrates running snapshots during reconnect when explicitly allowed', () => {
    useChatStore.setState({
      sendingSessionIds: { 'session-1': true },
    })

    const hydrated = hydrateRunningSnapshot(
      'session-1',
      assistantMessage({
        content_blocks: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
          { type: 'tool_use', tool_call_id: 'tool-1' },
        ],
        tool_calls: [
          {
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'git status' },
          },
        ],
      }),
      { allowWhileSending: true }
    )

    expect(hydrated).toBe(true)
    expect(useChatStore.getState().streamingContents['session-1']).toBe(
      'hello world'
    )
    expect(useChatStore.getState().streamingContentBlocks['session-1']).toEqual(
      [
        { type: 'text', text: 'hello world' },
        { type: 'tool_use', tool_call_id: 'tool-1' },
      ]
    )
    expect(useChatStore.getState().activeToolCalls['session-1']).toEqual([
      {
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'git status' },
      },
    ])
  })

  it('drops replayed output that is already in the hydrated snapshot', () => {
    hydrateRunningSnapshot(
      'session-1',
      assistantMessage({
        content_blocks: [{ type: 'text', text: 'hello world' }],
      }),
      { dedupeReplayedOutput: true }
    )

    expect(consumeReplayedText('session-1', 'hello ')).toBe('')
    expect(consumeReplayedText('session-1', 'world')).toBe('')
    expect(consumeReplayedText('session-1', ' next')).toBe(' next')
  })
})
