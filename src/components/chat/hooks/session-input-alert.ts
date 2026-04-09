import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { projectsQueryKeys } from '@/services/projects'
import { preferencesQueryKeys } from '@/services/preferences'
import { DEFAULT_KEYBINDINGS, formatShortcutDisplay } from '@/types/keybindings'
import type { AppPreferences } from '@/types/preferences'
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

export function getOpenUnreadSessionsShortcutHint(
  preferences: Pick<AppPreferences, 'keybindings'> | null | undefined
): string {
  const shortcut =
    preferences?.keybindings?.open_unread_sessions ??
    DEFAULT_KEYBINDINGS.open_unread_sessions
  return formatShortcutDisplay(shortcut)
}

function showSessionNeedsInputAlert(
  queryClient: QueryClient,
  sessionId: string,
  worktreeId: string,
  options: {
    title: string
    waitingFor: string
  }
): void {
  const preferences = queryClient.getQueryData<AppPreferences>(
    preferencesQueryKeys.preferences()
  )
  const sessionLabel = lookupSessionLabel(queryClient, sessionId, worktreeId)
  const shortcutHint = getOpenUnreadSessionsShortcutHint(preferences)

  const description = sessionLabel
    ? `${sessionLabel} is waiting for ${options.waitingFor}. Open unread sessions with ${shortcutHint}.`
    : `A session is waiting for ${options.waitingFor}. Open unread sessions with ${shortcutHint}.`

  toast.info(options.title, {
    description,
    action: {
      label: 'Open Unread',
      onClick: () =>
        window.dispatchEvent(new CustomEvent('command:open-unread-sessions')),
    },
  })
}

export function showSessionQuestionWaitingAlert(
  queryClient: QueryClient,
  sessionId: string,
  worktreeId: string
): void {
  showSessionNeedsInputAlert(queryClient, sessionId, worktreeId, {
    title: 'Question waiting for input',
    waitingFor: 'your answer',
  })
}

export function showSessionPermissionRequestAlert(
  queryClient: QueryClient,
  sessionId: string,
  worktreeId: string
): void {
  showSessionNeedsInputAlert(queryClient, sessionId, worktreeId, {
    title: 'Permission needed',
    waitingFor: 'your permission',
  })
}
