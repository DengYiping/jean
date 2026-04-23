import { useCallback, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useChatStore } from '@/store/chat-store'
import {
  markPlanApproved as markPlanApprovedService,
  persistEnqueue,
} from '@/services/chat'
import { invoke } from '@/lib/transport'
import { buildMcpConfigJson } from '@/services/mcp'
import { usePreferences } from '@/services/preferences'
import { generateId } from '@/lib/uuid'
import type {
  ChatMessage,
  QueuedMessage,
  ThinkingLevel,
  EffortLevel,
} from '@/types/chat'
import type { Session } from '@/types/chat'
import type { McpServerInfo } from '@/types/chat'
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

interface UsePlanDialogApprovalParams {
  activeSessionId: string | null | undefined
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  pendingPlanMessage: ChatMessage | null | undefined
  selectedModelRef: RefObject<string>
  buildModelRef: RefObject<string | null>
  buildBackendRef: RefObject<string | null>
  buildThinkingLevelRef: RefObject<string | null>
  buildEffortLevelRef: RefObject<string | null>
  yoloModelRef: RefObject<string | null>
  yoloBackendRef: RefObject<string | null>
  yoloThinkingLevelRef: RefObject<string | null>
  yoloEffortLevelRef: RefObject<string | null>
  selectedProviderRef: RefObject<string | null>
  selectedThinkingLevelRef: RefObject<ThinkingLevel>
  selectedEffortLevelRef: RefObject<EffortLevel>
  useAdaptiveThinkingRef: RefObject<boolean>
  isCodexBackendRef: RefObject<boolean>
  mcpServersDataRef: RefObject<McpServerInfo[] | undefined>
  enabledMcpServersRef: RefObject<string[]>
  selectedBackendRef: RefObject<'claude' | 'codex' | 'opencode' | 'cursor'>
  markAtBottom: () => void
}

/**
 * Provides plan dialog approval handlers (build + yolo).
 * Deduplicates the 4x-repeated approval callback logic in ChatWindow.
 */
