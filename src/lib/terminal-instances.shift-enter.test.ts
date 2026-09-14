import { describe, expect, it } from 'vitest'
import {
  SHIFT_ENTER_SEQUENCE,
  acceptsModifierEncodedKeys,
  isShiftEnterEvent,
  trackTerminalKeyboardMode,
} from './terminal-instances'

function shiftEnter(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: 'Enter',
    keyCode: 13,
    metaKey: false,
    shiftKey: true,
    ...overrides,
  } as KeyboardEvent
}

describe('terminal Shift+Enter support', () => {
  it('recognizes only an unmodified, non-composing Shift+Enter', () => {
    expect(isShiftEnterEvent(shiftEnter())).toBe(true)
    expect(isShiftEnterEvent(shiftEnter({ ctrlKey: true }))).toBe(false)
    expect(isShiftEnterEvent(shiftEnter({ isComposing: true }))).toBe(false)
    expect(isShiftEnterEvent(shiftEnter({ keyCode: 229 }))).toBe(false)
    expect(SHIFT_ENTER_SEQUENCE).toBe('\x1b[13;2u')
  })

  it('only enables modifier-encoded input after the foreground program opts in', () => {
    const terminalId = 'shift-enter-keyboard-mode-test'
    expect(acceptsModifierEncodedKeys(terminalId)).toBe(false)

    trackTerminalKeyboardMode(terminalId, '\x1b[?1004h')
    expect(acceptsModifierEncodedKeys(terminalId)).toBe(true)
    trackTerminalKeyboardMode(terminalId, '\x1b[?1004l')
    expect(acceptsModifierEncodedKeys(terminalId)).toBe(false)

    trackTerminalKeyboardMode(terminalId, '\x1b[>1u')
    expect(acceptsModifierEncodedKeys(terminalId)).toBe(true)
    trackTerminalKeyboardMode(terminalId, '\x1b[<1u')
    expect(acceptsModifierEncodedKeys(terminalId)).toBe(false)
  })

  it('tracks escape sequences split over terminal output chunks', () => {
    const terminalId = 'shift-enter-split-output-test'
    trackTerminalKeyboardMode(terminalId, '\x1b[?10')
    expect(acceptsModifierEncodedKeys(terminalId)).toBe(false)
    trackTerminalKeyboardMode(terminalId, '04h')
    expect(acceptsModifierEncodedKeys(terminalId)).toBe(true)
  })
})
