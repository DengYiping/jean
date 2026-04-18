import { useState, useEffect } from 'react'
import { formatDuration } from '../time-utils'

/**
 * Returns a live elapsed time string (e.g. "23s") that ticks every second.
 * Uses state to store the computed duration, updated via interval, to avoid
 * calling Date.now() during render.
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
