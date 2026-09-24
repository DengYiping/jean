import { listen } from '@/lib/transport'

export const CLI_REQUESTS_PENDING_EVENT = 'cli:requests-pending'
export const CLI_REQUEST_FALLBACK_POLL_MS = 30_000

/**
 * Schedules checks for pending `jean import` / `jean yolo` requests.
 *
 * The CLI enqueues a request file and then activates Jean.app, so checks run on
 * mount, on window focus, and on the backend reopen event. A slow fallback poll
 * runs only while the window is focused. Returns a cleanup function.
 */
export function startCliRequestTrigger(check: () => void): () => void {
  let disposed = false
  let unlisten: (() => void) | undefined

  const onFocus = () => check()
  window.addEventListener('focus', onFocus)

  const intervalId = window.setInterval(() => {
    if (document.hasFocus()) check()
  }, CLI_REQUEST_FALLBACK_POLL_MS)

  void listen(CLI_REQUESTS_PENDING_EVENT, () => check())
    .then(fn => {
      if (disposed) fn()
      else unlisten = fn
    })
    .catch(() => undefined)

  check()

  return () => {
    disposed = true
    window.removeEventListener('focus', onFocus)
    window.clearInterval(intervalId)
    unlisten?.()
  }
}