export function usePlanDialogApproval({
  activeSessionId,
  activeWorktreeId,
  activeWorktreePath,
  pendingPlanMessage,
  selectedModelRef,
  buildModelRef,
  buildBackendRef,
  buildThinkingLevelRef,
  buildEffortLevelRef,
  yoloModelRef,
  yoloBackendRef,
  yoloThinkingLevelRef,
  yoloEffortLevelRef,
  selectedProviderRef,
  selectedThinkingLevelRef,
  selectedEffortLevelRef,
  useAdaptiveThinkingRef,
  isCodexBackendRef,
  mcpServersDataRef,
  enabledMcpServersRef,
  selectedBackendRef,
  markAtBottom,
}: UsePlanDialogApprovalParams) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()

  const approve = useCallback(
    (
      updatedPlan: string | undefined,
      mode: 'build' | 'yolo',
      customPrompt?: string
    ) => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      // Optimistic updates: apply immediately so the approving client's UI updates
      if (pendingPlanMessage) {
        applyOptimisticPlanApproval({
          queryClient,
          sessionId: activeSessionId,
          worktreeId: activeWorktreeId,
          messageId: pendingPlanMessage.id,
        })
      }

      // Clear Zustand waiting state so the queue processor can process the message
      const {
        enqueueMessage,
        setExecutionMode,
        setWaitingForInput,
        setPendingPlanMessageId,
        clearToolCalls,
        clearStreamingContentBlocks,
        setSessionReviewing,
      } = useChatStore.getState()

      setWaitingForInput(activeSessionId, false)
      setPendingPlanMessageId(activeSessionId, null)
      clearToolCalls(activeSessionId)
      clearStreamingContentBlocks(activeSessionId)
      setSessionReviewing(activeSessionId, false)

      // Mark as at-bottom so Tier 4 / Tier 2 auto-scroll kicks in when
      // streaming starts. Don't physically scroll — let native CSS scroll
      // anchoring handle the plan collapse layout shift smoothly.
      markAtBottom()

      // Chain: mark_plan_approved → update_session_state → broadcast
      // On WebSocket, commands dispatch concurrently. update_session_state emits
      // cache:invalidate which triggers refetch on other clients. mark_plan_approved
      // must complete first so the refetch includes plan_approved=true.
      // Broadcasts are sequenced AFTER update_session_state so that any
      // refetch triggered by the self-received session:setting-changed event
      // returns the already-updated backend data (prevents stale overwrites
      // of optimistic TanStack cache on web access).
      const markPromise = pendingPlanMessage
        ? markPlanApprovedService(
            activeWorktreeId,
            activeWorktreePath,
            activeSessionId,
            pendingPlanMessage.id
          ).catch(err => {
            logger.error(
              '[usePlanDialogApproval] markPlanApproved failed:',
              err
            )
          })
        : Promise.resolve()

      markPromise
        .then(() =>
          invoke('update_session_state', {
            worktreeId: activeWorktreeId,
            worktreePath: activeWorktreePath,
            sessionId: activeSessionId,
            waitingForInput: false,
            waitingForInputType: null,
            selectedExecutionMode: mode,
          })
        )
        .then(() => {
          invoke('broadcast_session_setting', {
            sessionId: activeSessionId,
            key: 'executionMode',
            value: mode,
          }).catch(err => {
            console.error(
              '[usePlanDialogApproval] Broadcast executionMode=' +
                mode +
                ' failed:',
              err
            )
          })
          invoke('broadcast_session_setting', {
            sessionId: activeSessionId,
            key: 'waitingForInput',
            value: 'false',
          }).catch(err => {
            console.error(
              '[usePlanDialogApproval] Broadcast waitingForInput=false failed:',
              err
            )
          })
        })
        .catch(err => {
          logger.error(
            '[usePlanDialogApproval] Failed to clear waiting state:',
            err
          )
        })

      const backendOverride =
        mode === 'yolo' ? yoloBackendRef.current : buildBackendRef.current
      const overridesApply =
        !backendOverride || backendOverride === selectedBackendRef.current
      const appliedBackendOverride = overridesApply ? backendOverride : null
      const message = buildPlanApprovalMessage({
        mode,
        backend:
          (appliedBackendOverride as Session['backend'] | null) ??
          (isCodexBackendRef.current ? 'codex' : null),
        updatedPlan,
        originalPlan: null,
        customPrompt,
        approvedPlanContent: updatedPlan,
        configuredBuildPrompt: preferences?.magic_prompts?.plan_approval_build,
        configuredYoloPrompt: preferences?.magic_prompts?.plan_approval_yolo,
        configuredCodexPrompt: preferences?.magic_prompts?.plan_approval_codex,
      })

      const modelOverride = overridesApply
        ? mode === 'yolo'
          ? yoloModelRef.current
          : buildModelRef.current
        : null

      if (modelOverride) {
        useChatStore.getState().setSelectedModel(activeSessionId, modelOverride)
      }

      const thinkingOverride = overridesApply
        ? mode === 'yolo'
          ? yoloThinkingLevelRef.current
          : buildThinkingLevelRef.current
        : null
      const resolvedThinkingLevel: ThinkingLevel = isThinkingLevel(
        thinkingOverride
      )
        ? thinkingOverride
        : selectedThinkingLevelRef.current

      if (isThinkingLevel(thinkingOverride)) {
        useChatStore
          .getState()
          .setThinkingLevel(activeSessionId, resolvedThinkingLevel)
      }

      const effortOverride = overridesApply
        ? mode === 'yolo'
          ? yoloEffortLevelRef.current
          : buildEffortLevelRef.current
        : null
      const resolvedEffortLevel: EffortLevel | undefined =
        useAdaptiveThinkingRef.current || isCodexBackendRef.current
          ? ((effortOverride as EffortLevel | null) ??
            selectedEffortLevelRef.current)
          : undefined

      const model = modelOverride ?? selectedModelRef.current
      setExecutionMode(activeSessionId, mode)
      const modeLabel = mode === 'yolo' ? 'Yolo' : 'Build'
      const overrideStr =
        modelOverride || appliedBackendOverride
          ? [appliedBackendOverride, model].filter(Boolean).join(' / ')
          : ''
      if (overrideStr) toast.info(`${modeLabel}: ${overrideStr}`)
      const displayMessage = overrideStr
        ? `[${modeLabel}: ${overrideStr}]\n${message}`
        : message

      const queuedMessage: QueuedMessage = {
        id: generateId(),
        message: displayMessage,
        pendingImages: [],
        pendingFiles: [],
        skills: [],
        pendingTextFiles: [],
        model,
        provider: selectedProviderRef.current,
        executionMode: mode,
        thinkingLevel: resolvedThinkingLevel,
        effortLevel: resolvedEffortLevel,
        mcpConfig: buildMcpConfigJson(
          mcpServersDataRef.current ?? [],
          enabledMcpServersRef.current,
          (appliedBackendOverride as string) ?? selectedBackendRef.current
        ),
        queuedAt: Date.now(),
      }

      enqueueMessage(activeSessionId, queuedMessage)
      persistEnqueue(
        activeWorktreeId,
        activeWorktreePath,
        activeSessionId,
        queuedMessage
      )
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      pendingPlanMessage,
      queryClient,
      selectedModelRef,
      buildModelRef,
      buildBackendRef,
      buildThinkingLevelRef,
      buildEffortLevelRef,
      yoloModelRef,
      yoloBackendRef,
      yoloThinkingLevelRef,
      yoloEffortLevelRef,
      selectedProviderRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      isCodexBackendRef,
      mcpServersDataRef,
      enabledMcpServersRef,
      selectedBackendRef,
      markAtBottom,
      preferences,
    ]
  )

  const handlePlanDialogApprove = useCallback(
    (updatedPlan?: string) => approve(updatedPlan, 'build'),
    [approve]
  )

  const handlePlanDialogApproveWithCustomPrompt = useCallback(
    (updatedPlan: string | undefined, customPrompt: string) =>
      approve(updatedPlan, 'build', customPrompt),
    [approve]
  )

  const handlePlanDialogApproveYolo = useCallback(
    (updatedPlan?: string) => approve(updatedPlan, 'yolo'),
    [approve]
  )

  return {
    handlePlanDialogApprove,
    handlePlanDialogApproveWithCustomPrompt,
    handlePlanDialogApproveYolo,
  }
}
