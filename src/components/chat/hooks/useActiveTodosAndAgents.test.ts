import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useActiveTodosAndAgents } from './useActiveTodosAndAgents'
import type { ToolCall } from '@/types/chat'

describe('useActiveTodosAndAgents', () => {
  it('aggregates Codex sub-agent progress across collab tool calls', () => {
    const currentToolCalls: ToolCall[] = [
      {
        id: 'spawn-1',
        name: 'SpawnAgent',
        input: {
          prompt: 'Investigate auth timeout in CI',
          status: 'completed',
          receiverThreadIds: ['agent-1'],
          agentsStates: {
            'agent-1': {
              status: 'running',
              message: 'Inspecting failing tests',
            },
          },
        },
      },
      {
        id: 'spawn-2',
        name: 'SpawnAgent',
        input: {
          prompt: 'Trace websocket disconnect path',
          status: 'completed',
          receiverThreadIds: ['agent-2'],
          agentsStates: {
            'agent-2': {
              status: 'running',
              message: 'Reading logs',
            },
          },
        },
      },
      {
        id: 'wait-1',
        name: 'WaitForAgents',
        input: {
          status: 'completed',
          receiverThreadIds: ['agent-1', 'agent-2'],
          agentsStates: {
            'agent-1': {
              status: 'completed',
              message: 'Found flaky assertion',
            },
            'agent-2': {
              status: 'errored',
              message: 'Context window exceeded',
            },
          },
        },
      },
    ]

    const { result } = renderHook(() =>
      useActiveTodosAndAgents({
        activeSessionId: 'session-1',
        isSending: true,
        currentToolCalls,
        lastAssistantMessage: undefined,
      })
    )

    expect(result.current.activeAgents).toEqual([
      {
        id: 'agent-1',
        name: 'Agent agent-1',
        prompt: 'Investigate auth timeout in CI',
        status: 'completed',
        message: 'Completed: Found flaky assertion',
      },
      {
        id: 'agent-2',
        name: 'Agent agent-2',
        prompt: 'Trace websocket disconnect path',
        status: 'errored',
        message: 'Errored: Context window exceeded',
      },
    ])
  })

  it('shows provisional spawn progress before the receiver thread is known', () => {
    const currentToolCalls: ToolCall[] = [
      {
        id: 'spawn-1',
        name: 'SpawnAgent',
        input: {
          prompt: 'Look at the migration failure',
          status: 'inProgress',
        },
      },
    ]

    const { result } = renderHook(() =>
      useActiveTodosAndAgents({
        activeSessionId: 'session-1',
        isSending: true,
        currentToolCalls,
        lastAssistantMessage: undefined,
      })
    )

    expect(result.current.activeAgents).toEqual([
      {
        id: 'spawn-1',
        name: 'Agent spawn-1',
        prompt: 'Look at the migration failure',
        status: 'in_progress',
        message: 'Starting',
      },
    ])
  })

  it('treats completed closeAgent calls as closed even with stale running state', () => {
    const currentToolCalls: ToolCall[] = [
      {
        id: 'spawn-1',
        name: 'SpawnAgent',
        input: {
          prompt: 'Inspect docs',
          status: 'completed',
          receiver_thread_ids: ['agent-1'],
          agents_states: {
            'agent-1': {
              status: 'running',
            },
          },
        },
      },
      {
        id: 'close-1',
        name: 'closeAgent',
        input: {
          status: 'completed',
          receiver_thread_ids: ['agent-1'],
          agents_states: {
            'agent-1': {
              status: 'running',
            },
          },
        },
      },
    ]

    const { result } = renderHook(() =>
      useActiveTodosAndAgents({
        activeSessionId: 'session-1',
        isSending: true,
        currentToolCalls,
        lastAssistantMessage: undefined,
      })
    )

    expect(result.current.activeAgents).toEqual([
      {
        id: 'agent-1',
        name: 'Agent agent-1',
        prompt: 'Inspect docs',
        status: 'completed',
        message: 'Closed',
      },
    ])
  })
})
