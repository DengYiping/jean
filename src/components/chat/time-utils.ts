import type { ChatMessage } from '@/types/chat'

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

/**
 * Prefer the in-memory completed duration for the final assistant message.
 * After reload, fall back to the persisted user->assistant timestamp delta
 * when the messages still look like a single prompt/response pair.
 */
export function getAssistantDurationMs(
  messages: ChatMessage[],
  index: number,
  completedDurationMs?: number | null
): number | null {
  const message = messages[index]
  if (message?.role !== 'assistant') return null

  if (index === messages.length - 1 && completedDurationMs != null) {
    return completedDurationMs
  }

  if (index <= 0) return null

  const prevMessage = messages[index - 1]
  if (prevMessage?.role !== 'user') return null

  const deltaSecs = message.timestamp - prevMessage.timestamp
  if (deltaSecs <= 0 || deltaSecs >= 3600) return null

  return deltaSecs * 1000
}
