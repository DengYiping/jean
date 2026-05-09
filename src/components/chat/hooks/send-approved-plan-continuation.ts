import type { QueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import type { ExecutionMode, Session, ThinkingLevel } from '@/types/chat'
import type { ApprovedPlanContinuation } from './approved-plan-continuation'

interface SendMessageMutation {
  mutate: (params: {
    sessionId: string
    worktreeId: string
    worktreePath: string
    message: string
    model?: string
    executionMode?: ExecutionMode
    thinkingLevel?: ThinkingLevel
    effortLevel?: string
    mcpConfig?: string
    customProfileName?: string
    backend?: string
  }) => void
}

interface ApprovedPlanTarget {
  sessionId: string
  worktreeId: string
  worktreePath: string
}

interface SendApprovedPlanContinuationParams {
  queryClient: QueryClient
  sendMessage: SendMessageMutation
  target: ApprovedPlanTarget
  mode: Extract<ExecutionMode, 'build' | 'yolo'>
  continuation: ApprovedPlanContinuation
  logContext: string
  mcpConfig?: string
  customProfileName?: string
}

export async function sendApprovedPlanContinuation({
  queryClient,
  sendMessage,
  target,
  mode,
  continuation,
  logContext,
  mcpConfig,
  customProfileName,
}: SendApprovedPlanContinuationParams) {
  const store = useChatStore.getState()

  store.setExecutionMode(target.sessionId, mode)
  store.setLastSentMessage(target.sessionId, continuation.message)
  store.setError(target.sessionId, null)
  store.addSendingSession(target.sessionId)
  store.setSelectedModel(target.sessionId, continuation.model)
  store.setExecutingMode(target.sessionId, mode)
  if (continuation.backend) {
    store.setSelectedBackend(target.sessionId, continuation.backend)
  }

  queryClient.setQueryData<Session>(
    chatQueryKeys.session(target.sessionId),
    old =>
      old
        ? {
            ...old,
            backend: continuation.backend ?? old.backend,
            selected_model: continuation.model,
          }
        : old
  )

  await invoke('set_session_model', {
    worktreeId: target.worktreeId,
    worktreePath: target.worktreePath,
    sessionId: target.sessionId,
    model: continuation.model,
  }).catch(err => logger.error(`[${logContext}] Failed to persist model:`, err))

  if (continuation.backend) {
    await invoke('set_session_backend', {
      worktreeId: target.worktreeId,
      worktreePath: target.worktreePath,
      sessionId: target.sessionId,
      backend: continuation.backend,
    }).catch(err =>
      logger.error(`[${logContext}] Failed to persist backend:`, err)
    )
  }

  sendMessage.mutate({
    sessionId: target.sessionId,
    worktreeId: target.worktreeId,
    worktreePath: target.worktreePath,
    message: continuation.message,
    model: continuation.model,
    executionMode: mode,
    thinkingLevel: continuation.thinkingLevel,
    effortLevel: continuation.effortLevel,
    mcpConfig,
    customProfileName,
    backend: continuation.backend,
  })
}
