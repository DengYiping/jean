import { describe, expect, it } from 'vitest'
import { resolveParallelExecutionPrompt } from './parallel-execution-prompt'
import { DEFAULT_PARALLEL_EXECUTION_PROMPT } from '@/types/preferences'

describe('resolveParallelExecutionPrompt', () => {
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
})
