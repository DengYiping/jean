import type { QueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { chatQueryKeys } from '@/services/chat'
import type { WorktreeSessions } from '@/types/chat'
import type { AppPreferences } from '@/types/preferences'

type CloseOriginalPreferences = Pick<
  AppPreferences,
  'close_original_on_clear_context' | 'removal_behavior'
>

interface CloseOriginalApprovedSessionParams {
  queryClient: QueryClient
  preferences?: CloseOriginalPreferences | null
  worktreeId: string
  worktreePath: string
  sessionId: string
  replacementSessionId?: string
  logContext: string
}

export function closeOriginalApprovedSession({
  queryClient,
  preferences,
  worktreeId,
  worktreePath,
  sessionId,
  replacementSessionId,
  logContext,
}: CloseOriginalApprovedSessionParams) {
  if (!preferences?.close_original_on_clear_context) return

  const command =
    preferences.removal_behavior === 'archive'
      ? 'archive_session'
      : 'close_session'

  queryClient.setQueryData<WorktreeSessions>(
    chatQueryKeys.sessions(worktreeId),
    old => {
      if (!old) return old

      const nextSessions = old.sessions.filter(
        session => session.id !== sessionId
      )
      const nextActiveSessionId =
        replacementSessionId && old.active_session_id === sessionId
          ? replacementSessionId
          : old.active_session_id

      return {
        ...old,
        sessions: nextSessions,
        active_session_id: nextActiveSessionId,
      }
    }
  )

  invoke(command, { worktreeId, worktreePath, sessionId })
    .then(() =>
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.sessions(worktreeId),
      })
    )
    .catch(err =>
      logger.error(`[${logContext}] Failed to close original session:`, err)
    )
}
