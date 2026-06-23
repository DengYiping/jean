import type { QueryClient } from '@tanstack/react-query'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import type { EffortLevel, ThinkingLevel, WorktreeSessions } from '@/types/chat'
import type { AppPreferences, CliBackend } from '@/types/preferences'
import type { CliYoloSessionResult, Project, Worktree } from '@/types/projects'
import { openWorkspaceSession } from './workspace-navigation'

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

export function applyCliYoloNavigation(
  queryClient: QueryClient,
  result: CliYoloSessionResult
) {
  queryClient.setQueryData<Project[]>(projectsQueryKeys.list(), existing =>
    upsertById(existing, result.project)
  )
  queryClient.setQueryData<Worktree[]>(
    projectsQueryKeys.worktrees(result.project.id),
    existing => upsertById(existing, result.worktree)
  )
  queryClient.setQueryData(
    chatQueryKeys.session(result.session.id),
    result.session
  )
  queryClient.setQueryData<WorktreeSessions>(
    chatQueryKeys.sessions(result.worktree.id),
    existing => ({
      worktree_id: result.worktree.id,
      sessions: upsertById(existing?.sessions, result.session),
      active_session_id: result.session.id,
      default_model: existing?.default_model,
      version: existing?.version ?? 2,
      branch_naming_completed: existing?.branch_naming_completed,
    })
  )

  queryClient.invalidateQueries({ queryKey: projectsQueryKeys.list() })
  queryClient.invalidateQueries({
    queryKey: projectsQueryKeys.worktrees(result.project.id),
  })
  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.sessions(result.worktree.id),
  })

  const projectsStore = useProjectsStore.getState()
  const chatStore = useChatStore.getState()

  projectsStore.expandProject(result.project.id)

  chatStore.registerWorktreePath(result.worktree.id, result.worktree.path)
  openWorkspaceSession({
    projectId: result.project.id,
    worktreeId: result.worktree.id,
    worktreePath: result.worktree.path,
    sessionId: result.session.id,
  })
}

export function resolveCliYoloExecutionConfig({
  sessionBackend,
  preferences,
  projectDefaultProvider,
}: {
  sessionBackend: CliBackend | null | undefined
  preferences: AppPreferences
  projectDefaultProvider: string | null | undefined
}): {
  backend: CliBackend
  model: string
  provider: string | null
  thinkingLevel: ThinkingLevel
  effortLevel?: EffortLevel
} {
  const backend = (preferences.yolo_backend ??
    sessionBackend ??
    preferences.default_backend) as CliBackend

  const model =
    preferences.yolo_model ??
    (backend === 'codex'
      ? preferences.selected_codex_model
      : backend === 'opencode'
        ? preferences.selected_opencode_model
        : preferences.selected_model)

  const provider =
    projectDefaultProvider ?? preferences.default_provider ?? null

  const thinkingLevel: ThinkingLevel =
    backend === 'codex'
      ? 'off'
      : ((preferences.yolo_thinking_level ??
          preferences.thinking_level) as ThinkingLevel)

  const effortLevel: EffortLevel | undefined =
    backend === 'codex'
      ? ((
          {
            low: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'xhigh',
            max: 'max',
          } as Record<string, EffortLevel>
        )[
          preferences.yolo_effort_level ??
            preferences.default_codex_reasoning_effort
        ] ?? 'high')
      : backend === 'claude'
        ? ((preferences.yolo_effort_level ??
            preferences.default_effort_level) as EffortLevel)
        : undefined

  return {
    backend,
    model,
    provider,
    thinkingLevel,
    effortLevel,
  }
}
