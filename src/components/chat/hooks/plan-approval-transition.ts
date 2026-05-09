import type { QueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { invoke } from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'
import { agentBoardQueryKeys } from '@/services/agent-board'
import { markPlanApproved } from '@/services/chat'
import type { AgentBoardItem } from '@/types/agent-board'
import type { ExecutionMode } from '@/types/chat'
import { applyOptimisticPlanApproval } from './optimistic-plan-approval'

interface CompletePlanApprovalTransitionParams {
  queryClient: QueryClient
  worktreeId: string
  worktreePath: string
  sessionId: string
  messageId: string | null | undefined
  nextExecutionMode?: ExecutionMode
  logContext: string
}

function clearLocalPlanWaitingState(
  sessionId: string,
  nextExecutionMode: ExecutionMode | undefined
) {
  const {
    setExecutionMode,
    setWaitingForInput,
    setPendingPlanMessageId,
    clearToolCalls,
    clearStreamingContentBlocks,
    setSessionReviewing,
  } = useChatStore.getState()

  if (nextExecutionMode) {
    setExecutionMode(sessionId, nextExecutionMode)
  }
  clearToolCalls(sessionId)
  clearStreamingContentBlocks(sessionId)
  setSessionReviewing(sessionId, false)
  setWaitingForInput(sessionId, false)
  setPendingPlanMessageId(sessionId, null)
}

function updateSessionStatePayload({
  worktreeId,
  worktreePath,
  sessionId,
  nextExecutionMode,
}: Pick<
  CompletePlanApprovalTransitionParams,
  'worktreeId' | 'worktreePath' | 'sessionId' | 'nextExecutionMode'
>) {
  return {
    worktreeId,
    worktreePath,
    sessionId,
    waitingForInput: false,
    waitingForInputType: null,
    ...(nextExecutionMode ? { selectedExecutionMode: nextExecutionMode } : {}),
  }
}

async function refreshAgentBoard(queryClient: QueryClient, logContext: string) {
  try {
    const items = await invoke<AgentBoardItem[]>('refresh_agent_board_items')
    queryClient.setQueryData(agentBoardQueryKeys.all, items)
  } catch (err) {
    logger.error(`[${logContext}] Failed to refresh board:`, err)
  }
}

function broadcastPlanApprovalSettings(
  sessionId: string,
  nextExecutionMode: ExecutionMode,
  logContext: string
) {
  invoke('broadcast_session_setting', {
    sessionId,
    key: 'executionMode',
    value: nextExecutionMode,
  }).catch(err => {
    logger.error(
      `[${logContext}] Broadcast executionMode=${nextExecutionMode} failed:`,
      err
    )
  })
  invoke('broadcast_session_setting', {
    sessionId,
    key: 'waitingForInput',
    value: 'false',
  }).catch(err => {
    logger.error(`[${logContext}] Broadcast waitingForInput=false failed:`, err)
  })
}

export function completePlanApprovalTransition({
  queryClient,
  worktreeId,
  worktreePath,
  sessionId,
  messageId,
  nextExecutionMode,
  logContext,
}: CompletePlanApprovalTransitionParams): Promise<void> {
  if (messageId) {
    applyOptimisticPlanApproval({
      queryClient,
      sessionId,
      worktreeId,
      messageId,
    })
  }

  clearLocalPlanWaitingState(sessionId, nextExecutionMode)

  const markPromise = messageId
    ? markPlanApproved(worktreeId, worktreePath, sessionId, messageId).catch(
        err => {
          logger.error(`[${logContext}] markPlanApproved failed:`, err)
        }
      )
    : Promise.resolve()

  return markPromise
    .then(() =>
      invoke('update_session_state', {
        ...updateSessionStatePayload({
          worktreeId,
          worktreePath,
          sessionId,
          nextExecutionMode,
        }),
      })
    )
    .then(() => refreshAgentBoard(queryClient, logContext))
    .then(() => {
      if (nextExecutionMode) {
        broadcastPlanApprovalSettings(sessionId, nextExecutionMode, logContext)
      }
    })
    .catch(err => {
      logger.error(`[${logContext}] Failed to clear waiting state:`, err)
    })
}
