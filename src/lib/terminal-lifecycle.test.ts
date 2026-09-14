import { describe, expect, it } from 'vitest'
import { shouldAutoCloseTerminal } from './terminal-lifecycle'

describe('shouldAutoCloseTerminal', () => {
  it('keeps run-command output visible after success and failure', () => {
    expect(
      shouldAutoCloseTerminal({
        exitCode: 0,
        signal: null,
        isRunTerminal: true,
      })
    ).toBe(false)
    expect(
      shouldAutoCloseTerminal({
        exitCode: 1,
        signal: null,
        isRunTerminal: true,
      })
    ).toBe(false)
  })

  it('still closes a normal shell after a clean exit', () => {
    expect(
      shouldAutoCloseTerminal({
        exitCode: 0,
        signal: null,
        isRunTerminal: false,
      })
    ).toBe(true)
  })
})
