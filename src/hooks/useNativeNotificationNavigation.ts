import { useEffect } from 'react'
import { isNativeApp } from '@/lib/environment'
import { invoke, listen } from '@/lib/transport'
import type { AllSessionsResponse } from '@/types/chat'
import type { SessionNotificationTarget } from '@/lib/session-notifications'
import {
  openWorkspaceSession,
  type WorkspaceSessionTarget,
} from '@/lib/workspace-navigation'

export function useNativeNotificationNavigation(): void {
  useEffect(() => {
    if (!isNativeApp()) return

    const unlisten = listen<SessionNotificationTarget>(
      'native-notification-clicked',
      async event => {
        const target = event.payload
        if (target.projectId && target.worktreeId && target.worktreePath) {
          openWorkspaceSession(target as WorkspaceSessionTarget)
          return
        }

        const response = await invoke<AllSessionsResponse>('list_all_sessions')
        const entry = response.entries.find(candidate =>
          candidate.sessions.some(session => session.id === target.sessionId)
        )
        if (!entry) return
        openWorkspaceSession({
          projectId: entry.project_id,
          worktreeId: entry.worktree_id,
          worktreePath: entry.worktree_path,
          sessionId: target.sessionId,
        })
      }
    )

    return () => {
      void unlisten.then(stopListening => stopListening())
    }
  }, [])
}
