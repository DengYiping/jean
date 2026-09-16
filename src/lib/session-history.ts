import type { Session } from '@/types/chat'

/** Keep explicitly loaded older pages while replacing the authoritative recent tail. */
export function mergeSessionHistory(
  fresh: Session,
  cached?: Session | null,
  preservePendingUser = false
): Session {
  if (!cached || cached.id !== fresh.id) return fresh
  const firstFresh = fresh.messages[0]
  const overlap = firstFresh
    ? cached.messages.findIndex(message => message.id === firstFresh.id)
    : -1
  // A reconnect can skip more than one page. Do not pretend a gap is loaded.
  const hasGap =
    overlap < 0 &&
    (cached.total_runs ?? 0) < (fresh.loaded_run_start_index ?? 0)
  const hasOlderPage =
    !hasGap &&
    cached.history_expanded &&
    (cached.loaded_run_start_index ?? 0) < (fresh.loaded_run_start_index ?? 0)
  const older = hasOlderPage
    ? overlap >= 0
      ? cached.messages.slice(0, overlap)
      : cached.messages.filter(
          message => firstFresh && message.timestamp < firstFresh.timestamp
        )
    : []
  const lastCached = cached.messages.at(-1)
  const lastFresh = fresh.messages.at(-1)
  // A send can reach the cache before its user message reaches disk.
  const pendingUser =
    preservePendingUser &&
    lastCached?.role === 'user' &&
    (!lastFresh || lastCached.timestamp >= lastFresh.timestamp) &&
    !fresh.messages.some(
      message =>
        message.id === lastCached.id ||
        (message.role === 'user' &&
          message.content === lastCached.content &&
          message.timestamp >= lastCached.timestamp)
    )
      ? [lastCached]
      : []
  return {
    ...fresh,
    messages: [...older, ...fresh.messages, ...pendingUser],
    history_expanded: !hasGap && cached.history_expanded,
    loaded_run_start_index: hasOlderPage
      ? cached.loaded_run_start_index
      : fresh.loaded_run_start_index,
  }
}

export function prependSessionHistory(
  page: Session,
  current: Session
): Session {
  const ids = new Set(current.messages.map(message => message.id))
  return {
    ...current,
    history_expanded: true,
    messages: [
      ...page.messages.filter(message => !ids.has(message.id)),
      ...current.messages,
    ],
    loaded_run_start_index: Math.min(
      page.loaded_run_start_index ?? 0,
      current.loaded_run_start_index ?? 0
    ),
  }
}
