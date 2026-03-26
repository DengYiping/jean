import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { useChatStore } from '@/store/chat-store'
import { usePreferences } from '@/services/preferences'
import { useSendMessage, markPlanApproved } from '@/services/chat'
import { invoke } from '@/lib/transport'
import type { SessionCardData } from '../session-card-utils'
import { buildPlanApprovalMessage } from '../plan-approval-message'
import { applyOptimisticPlanApproval } from './optimistic-plan-approval'

interface UsePlanApprovalParams {
  worktreeId: string
  worktreePath: string
}

/**
 * Provides plan approval handlers for canvas session cards.
 */
export function usePlanApproval({
  worktreeId,
  worktreePath,
}: UsePlanApprovalParams) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const sendMessage = useSendMessage()

  const {
    setExecutionMode,
    addSendingSession,
    setSelectedModel,
    setLastSentMessage,
    setError,
    setExecutingMode,
    setSessionReviewing,
    setWaitingForInput,
    clearToolCalls,
    clearStreamingContentBlocks,
    setPendingPlanMessageId,
  } = useChatStore.getState()

  const handlePlanApproval = useCallback(
    (card: SessionCardData, updatedPlan?: string, customPrompt?: string) => {
      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId
      const originalPlan = card.planContent

      // Optimistic updates: apply immediately so the approving client's UI updates
      if (messageId) {
        applyOptimisticPlanApproval({
          queryClient,
          sessionId,
          worktreeId,
          messageId,
        })
      }

      setExecutionMode(sessionId, 'build')
      invoke('broadcast_session_setting', {
        sessionId,
        key: 'executionMode',
        value: 'build',
      }).catch(err => {
        logger.error(
          '[usePlanApproval] Broadcast executionMode=build failed:',
          err
        )
      })
      invoke('broadcast_session_setting', {
        sessionId,
        key: 'waitingForInput',
        value: 'false',
      }).catch(err => {
        logger.error(
          '[usePlanApproval] Broadcast waitingForInput=false failed:',
          err
        )
      })
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      setPendingPlanMessageId(sessionId, null)

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'
      const sessionBackend = card.session.backend

      const rawMessage = buildPlanApprovalMessage({
        mode: 'build',
        backend: sessionBackend,
        updatedPlan,
        originalPlan,
        customPrompt,
        approvedPlanContent: updatedPlan ?? originalPlan,
      })
      const buildInfo = [sessionBackend, model].filter(Boolean).join(' / ')
      const message = buildInfo
        ? `[Build: ${buildInfo}]\n${rawMessage}`
        : rawMessage

      // Chain: mark_plan_approved → update_session_state → broadcast → sendMessage
      // On WebSocket, commands dispatch concurrently via tokio::spawn.
      // update_session_state emits cache:invalidate which triggers refetch on
      // other clients. mark_plan_approved must complete first so the refetch
      // includes plan_approved=true (from approved_plan_message_ids).
      // Broadcasts are sequenced AFTER update_session_state so that any
      // refetch triggered by the self-received session:setting-changed event
      // returns the already-updated backend data (prevents stale overwrites
      // of optimistic TanStack cache on web access).
      const markPromise = messageId
        ? markPlanApproved(
            worktreeId,
            worktreePath,
            sessionId,
            messageId
          ).catch(err => {
            logger.error('[usePlanApproval] markPlanApproved failed:', err)
          })
        : Promise.resolve()

      markPromise
        .then(() =>
          invoke('update_session_state', {
            worktreeId,
            worktreePath,
            sessionId,
            waitingForInput: false,
            waitingForInputType: null,
            selectedExecutionMode: 'build',
          })
        )
        .then(() => {
          invoke('broadcast_session_setting', {
            sessionId,
            key: 'executionMode',
            value: 'build',
          }).catch(err => {
            console.error(
              '[usePlanApproval] Broadcast executionMode=build failed:',
              err
            )
          })
          invoke('broadcast_session_setting', {
            sessionId,
            key: 'waitingForInput',
            value: 'false',
          }).catch(err => {
            console.error(
              '[usePlanApproval] Broadcast waitingForInput=false failed:',
              err
            )
          })
        })
        .catch(err => {
          logger.error('[usePlanApproval] Failed to clear waiting state:', err)
        })
        .finally(() => {
          setLastSentMessage(sessionId, message)
          setError(sessionId, null)
          addSendingSession(sessionId)
          setSelectedModel(sessionId, model)
          setExecutingMode(sessionId, 'build')

          sendMessage.mutate({
            sessionId,
            worktreeId,
            worktreePath,
            message,
            model,
            executionMode: 'build',
            thinkingLevel,
            customProfileName: card.session.selected_provider ?? undefined,
          })
        })
    },
    [
      worktreeId,
      worktreePath,
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setPendingPlanMessageId,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  const handlePlanApprovalYolo = useCallback(
    (card: SessionCardData, updatedPlan?: string) => {
      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId
      const originalPlan = card.planContent

      // Optimistic updates: apply immediately so the approving client's UI updates
      if (messageId) {
        applyOptimisticPlanApproval({
          queryClient,
          sessionId,
          worktreeId,
          messageId,
        })
      }

      setExecutionMode(sessionId, 'yolo')
      invoke('broadcast_session_setting', {
        sessionId,
        key: 'executionMode',
        value: 'yolo',
      }).catch(err => {
        logger.error(
          '[usePlanApproval] Broadcast executionMode=yolo failed:',
          err
        )
      })
      invoke('broadcast_session_setting', {
        sessionId,
        key: 'waitingForInput',
        value: 'false',
      }).catch(err => {
        logger.error(
          '[usePlanApproval] Broadcast waitingForInput=false failed:',
          err
        )
      })
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      setPendingPlanMessageId(sessionId, null)

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'
      const sessionBackend = card.session.backend

      const rawMessage = buildPlanApprovalMessage({
        mode: 'yolo',
        backend: sessionBackend,
        updatedPlan,
        originalPlan,
        approvedPlanContent: updatedPlan ?? originalPlan,
      })
      const yoloInfo = [sessionBackend, model].filter(Boolean).join(' / ')
      const message = yoloInfo
        ? `[Yolo: ${yoloInfo}]\n${rawMessage}`
        : rawMessage

      // Chain: mark_plan_approved → update_session_state → broadcast → sendMessage
      // See handlePlanApproval comment for why sequencing matters.
      const markPromise = messageId
        ? markPlanApproved(
            worktreeId,
            worktreePath,
            sessionId,
            messageId
          ).catch(err => {
            logger.error('[usePlanApproval] markPlanApproved failed:', err)
          })
        : Promise.resolve()

      markPromise
        .then(() =>
          invoke('update_session_state', {
            worktreeId,
            worktreePath,
            sessionId,
            waitingForInput: false,
            waitingForInputType: null,
            selectedExecutionMode: 'yolo',
          })
        )
        .catch(err => {
          logger.error('[usePlanApproval] Failed to clear waiting state:', err)
        })
        .finally(() => {
          setLastSentMessage(sessionId, message)
          setError(sessionId, null)
          addSendingSession(sessionId)
          setSelectedModel(sessionId, model)
          setExecutingMode(sessionId, 'yolo')

          sendMessage.mutate({
            sessionId,
            worktreeId,
            worktreePath,
            message,
            model,
            executionMode: 'yolo',
            thinkingLevel,
            customProfileName: card.session.selected_provider ?? undefined,
          })
        })
    },
    [
      worktreeId,
      worktreePath,
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setPendingPlanMessageId,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  return { handlePlanApproval, handlePlanApprovalYolo }
}
