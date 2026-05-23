// Strip ASCII C0 controls (except tab/newline/CR), DEL, and C1 controls.
// Defends against external keyboard remappers / IMEs / accessibility tools that
// inject control codepoints (e.g. U+001D Group Separator on ArrowRight).
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g

export function sanitizeTextInputValue(value: string): string {
  CONTROL_CHARS_RE.lastIndex = 0
  return value.replace(CONTROL_CHARS_RE, '')
}

export function sanitizeTextInputElement(
  element: HTMLInputElement | HTMLTextAreaElement
): string {
  const rawValue = element.value
  const sanitizedValue = sanitizeTextInputValue(rawValue)
  if (sanitizedValue === rawValue) {
    return sanitizedValue
  }

  const cursorPos = element.selectionStart ?? rawValue.length
  const sanitizedCursorPos = sanitizeTextInputValue(
    rawValue.slice(0, cursorPos)
  ).length

  element.value = sanitizedValue
  element.selectionStart = element.selectionEnd = sanitizedCursorPos
  return sanitizedValue
}
