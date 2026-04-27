import { useState, useEffect } from 'react'
import { formatDuration } from '../time-utils'

/**
 * Returns a live elapsed time string (e.g. "23s", "1m 05s") that ticks every second.
 * The value is computed directly from Date.now() - startTime each render,
 * with a 1s interval just to trigger re-renders. No state for the display
 * value itself, so no setState-during-render flicker.
 */
export function useElapsedTime(startTime: number | null): string | null {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (startTime == null) {
      setNow(null)
      return
    }

    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startTime])

  if (startTime == null || now == null) return null
  return formatDuration(now - startTime)
}
