import type { QueryClient } from '@tanstack/react-query'
import { projectsQueryKeys } from '@/services/projects'
import { chatQueryKeys } from '@/services/chat'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type {
  CliImportedProjectResult,
  Project,
  Worktree,
} from '@/types/projects'

function upsertById<T extends { id: string }>(
  items: T[] | undefined,
  next: T
): T[] {
  if (!items) return [next]
  const existingIndex = items.findIndex(item => item.id === next.id)
  if (existingIndex === -1) {
    return [...items, next]
  }
  return items.map(item => (item.id === next.id ? next : item))
}

export function applyCliImportNavigation(
  queryClient: QueryClient,
  result: CliImportedProjectResult
) {
  queryClient.setQueryData<Project[]>(projectsQueryKeys.list(), existing =>
    upsertById(existing, result.project)
  )
  queryClient.setQueryData<Worktree[]>(
    projectsQueryKeys.worktrees(result.project.id),
    existing => upsertById(existing, result.worktree)
  )

  queryClient.invalidateQueries({ queryKey: projectsQueryKeys.list() })
  queryClient.invalidateQueries({
    queryKey: projectsQueryKeys.worktrees(result.project.id),
  })
  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.sessions(result.worktree.id),
  })
  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.session(result.session_id),
  })

  const projectsStore = useProjectsStore.getState()
  const chatStore = useChatStore.getState()
  const uiStore = useUIStore.getState()

  projectsStore.expandProject(result.project.id)
  projectsStore.selectProject(result.project.id)
  projectsStore.selectWorktree(result.worktree.id)

  chatStore.registerWorktreePath(result.worktree.id, result.worktree.path)
  chatStore.setActiveSession(result.worktree.id, result.session_id, {
    markOpened: false,
  })
  chatStore.setActiveWorktree(result.worktree.id, result.worktree.path)
  chatStore.setLastOpenedForProject(
    result.project.id,
    result.worktree.id,
    result.session_id
  )

  uiStore.setSessionChatModalOpen(false)
}
