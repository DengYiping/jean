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
        totalTokens: 70_000,
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
      output: 1_200,
      cacheRead: 66_900,
      cacheCreation: 0,
      totalTokens: 70_000,
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
      output: 1_200,
      cacheRead: 58_000,
      cacheCreation: 200,
      totalTokens: 119_400,
    })
  })
})

describe('computeContextPercent', () => {
  it('matches Codex baseline-normalized context remaining math', () => {
    expect(computeContextPercent(68_500, 997_500)).toBe(94)
  })

  it('treats baseline-only usage as fully available', () => {
    expect(computeContextPercent(1_600, 997_500)).toBe(100)
  })

  it('clamps at zero when usage exceeds the context window', () => {
    expect(computeContextPercent(1_100_000, 997_500)).toBe(0)
  })

  it('returns zero when the context window is not larger than the baseline', () => {
    expect(computeContextPercent(1_500, 1_000)).toBe(0)
  })
})
