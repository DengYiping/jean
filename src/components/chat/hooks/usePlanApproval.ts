import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { usePreferences } from '@/services/preferences'
import { useSendMessage } from '@/services/chat'
import { useClaudeCliStatus } from '@/services/claude-cli'
import { supportsAdaptiveThinking } from '@/lib/model-utils'
import { resolveParallelExecutionPromptForSession } from '@/lib/parallel-execution-prompt'
import type { EffortLevel, ThinkingLevel } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'
import { buildPlanApprovalMessage } from '../plan-approval-message'
import { completePlanApprovalTransition } from './plan-approval-transition'

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
    addSendingSession,
    setSelectedModel,
    setLastSentMessage,
    setError,
    setExecutingMode,
  } = useChatStore.getState()

  const handlePlanApproval = useCallback(
    (card: SessionCardData, updatedPlan?: string, customPrompt?: string) => {
      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId
      const originalPlan = card.planContent

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

      completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        nextExecutionMode: 'build',
        logContext: 'usePlanApproval',
      }).finally(() => {
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
          parallelExecutionPrompt: resolveParallelExecutionPromptForSession(
            sessionId,
            preferences
          ),
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

      completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        nextExecutionMode: 'yolo',
        logContext: 'usePlanApproval',
      }).finally(() => {
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
          parallelExecutionPrompt: resolveParallelExecutionPromptForSession(
            sessionId,
            preferences
          ),
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
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  return { handlePlanApproval, handlePlanApprovalYolo }
}
