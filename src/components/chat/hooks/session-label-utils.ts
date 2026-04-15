import type { QueryClient } from '@tanstack/react-query'
import { projectsQueryKeys } from '@/services/projects'
import type { Project, Worktree } from '@/types/projects'
import type { WorktreeSessions } from '@/types/chat'

/**
 * Look up project/worktree/session names from query cache for display in toasts.
 * Returns a formatted label like "project / worktree / session" with graceful fallback.
 */
export function lookupSessionLabel(
  queryClient: QueryClient,
  sessionId: string,
  worktreeId: string
): string {
  let projectName: string | undefined
  let worktreeName: string | undefined
  let sessionName: string | undefined

  const sessionsData = queryClient.getQueriesData<WorktreeSessions>({
    queryKey: ['chat', 'sessions'],
  })
  for (const [, data] of sessionsData) {
    const match = data?.sessions?.find(session => session.id === sessionId)
    if (match) {
      sessionName = match.name
      break
    }
  }

  const worktreesData = queryClient.getQueriesData<Worktree[]>({
    queryKey: [...projectsQueryKeys.all, 'worktrees'],
  })
  for (const [, worktrees] of worktreesData) {
    const match = worktrees?.find(worktree => worktree.id === worktreeId)
    if (match) {
      worktreeName = match.name
      const projects = queryClient.getQueryData<Project[]>(
        projectsQueryKeys.list()
      )
      projectName = projects?.find(
        project => project.id === match.project_id
      )?.name
      break
    }
  }

  const parts = [projectName, worktreeName, sessionName].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : ''
}
