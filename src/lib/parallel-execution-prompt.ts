import { useChatStore } from '@/store/chat-store'
import { DEFAULT_PARALLEL_EXECUTION_PROMPT } from '@/types/preferences'

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

export function resolveParallelExecutionPromptForSession(
  sessionId: string | null | undefined,
  preferences: ParallelExecutionPreferences | undefined
): string | undefined {
  const sessionParallelExecutionPromptEnabled = sessionId
    ? useChatStore.getState().getParallelExecutionPromptEnabled(sessionId)
    : undefined

  return resolveParallelExecutionPrompt(
    sessionParallelExecutionPromptEnabled,
    preferences
  )
}
