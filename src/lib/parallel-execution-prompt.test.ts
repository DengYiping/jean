import { beforeEach, describe, expect, it } from 'vitest'
import { queryClient } from './query-client'
import { resolveParallelExecutionPrompt } from './parallel-execution-prompt'
import { resolveParallelExecutionPromptForSession } from './parallel-execution-prompt'
import { DEFAULT_PARALLEL_EXECUTION_PROMPT } from '@/types/preferences'
import { useChatStore } from '@/store/chat-store'

describe('resolveParallelExecutionPrompt', () => {
  beforeEach(() => {
    queryClient.clear()
    useChatStore.setState({
      parallelExecutionPromptEnabledBySession: {},
    })
  })

  it('falls back to the global preference when the session has no override', () => {
    expect(
      resolveParallelExecutionPrompt(undefined, {
        parallel_execution_prompt_enabled: true,
        magic_prompts: { parallel_execution: 'custom parallel prompt' },
      })
    ).toBe('custom parallel prompt')
  })

  it('disables the prompt when the session override is false', () => {
    expect(
      resolveParallelExecutionPrompt(false, {
        parallel_execution_prompt_enabled: true,
        magic_prompts: { parallel_execution: 'custom parallel prompt' },
      })
    ).toBeUndefined()
  })

  it('uses the default prompt when enabled without a custom prompt', () => {
    expect(
      resolveParallelExecutionPrompt(true, {
        parallel_execution_prompt_enabled: false,
        magic_prompts: { parallel_execution: null },
      })
    ).toBe(DEFAULT_PARALLEL_EXECUTION_PROMPT)
  })

  it('uses the session override when the global preference is disabled', () => {
    useChatStore.setState({
      parallelExecutionPromptEnabledBySession: {
        'session-1': true,
      },
    })

    expect(
      resolveParallelExecutionPromptForSession('session-1', {
        parallel_execution_prompt_enabled: false,
        magic_prompts: { parallel_execution: 'session parallel prompt' },
      })
    ).toBe('session parallel prompt')
  })

  it('falls back to cached session data when the store has not hydrated yet', () => {
    queryClient.setQueryData(['chat', 'sessions', 'worktree-1'], {
      worktree_id: 'worktree-1',
      active_session_id: 'session-1',
      version: 2,
      sessions: [
        {
          id: 'session-1',
          name: 'Session 1',
          backend: 'codex',
          parallel_execution_prompt_enabled: true,
          messages: [],
        },
      ],
    })

    expect(
      resolveParallelExecutionPromptForSession('session-1', {
        parallel_execution_prompt_enabled: false,
        magic_prompts: { parallel_execution: null },
      })
    ).toBe(DEFAULT_PARALLEL_EXECUTION_PROMPT)
  })
})
