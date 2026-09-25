import { describe, expect, it } from 'vitest'
import { isResizeObserverNotification } from './browser-errors'

describe('isResizeObserverNotification', () => {
  it.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
  ])('recognizes the browser notification %s', message => {
    expect(isResizeObserverNotification(message)).toBe(true)
  })

  it('does not hide other errors', () => {
    expect(isResizeObserverNotification('ResizeObserver callback failed')).toBe(
      false
    )
    expect(isResizeObserverNotification('Network error')).toBe(false)
  })
})
