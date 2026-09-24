import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { markSessionsRead } from '@/components/unread/mark-sessions-read'
import { isNativeApp } from '@/lib/environment'
import { logger } from '@/lib/logger'
import { invoke, listen } from '@/lib/transport'
import type { AllSessionsResponse } from '@/types/chat'
import type { SessionNotificationTarget } from '@/lib/session-notifications'
import {
  openWorkspaceSession,
  type WorkspaceSessionTarget,
} from '@/lib/workspace-navigation'

async function resolveWorkspaceTarget(
  target: SessionNotificationTarget
): Promise<WorkspaceSessionTarget | null> {
  if (target.projectId && target.worktreeId && target.worktreePath) {
    return target as WorkspaceSessionTarget
  }

  const response = await invoke<AllSessionsResponse>('list_all_sessions')
  const entry = response.entries.find(candidate =>
    candidate.sessions.some(session => session.id === target.sessionId)
  )
  if (!entry) return null
  return {
    projectId: entry.project_id,
    worktreeId: entry.worktree_id,
    worktreePath: entry.worktree_path,
    sessionId: target.sessionId,
  }
}

export function useNativeNotificationNavigation(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isNativeApp()) return

    const unlisten = listen<SessionNotificationTarget>(
      'native-notification-clicked',
      async event => {
        const target = event.payload
        try {
          const workspaceTarget = await resolveWorkspaceTarget(target)
          if (workspaceTarget) openWorkspaceSession(workspaceTarget)
          await markSessionsRead(queryClient, [target.sessionId])
        } catch (error) {
          logger.error('Failed to open session from native notification', {
            error,
            sessionId: target.sessionId,
          })
        }
      }
    )

    return () => {
      void unlisten.then(stopListening => stopListening())
    }
  }, [queryClient])
}
