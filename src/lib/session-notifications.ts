import type { QueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import type {
  AllSessionsResponse,
  Session,
  WorktreeSessions,
} from '@/types/chat'
import type { Project, Worktree } from '@/types/projects'
import { isNativeApp } from './environment'
import type { WorkspaceSessionTarget } from './workspace-navigation'

export type SessionNotificationTarget = Pick<
  WorkspaceSessionTarget,
  'sessionId'
> &
  Partial<Omit<WorkspaceSessionTarget, 'sessionId'>>

export interface SessionNotificationContent {
  title: string
  subtitle?: string
  body?: string
}

interface SessionNotificationDetails {
  target: SessionNotificationTarget
  sessionName?: string
  projectName?: string
  worktreeName?: string
}

const PREVIEW_MAX_LENGTH = 180

export function notifyIfBackground(
  content: SessionNotificationContent,
  target?: SessionNotificationTarget
): void {
  if (!isNativeApp()) return
  void invoke('send_native_notification', {
    title: content.title,
    subtitle: content.subtitle,
    body: content.body,
    backgroundOnly: true,
    target,
  }).catch(() => undefined)
}

/**
 * Send a background-only native notification describing a session event.
 * Resolves the session/worktree/project names so the banner says which session
 * it is about, and attaches the workspace target so clicking it can route there.
 */
export async function notifySessionEvent(
  queryClient: QueryClient,
  sessionId: string,
  status: string,
  preview?: string
): Promise<void> {
  if (!isNativeApp()) return
  const details = await resolveSessionNotificationDetails(
    queryClient,
    sessionId
  )
  notifyIfBackground(
    buildSessionNotificationContent(status, details, preview),
    details.target
  )
}

export function buildSessionNotificationContent(
  status: string,
  details: Omit<SessionNotificationDetails, 'target'>,
  preview?: string
): SessionNotificationContent {
  const location = [details.projectName, details.worktreeName]
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index)
    .join(' › ')
  const body = preview ? summarizePreview(preview) : ''
  return {
    title: details.sessionName ? `${status}: ${details.sessionName}` : status,
    subtitle: location || undefined,
    body: body || undefined,
  }
}

export function summarizePreview(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= PREVIEW_MAX_LENGTH) return plain
  return `${plain.slice(0, PREVIEW_MAX_LENGTH - 1).trimEnd()}…`
}

async function resolveSessionNotificationDetails(
  queryClient: QueryClient,
  sessionId: string
): Promise<SessionNotificationDetails> {
  const chatState = useChatStore.getState()
  let worktreeId: string | undefined = chatState.sessionWorktreeMap[sessionId]
  let session: Session | undefined

  for (const [, data] of queryClient.getQueriesData<WorktreeSessions>({
    queryKey: [...chatQueryKeys.all, 'sessions'],
  })) {
    const match = data?.sessions?.find(candidate => candidate.id === sessionId)
    if (match) {
      session = match
      worktreeId ??= data?.worktree_id
      break
    }
  }
  session ??= queryClient.getQueryData<Session>(
    chatQueryKeys.session(sessionId)
  )

  let worktree: Worktree | undefined
  if (worktreeId) {
    for (const [, worktrees] of queryClient.getQueriesData<Worktree[]>({
      queryKey: [...projectsQueryKeys.all, 'worktrees'],
    })) {
      worktree = worktrees?.find(candidate => candidate.id === worktreeId)
      if (worktree) break
    }
  }
  const project = worktree
    ? queryClient
        .getQueryData<Project[]>(projectsQueryKeys.list())
        ?.find(candidate => candidate.id === worktree.project_id)
    : undefined

  const worktreePath =
    worktree?.path ?? (worktreeId ? chatState.worktreePaths[worktreeId] : '')
  if (worktreeId && worktreePath && project && worktree && session) {
    return {
      target: {
        projectId: project.id,
        worktreeId,
        worktreePath,
        sessionId,
      },
      sessionName: session.name,
      projectName: project.name,
      worktreeName: worktree.name,
    }
  }

  // Background sessions in collapsed projects may not be cached; fall back to
  // the backend index so the banner still names the session and can route.
  const allSessions =
    queryClient.getQueryData<AllSessionsResponse>(['all-sessions']) ??
    (await invoke<AllSessionsResponse>('list_all_sessions').catch(() => null))
  const entry = allSessions?.entries.find(candidate =>
    candidate.sessions.some(
      candidateSession => candidateSession.id === sessionId
    )
  )
  if (!entry) {
    return {
      target: { sessionId },
      sessionName: session?.name,
      projectName: project?.name,
      worktreeName: worktree?.name,
    }
  }

  return {
    target: {
      projectId: entry.project_id,
      worktreeId: entry.worktree_id,
      worktreePath: entry.worktree_path,
      sessionId,
    },
    sessionName:
      session?.name ??
      entry.sessions.find(candidate => candidate.id === sessionId)?.name,
    projectName: entry.project_name,
    worktreeName: entry.worktree_name,
  }
}
