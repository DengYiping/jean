import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startCliRequestTrigger } from './cli-request-trigger'

describe('startCliRequestTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('checks at most a handful of times per idle minute when unfocused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const check = vi.fn()
    const stop = startCliRequestTrigger(check)

    vi.advanceTimersByTime(60_000)
    stop()

    console.info(
      `[measure] idle unfocused checks/min: ${check.mock.calls.length}`
    )
    expect(check.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('checks immediately when the window gains focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const check = vi.fn()
    const stop = startCliRequestTrigger(check)
    check.mockClear()

    window.dispatchEvent(new Event('focus'))
    stop()

    expect(check).toHaveBeenCalledTimes(1)
  })
})
