/**
 * Format milliseconds as a compact duration string.
 * Examples: "0s", "23s", "1m 05s", "1h 02m 03s"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  }

  if (totalMinutes > 0) {
    return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`
  }

  return `${seconds}s`
}
