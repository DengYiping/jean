import { useChatStore } from '@/store/chat-store'
import type { Session, WorktreeSessions } from '@/types/chat'
import { DEFAULT_PARALLEL_EXECUTION_PROMPT } from '@/types/preferences'
import { queryClient } from './query-client'

interface ParallelExecutionPreferences {
  parallel_execution_prompt_enabled?: boolean
  magic_prompts?: {
    parallel_execution?: string | null
  }
}

export function resolveParallelExecutionPrompt(
  sessionParallelExecutionPromptEnabled: boolean | undefined,
  preferences: ParallelExecutionPreferences | undefined
): string | undefined {
  const isEnabled =
    sessionParallelExecutionPromptEnabled ??
    preferences?.parallel_execution_prompt_enabled ??
    false

  if (!isEnabled) {
    return undefined
  }

  return (
    preferences?.magic_prompts?.parallel_execution ??
    DEFAULT_PARALLEL_EXECUTION_PROMPT
  )
}

function getCachedSessionParallelExecutionPromptEnabled(
  sessionId: string
): boolean | undefined {
  const session = queryClient.getQueryData<Session>([
    'chat',
    'session',
    sessionId,
  ])
  if (session?.parallel_execution_prompt_enabled !== undefined) {
    return session.parallel_execution_prompt_enabled
  }

  const sessionLists = queryClient.getQueriesData<WorktreeSessions>({
    queryKey: ['chat', 'sessions'],
  })
  for (const [, sessionsData] of sessionLists) {
    const cachedSession = sessionsData?.sessions.find(s => s.id === sessionId)
    if (cachedSession?.parallel_execution_prompt_enabled !== undefined) {
      return cachedSession.parallel_execution_prompt_enabled
    }
  }

  return undefined
}

export function resolveParallelExecutionPromptForSession(
  sessionId: string | null | undefined,
  preferences: ParallelExecutionPreferences | undefined
): string | undefined {
  const sessionParallelExecutionPromptEnabled = sessionId
    ? (useChatStore.getState().getParallelExecutionPromptEnabled(sessionId) ??
      getCachedSessionParallelExecutionPromptEnabled(sessionId))
    : undefined

  return resolveParallelExecutionPrompt(
    sessionParallelExecutionPromptEnabled,
    preferences
  )
}
