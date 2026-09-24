import type { QueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { chatQueryKeys } from '@/services/chat'
import type { Session, UnreadSessionsResponse } from '@/types/chat'

/** Optimistically drop sessions from the unread caches (bell + counts). */
export function markSessionsReadInCache(
  queryClient: QueryClient,
  sessionIds: string[]
): void {
  const now = Math.floor(Date.now() / 1000)
  let removedCount = 0
  queryClient.setQueryData<UnreadSessionsResponse>(
    chatQueryKeys.unreadSessions(),
    old => {
      if (!old) return old
      const entries = old.entries.filter(
        entry => !sessionIds.includes(entry.session.id)
      )
      removedCount = old.entries.length - entries.length
      return { entries }
    }
  )
  if (removedCount > 0) {
    queryClient.setQueryData<number>(chatQueryKeys.unreadCount(), old =>
      old === undefined ? old : Math.max(0, old - removedCount)
    )
  }
  queryClient.setQueryData(['all-sessions'], old => {
    if (!old) return old
    const data = old as { entries?: { sessions?: Session[] }[] }
    if (!data.entries) return old
    return {
      ...data,
      entries: data.entries.map(entry => ({
        ...entry,
        sessions: (entry.sessions ?? []).map(session =>
          sessionIds.includes(session.id)
            ? { ...session, last_opened_at: now }
            : session
        ),
      })),
    }
  })
}

/** Mark sessions read on the backend and refresh the unread indicators. */
export async function markSessionsRead(
  queryClient: QueryClient,
  sessionIds: string[]
): Promise<void> {
  if (sessionIds.length === 0) return
  markSessionsReadInCache(queryClient, sessionIds)
  if (sessionIds.length === 1) {
    await invoke('set_session_last_opened', { sessionId: sessionIds[0] })
  } else {
    await invoke('set_sessions_last_opened_bulk', { sessionIds })
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.unreadSessions() }),
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.unreadCount() }),
  ])
  window.dispatchEvent(new CustomEvent('session-opened'))
}
