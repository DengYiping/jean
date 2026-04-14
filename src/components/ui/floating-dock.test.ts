import { describe, expect, it } from 'vitest'
import type { ThreadTokenUsage } from '@/types/chat'
import {
  computeContextPercent,
  getFloatingDockUsageTotals,
} from './floating-dock'

describe('getFloatingDockUsageTotals', () => {
  it('uses Codex last-turn usage instead of summing prior turns', () => {
    const threadTokenUsage: ThreadTokenUsage = {
      total: {
        totalTokens: 812_700,
        inputTokens: 406_000,
        cachedInputTokens: 405_500,
        outputTokens: 1_200,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 68_500,
        inputTokens: 400,
        cachedInputTokens: 66_900,
        outputTokens: 1_200,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: 997_500,
    }

    const totals = getFloatingDockUsageTotals(
      'codex',
      [
        {
          usage: {
            input_tokens: 20_000,
            output_tokens: 500,
            cache_read_input_tokens: 19_000,
          },
        },
        {
          usage: {
            input_tokens: 40_000,
            output_tokens: 700,
            cache_read_input_tokens: 39_000,
          },
        },
      ],
      threadTokenUsage
    )

    expect(totals).toEqual({
      input: 400,
      cachedInput: 66_900,
      totalTokens: 67_300,
    })
  })

  it('falls back to summed message usage when thread usage is unavailable', () => {
    const totals = getFloatingDockUsageTotals('codex', [
      {
        usage: {
          input_tokens: 20_000,
          output_tokens: 500,
          cache_read_input_tokens: 19_000,
        },
      },
      {
        usage: {
          input_tokens: 40_000,
          output_tokens: 700,
          cache_read_input_tokens: 39_000,
          cache_creation_input_tokens: 200,
        },
      },
    ])

    expect(totals).toEqual({
      input: 60_000,
      cachedInput: 58_000,
      totalTokens: 118_000,
    })
  })
})

describe('computeContextPercent', () => {
  it('uses only input plus cached input against the context window', () => {
    expect(computeContextPercent(67_300, 997_500)).toBe(93)
  })

  it('clamps at zero when usage exceeds the context window', () => {
    expect(computeContextPercent(1_500, 1_000)).toBe(0)
  })
})
