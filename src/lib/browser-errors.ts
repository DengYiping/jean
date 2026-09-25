/** Browser layout notifications are not application failures. */
export function isResizeObserverNotification(message: string): boolean {
  return (
    message ===
      'ResizeObserver loop completed with undelivered notifications.' ||
    message === 'ResizeObserver loop limit exceeded'
  )
}
