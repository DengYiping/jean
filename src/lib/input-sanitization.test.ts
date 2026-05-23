import { describe, expect, it } from 'vitest'
import {
  sanitizeTextInputElement,
  sanitizeTextInputValue,
} from './input-sanitization'

describe('input sanitization', () => {
  it('strips control characters while preserving tabs and newlines', () => {
    expect(sanitizeTextInputValue('a\tb\nc\rd\u001De')).toBe('a\tb\nc\rde')
  })

  it('updates a text element value and caret after stripping controls', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'move\u001D right'
    textarea.setSelectionRange(5, 5)

    const value = sanitizeTextInputElement(textarea)

    expect(value).toBe('move right')
    expect(textarea.value).toBe('move right')
    expect(textarea.selectionStart).toBe(4)
    expect(textarea.selectionEnd).toBe(4)
  })
})
