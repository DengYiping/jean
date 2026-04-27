import { describe, expect, it } from 'vitest'
import { formatDuration } from './time-utils'

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
