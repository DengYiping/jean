import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(import.meta.dirname, 'terminal-instances.ts'),
  'utf8'
)

describe('terminal output performance safeguards', () => {
  it('bounds terminal history and batches PTY output writes', () => {
    expect(source).toContain('TERMINAL_SCROLLBACK_LINES = 2_000')
    expect(source).toContain('MAX_PENDING_TERMINAL_OUTPUT_CHARS = 512 * 1024')
    expect(source).toContain(
      'queueTerminalOutput(terminalId, event.payload.data)'
    )
    expect(source).toContain('flushTerminalOutput(terminalId)')
  })
})
