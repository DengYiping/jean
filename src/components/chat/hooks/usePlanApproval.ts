import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { useChatStore } from '@/store/chat-store'
import { usePreferences } from '@/services/preferences'
import { useSendMessage, markPlanApproved } from '@/services/chat'
import { agentBoardQueryKeys } from '@/services/agent-board'
import { invoke } from '@/lib/transport'
import { useClaudeCliStatus } from '@/services/claude-cli'
import { supportsAdaptiveThinking } from '@/lib/model-utils'
import type { AgentBoardItem } from '@/types/agent-board'
import type { EffortLevel, ThinkingLevel } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'
import { buildPlanApprovalMessage } from '../plan-approval-message'
import { applyOptimisticPlanApproval } from './optimistic-plan-approval'

const THINKING_LEVEL_VALUES = new Set<ThinkingLevel>([
  'off',
  'think',
  'megathink',
  'ultrathink',
])

function isThinkingLevel(
  value: string | null | undefined
): value is ThinkingLevel {
  if (!value) return false
  return THINKING_LEVEL_VALUES.has(value as ThinkingLevel)
}

const EFFORT_LEVEL_VALUES = new Set<EffortLevel>([
  'low',
  'medium',
  'high',
  'max',
])

function isEffortLevel(value: string | null | undefined): value is EffortLevel {
  if (!value) return false
  return EFFORT_LEVEL_VALUES.has(value as EffortLevel)
}

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
  const { data: cliStatus } = useClaudeCliStatus()

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

      const sessionBackend =
        card.session.backend ??
        useChatStore.getState().selectedBackends[card.session.id] ??
        preferences?.default_backend ??
        'claude'
      const buildBackendOverride = preferences?.build_backend
      const overridesApply =
        !buildBackendOverride || buildBackendOverride === sessionBackend
      const model = overridesApply
        ? (preferences?.build_model ??
          preferences?.selected_model ??
          'claude-opus-4-7')
        : (preferences?.selected_model ?? 'claude-opus-4-7')
      const buildThinkingOverride = overridesApply
        ? preferences?.build_thinking_level
        : null
      const thinkingLevel: ThinkingLevel = isThinkingLevel(
        buildThinkingOverride
      )
        ? buildThinkingOverride
        : isThinkingLevel(preferences?.thinking_level)
          ? preferences.thinking_level
          : 'off'
      const isCodex = sessionBackend === 'codex'
      const buildEffortOverride = overridesApply
        ? preferences?.build_effort_level
        : null
      const effortAppliesBuild =
        isCodex || supportsAdaptiveThinking(model, cliStatus?.version ?? null)
      const effortLevel: EffortLevel | undefined = effortAppliesBuild
        ? isEffortLevel(buildEffortOverride)
          ? buildEffortOverride
          : isEffortLevel(preferences?.default_effort_level)
            ? preferences?.default_effort_level
            : undefined
        : undefined
      const rawMessage = buildPlanApprovalMessage({
        mode: 'build',
        backend: sessionBackend,
        updatedPlan,
        originalPlan,
        customPrompt,
        approvedPlanContent: updatedPlan ?? originalPlan,
        configuredBuildPrompt: preferences?.magic_prompts?.plan_approval_build,
        configuredYoloPrompt: preferences?.magic_prompts?.plan_approval_yolo,
        configuredCodexPrompt: preferences?.magic_prompts?.plan_approval_codex,
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
        .then(() =>
          invoke<AgentBoardItem[]>('refresh_agent_board_items')
            .then(items => {
              queryClient.setQueryData(agentBoardQueryKeys.all, items)
            })
            .catch(err => {
              logger.error('[usePlanApproval] Failed to refresh board:', err)
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
            effortLevel,
            backend: sessionBackend,
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
      cliStatus?.version,
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

      const sessionBackend =
        card.session.backend ??
        useChatStore.getState().selectedBackends[card.session.id] ??
        preferences?.default_backend ??
        'claude'
      const yoloBackendOverride = preferences?.yolo_backend
      const overridesApplyYolo =
        !yoloBackendOverride || yoloBackendOverride === sessionBackend
      const model = overridesApplyYolo
        ? (preferences?.yolo_model ??
          preferences?.selected_model ??
          'claude-opus-4-7')
        : (preferences?.selected_model ?? 'claude-opus-4-7')
      const yoloThinkingOverride = overridesApplyYolo
        ? preferences?.yolo_thinking_level
        : null
      const thinkingLevel: ThinkingLevel = isThinkingLevel(yoloThinkingOverride)
        ? yoloThinkingOverride
        : isThinkingLevel(preferences?.thinking_level)
          ? preferences.thinking_level
          : 'off'
      const isCodexYolo = sessionBackend === 'codex'
      const yoloEffortOverride = overridesApplyYolo
        ? preferences?.yolo_effort_level
        : null
      const effortAppliesYolo =
        isCodexYolo ||
        supportsAdaptiveThinking(model, cliStatus?.version ?? null)
      const effortLevel: EffortLevel | undefined = effortAppliesYolo
        ? isEffortLevel(yoloEffortOverride)
          ? yoloEffortOverride
          : isEffortLevel(preferences?.default_effort_level)
            ? preferences?.default_effort_level
            : undefined
        : undefined
      const rawMessage = buildPlanApprovalMessage({
        mode: 'yolo',
        backend: sessionBackend,
        updatedPlan,
        originalPlan,
        approvedPlanContent: updatedPlan ?? originalPlan,
        configuredBuildPrompt: preferences?.magic_prompts?.plan_approval_build,
        configuredYoloPrompt: preferences?.magic_prompts?.plan_approval_yolo,
        configuredCodexPrompt: preferences?.magic_prompts?.plan_approval_codex,
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
            effortLevel,
            backend: sessionBackend,
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
      cliStatus?.version,
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
