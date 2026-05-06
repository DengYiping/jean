import { invoke } from '@/lib/transport'
import {
  chatQueryKeys,
  SESSIONS_GC_TIME_MS,
  SESSIONS_STALE_TIME_MS,
} from '@/services/chat'
import { isTauri } from '@/services/projects'
import type { WorktreeSessions } from '@/types/chat'
import type { Worktree } from '@/types/projects'

export function createProjectCanvasSessionsQuery(
  worktree: Pick<Worktree, 'id' | 'path'>
) {
  return {
    queryKey: chatQueryKeys.sessions(worktree.id),
    queryFn: async (): Promise<WorktreeSessions> => {
      if (!isTauri() || !worktree.id || !worktree.path) {
        return {
          worktree_id: worktree.id,
          sessions: [],
          active_session_id: null,
          version: 2,
        }
      }

      return invoke<WorktreeSessions>('get_sessions', {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
      })
    },
    enabled: !!worktree.id && !!worktree.path,
    staleTime: SESSIONS_STALE_TIME_MS,
    gcTime: SESSIONS_GC_TIME_MS,
    refetchOnMount: true,
  }
}
