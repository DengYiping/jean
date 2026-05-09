import { useCallback, type RefObject } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invoke, listen } from '@/lib/transport'
import {
  chatQueryKeys,
  readPlanFile,
  persistEnqueue,
  formatAnswersForCodexRequestUserInput,
  addGlobalCommandPermissionRule,
} from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import type {
  AskUserQuestionInput,
  AllSessionsResponse,
  ChatMessage,
  EffortLevel,
  ExecutionMode,
  Question,
  QuestionAnswer,
  Session,
  ThinkingLevel,
  WorktreeSessions,
} from '@/types/chat'
import type { ReviewFinding } from '@/types/chat'
import { formatAnswersAsNaturalLanguage } from '@/services/chat'
import { parseReviewFindings, getFindingKey } from '../review-finding-utils'
import { findPlanContent, findPlanFilePath } from '../tool-call-utils'
import { navigateToApprovedWorktree } from '../worktree-approval-navigation'
import { markWorktreeSilentReady } from '@/services/worktree-silent-ready'
import { getCodexPermissionApprovalMode } from '../permission-approval-utils'
import { generateId } from '@/lib/uuid'
import { preferencesQueryKeys } from '@/services/preferences'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { AppPreferences } from '@/types/preferences'
import type {
  Worktree,
  WorktreeCreatedEvent,
  WorktreeCreateErrorEvent,
} from '@/types/projects'
import { logger } from '@/lib/logger'
import { buildPlanApprovalMessage } from '../plan-approval-message'
import { resolveApprovedPlanContinuation } from './approved-plan-continuation'
import { completePlanApprovalTransition } from './plan-approval-transition'
import { sendApprovedPlanContinuation } from './send-approved-plan-continuation'
import { closeOriginalApprovedSession } from './close-original-approved-session'

/** Git commands to auto-approve for magic prompts (no permission prompts needed) */
export const GIT_ALLOWED_TOOLS = [
  'Bash(git:*)', // All git commands
  // gh-cli/claude-cli are auto-allowed via --allowedTools in build_claude_args()
]

function commandFromBashPattern(pattern: string): string | null {
  const match = pattern.match(/^Bash\((.+)\)$/)
  return match?.[1]?.trim() || null
}

/** Type for the sendMessage mutation */
interface SendMessageMutation {
  mutate: (
    params: {
      sessionId: string
      worktreeId: string
      worktreePath: string
      message: string
      model?: string
      executionMode?: ExecutionMode
      thinkingLevel?: ThinkingLevel
      effortLevel?: string
      allowedTools?: string[]
      mcpConfig?: string
      customProfileName?: string
      backend?: string
    },
    options?: {
      onSettled?: () => void
    }
  ) => void
}

/** Type for the createSession mutation */
interface CreateSessionMutation {
  mutateAsync: (params: {
    worktreeId: string
    worktreePath: string
    name?: string
  }) => Promise<Session>
}

interface UseMessageHandlersParams {
  // Refs for session/worktree IDs (stable across re-renders)
  activeSessionIdRef: RefObject<string | null | undefined>
  activeWorktreeIdRef: RefObject<string | null | undefined>
  activeWorktreePathRef: RefObject<string | null | undefined>
  // Refs for settings (stable across re-renders)
  selectedModelRef: RefObject<string>
  buildModelRef: RefObject<string | null>
  buildBackendRef: RefObject<string | null>
  buildThinkingLevelRef: RefObject<string | null>
  buildEffortLevelRef: RefObject<string | null>
  yoloModelRef: RefObject<string | null>
  yoloBackendRef: RefObject<string | null>
  yoloThinkingLevelRef: RefObject<string | null>
  yoloEffortLevelRef: RefObject<string | null>
  getCustomProfileName: () => string | undefined
  executionModeRef: RefObject<ExecutionMode>
  selectedThinkingLevelRef: RefObject<ThinkingLevel>
  selectedEffortLevelRef: RefObject<EffortLevel>
  useAdaptiveThinkingRef: RefObject<boolean>
  // MCP config builder (reads current refs internally)
  getMcpConfig: () => string | undefined
  // Actions
  sendMessage: SendMessageMutation
  createSession: CreateSessionMutation
  queryClient: QueryClient
  // Callbacks
  scrollToBottom: (instant?: boolean) => void
  markAtBottom: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  // For pending plan approval callback
  pendingPlanMessage: ChatMessage | null | undefined
  // For worktree approval (null = no project context, buttons won't render)
  projectIdRef: RefObject<string | null>
}

interface MessageHandlers {
  handleQuestionAnswer: (
    toolCallId: string,
    answers: QuestionAnswer[],
    questions: Question[]
  ) => void
  handleSkipQuestion: (toolCallId: string) => void
  handlePlanApproval: (messageId: string, updatedPlan?: string) => void
  handlePlanApprovalYolo: (messageId: string, updatedPlan?: string) => void
  handleStreamingPlanApproval: () => void
  handleStreamingPlanApprovalYolo: () => void
  handleClearContextApproval: (messageId: string) => void
  handleStreamingClearContextApproval: () => void
  handleClearContextApprovalBuild: (messageId: string) => void
  handleStreamingClearContextApprovalBuild: () => void
  handleWorktreeBuildApproval: (messageId: string) => void
  handleStreamingWorktreeBuildApproval: () => void
  handleWorktreeYoloApproval: (messageId: string) => void
  handleStreamingWorktreeYoloApproval: () => void
  handlePendingPlanApprovalCallback: () => void
  handlePermissionApproval: (
    sessionId: string,
    approvedPatterns: string[]
  ) => void
  handlePermissionApprovalAndPersist: (
    sessionId: string,
    approvedPatterns: string[]
  ) => void
  handlePermissionApprovalYolo: (
    sessionId: string,
    approvedPatterns: string[]
  ) => void
  handlePermissionDeny: (sessionId: string) => void
  handleCodexMcpElicitationRespond: (
    sessionId: string,
    rpcId: number,
    action: 'accept' | 'decline' | 'cancel',
    content: Record<string, unknown> | null
  ) => void
  handleFixFinding: (
    finding: ReviewFinding,
    customSuggestion?: string
  ) => Promise<void>
  handleFixAllFindings: (
    findingsWithSuggestions: { finding: ReviewFinding; suggestion?: string }[]
  ) => Promise<void>
}

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

function getBackendFromModel(
  model: string | null | undefined
): Session['backend'] | undefined {
  if (!model) return undefined
  if (model.startsWith('opencode/')) {
    return 'opencode'
  }
  if (model.startsWith('codex') || model.includes('codex')) {
    return 'codex'
  }
  return undefined
}

function getPlanApprovalPromptOptions(
  preferences: AppPreferences | undefined
): {
  configuredBuildPrompt?: string | null
  configuredYoloPrompt?: string | null
  configuredCodexPrompt?: string | null
} {
  return {
    configuredBuildPrompt: preferences?.magic_prompts?.plan_approval_build,
    configuredYoloPrompt: preferences?.magic_prompts?.plan_approval_yolo,
    configuredCodexPrompt: preferences?.magic_prompts?.plan_approval_codex,
  }
}

/**
 * Hook that extracts message-related handlers from ChatWindow.
 *
 * PERFORMANCE: Uses refs for session/worktree IDs to keep callbacks stable across session switches.
 */
export function useMessageHandlers({
  activeSessionIdRef,
  activeWorktreeIdRef,
  activeWorktreePathRef,
  selectedModelRef,
  buildModelRef,
  buildBackendRef,
  buildThinkingLevelRef,
  buildEffortLevelRef,
  yoloModelRef,
  yoloBackendRef,
  yoloThinkingLevelRef,
  yoloEffortLevelRef,
  getCustomProfileName,
  executionModeRef,
  selectedThinkingLevelRef,
  selectedEffortLevelRef,
  useAdaptiveThinkingRef,
  getMcpConfig,
  sendMessage,
  createSession,
  queryClient,
  scrollToBottom,
  markAtBottom,
  inputRef,
  pendingPlanMessage,
  projectIdRef,
}: UseMessageHandlersParams): MessageHandlers {
  'use no memo'

  const getEffectiveSessionBackend = useCallback(
    (sessionId: string): Session['backend'] => {
      const session = queryClient.getQueryData<Session>(
        chatQueryKeys.session(sessionId)
      )
      const preferences = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )

      return (
        getBackendFromModel(session?.selected_model) ??
        session?.backend ??
        useChatStore.getState().selectedBackends[sessionId] ??
        preferences?.default_backend ??
        'claude'
      )
    },
    [queryClient]
  )

  const clearCachedWaitingState = useCallback(
    (
      sessionId: string,
      worktreeId: string,
      worktreePath: string,
      selectedExecutionMode?: ExecutionMode,
      clearPermissionState = false
    ) => {
      queryClient.setQueryData<Session>(
        chatQueryKeys.session(sessionId),
        old =>
          old
            ? {
                ...old,
                waiting_for_input: false,
                waiting_for_input_type: null,
                pending_plan_message_id: undefined,
                ...(clearPermissionState
                  ? {
                      pending_permission_denials: [],
                      pending_codex_mcp_elicitations: [],
                      denied_message_context: undefined,
                    }
                  : {}),
                ...(selectedExecutionMode
                  ? { selected_execution_mode: selectedExecutionMode }
                  : {}),
              }
            : old
      )
      queryClient.setQueryData<WorktreeSessions>(
        chatQueryKeys.sessions(worktreeId),
        old => {
          if (!old) return old
          return {
            ...old,
            sessions: old.sessions.map(session =>
              session.id === sessionId
                ? {
                    ...session,
                    waiting_for_input: false,
                    waiting_for_input_type: null,
                    pending_plan_message_id: undefined,
                    ...(clearPermissionState
                      ? {
                          pending_permission_denials: [],
                          pending_codex_mcp_elicitations: [],
                          denied_message_context: undefined,
                        }
                      : {}),
                    ...(selectedExecutionMode
                      ? { selected_execution_mode: selectedExecutionMode }
                      : {}),
                  }
                : session
            ),
          }
        }
      )
      queryClient.setQueryData<AllSessionsResponse>(['all-sessions'], old => {
        if (!old) return old

        return {
          ...old,
          entries: old.entries.map(entry =>
            entry.worktree_id === worktreeId
              ? {
                  ...entry,
                  sessions: entry.sessions.map(session =>
                    session.id === sessionId
                      ? {
                          ...session,
                          waiting_for_input: false,
                          waiting_for_input_type: null,
                          pending_plan_message_id: undefined,
                          ...(clearPermissionState
                            ? {
                                pending_permission_denials: [],
                                pending_codex_mcp_elicitations: [],
                                denied_message_context: undefined,
                              }
                            : {}),
                          ...(selectedExecutionMode
                            ? {
                                selected_execution_mode: selectedExecutionMode,
                              }
                            : {}),
                        }
                      : session
                  ),
                }
              : entry
          ),
        }
      })
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.unreadSessions(),
      })
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.unreadCount(),
      })

      invoke('update_session_state', {
        worktreeId,
        worktreePath,
        sessionId,
        waitingForInput: false,
        waitingForInputType: null,
        ...(clearPermissionState
          ? {
              pendingPermissionDenials: [],
              pendingCodexMcpElicitations: [],
              deniedMessageContext: null,
            }
          : {}),
        selectedExecutionMode,
      }).catch(err => {
        logger.error(
          '[useMessageHandlers] Failed to persist cleared waiting state:',
          err
        )
      })
    },
    [queryClient]
  )

  // Handle answer submission for AskUserQuestion
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handleQuestionAnswer = useCallback(
    (toolCallId: string, answers: QuestionAnswer[], questions: Question[]) => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      // Mark as answered so it becomes read-only (also stores answers for collapsed view)
      const {
        markQuestionAnswered,
        addSendingSession,
        removeSendingSession,
        setSelectedModel,
        setExecutingMode,
        setSessionReviewing,
        setWaitingForInput,
        clearToolCalls,
        clearStreamingContentBlocks,
      } = useChatStore.getState()
      markQuestionAnswered(sessionId, toolCallId, answers)

      const activeQuestionTool = useChatStore
        .getState()
        .activeToolCalls[sessionId]?.find(tc => tc.id === toolCallId)
      const questionInput = activeQuestionTool?.input as
        | AskUserQuestionInput
        | undefined
      const rpcId = questionInput?.rpcId

      if (typeof rpcId === 'number') {
        setSessionReviewing(sessionId, false)
        setWaitingForInput(sessionId, false)
        addSendingSession(sessionId)
        invoke('answer_codex_user_input', {
          sessionId,
          rpcId,
          answers: formatAnswersForCodexRequestUserInput(questions, answers),
        }).catch(err => {
          removeSendingSession(sessionId)
          setWaitingForInput(sessionId, true)
          logger.error(
            '[useMessageHandlers] Failed to answer Codex user-input request:',
            err
          )
          toast.error('Failed to answer Codex question')
        })
        invoke('update_session_state', {
          worktreeId,
          worktreePath,
          sessionId,
          waitingForInput: false,
          waitingForInputType: null,
        }).catch(err => {
          logger.error(
            '[useMessageHandlers] Failed to clear waiting state:',
            err
          )
        })
        return
      }

      // Clear the preserved tool calls and review state since we're sending a response
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)

      // Persist cleared waiting state to backend (for canvas view where session may not be active)
      invoke('update_session_state', {
        worktreeId,
        worktreePath,
        sessionId,
        waitingForInput: false,
        waitingForInputType: null,
      }).catch(err => {
        logger.error('[useMessageHandlers] Failed to clear waiting state:', err)
      })

      // Mark as at-bottom so Tier 4 / Tier 2 auto-scroll kicks in when
      // streaming starts. Don't physically scroll — let native CSS scroll
      // anchoring handle the question form collapse smoothly.
      markAtBottom()

      // Format answers as natural language
      const message = formatAnswersAsNaturalLanguage(questions, answers)

      // Add to sending state
      addSendingSession(sessionId)
      setSelectedModel(sessionId, selectedModelRef.current)
      setExecutingMode(sessionId, executionModeRef.current)

      // Send the formatted answer
      sendMessage.mutate(
        {
          sessionId,
          worktreeId,
          worktreePath,
          message,
          model: selectedModelRef.current,
          executionMode: executionModeRef.current,
          thinkingLevel: selectedThinkingLevelRef.current,
          effortLevel: useAdaptiveThinkingRef.current
            ? selectedEffortLevelRef.current
            : undefined,
          mcpConfig: getMcpConfig(),
          customProfileName: getCustomProfileName(),
        },
        {
          onSettled: () => {
            inputRef.current?.focus()
          },
        }
      )
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      executionModeRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      sendMessage,
      markAtBottom,
      inputRef,
    ]
  )

  // Handle skipping questions - cancels the question flow without sending anything to Claude
  // Sets session-level skip state to auto-skip all subsequent questions until next user message
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handleSkipQuestion = useCallback(
    (toolCallId: string) => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      const {
        markQuestionAnswered,
        setQuestionsSkipped,
        addSendingSession,
        clearToolCalls,
        clearStreamingContentBlocks,
        removeSendingSession,
        setWaitingForInput,
        setSessionReviewing,
      } = useChatStore.getState()

      // Mark this question as answered (empty answers = skipped)
      markQuestionAnswered(sessionId, toolCallId, [])

      const activeQuestionTool = useChatStore
        .getState()
        .activeToolCalls[sessionId]?.find(tc => tc.id === toolCallId)
      const questionInput = activeQuestionTool?.input as
        | AskUserQuestionInput
        | undefined
      const rpcId = questionInput?.rpcId

      if (typeof rpcId === 'number') {
        setSessionReviewing(sessionId, false)
        setWaitingForInput(sessionId, false)
        addSendingSession(sessionId)
        invoke('answer_codex_user_input', {
          sessionId,
          rpcId,
          answers: formatAnswersForCodexRequestUserInput(
            questionInput?.questions ?? [],
            []
          ),
        }).catch(err => {
          removeSendingSession(sessionId)
          setWaitingForInput(sessionId, true)
          logger.error(
            '[useMessageHandlers] Failed to skip Codex user-input request:',
            err
          )
          toast.error('Failed to skip Codex question')
        })
        invoke('update_session_state', {
          worktreeId,
          worktreePath,
          sessionId,
          waitingForInput: false,
          waitingForInputType: null,
        }).catch(err => {
          logger.error(
            '[useMessageHandlers] Failed to clear waiting state:',
            err
          )
        })
        return
      }

      // Set session-level skip state to auto-skip all subsequent questions
      // No message is sent to Claude - the flow is simply cancelled
      setQuestionsSkipped(sessionId, true)

      // Clear the preserved tool calls and sending state since we're done with this interaction
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      removeSendingSession(sessionId)

      // Clear waiting state and mark as reviewing since interaction is complete
      setWaitingForInput(sessionId, false)
      setSessionReviewing(sessionId, true)

      // Persist cleared waiting state to backend (for canvas view where session may not be active)
      invoke('update_session_state', {
        worktreeId,
        worktreePath,
        sessionId,
        waitingForInput: false,
        waitingForInputType: null,
      }).catch(err => {
        logger.error('[useMessageHandlers] Failed to clear waiting state:', err)
      })

      // Focus input so user can type their next message
      inputRef.current?.focus()
    },
    [activeSessionIdRef, activeWorktreeIdRef, activeWorktreePathRef, inputRef]
  )

  // Handle plan approval for ExitPlanMode
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handlePlanApproval = useCallback(
    (messageId: string, updatedPlan?: string) => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      const {
        addSendingSession,
        setSelectedModel,
        setLastSentMessage,
        setError,
        setExecutingMode,
      } = useChatStore.getState()

      // Mark as at-bottom so Tier 4 / Tier 2 auto-scroll kicks in when
      // streaming starts. Don't physically scroll — let native CSS scroll
      // anchoring handle the plan collapse smoothly.
      markAtBottom()

      // Format approval message - include updated plan if provided
      // For Codex: use explicit execution instruction since it resumes a thread
      const preferences = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const sessionBackend = getEffectiveSessionBackend(sessionId)
      const message = buildPlanApprovalMessage({
        mode: 'build',
        backend: sessionBackend,
        updatedPlan,
        ...getPlanApprovalPromptOptions(preferences),
      })
      // Send approval message so the backend continues with execution
      // NOTE: setLastSentMessage is critical for permission denial flow - without it,
      // the denied message context won't be set and approval UI won't work
      const buildBackendOverride = buildBackendRef.current
      const overridesApply =
        !buildBackendOverride || buildBackendOverride === sessionBackend
      const buildModel = overridesApply
        ? (buildModelRef.current ?? selectedModelRef.current)
        : selectedModelRef.current
      const buildThinking =
        overridesApply && isThinkingLevel(buildThinkingLevelRef.current)
          ? buildThinkingLevelRef.current
          : selectedThinkingLevelRef.current
      const buildEffort =
        overridesApply && buildEffortLevelRef.current
          ? (buildEffortLevelRef.current as EffortLevel)
          : selectedEffortLevelRef.current
      setLastSentMessage(sessionId, message)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, buildModel)
      setExecutingMode(sessionId, 'build')

      completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        nextExecutionMode: 'build',
        logContext: 'useMessageHandlers',
      }).finally(() => {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })

        sendMessage.mutate(
          {
            sessionId,
            worktreeId,
            worktreePath,
            message,
            model: buildModel,
            executionMode: 'build',
            thinkingLevel: buildThinking,
            effortLevel: useAdaptiveThinkingRef.current
              ? buildEffort
              : undefined,
            mcpConfig: getMcpConfig(),
            customProfileName: getCustomProfileName(),
          },
          {
            onSettled: () => {
              inputRef.current?.focus()
            },
          }
        )
      })
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getEffectiveSessionBackend,
      buildModelRef,
      buildBackendRef,
      buildThinkingLevelRef,
      buildEffortLevelRef,
      getMcpConfig,
      getCustomProfileName,
      markAtBottom,
      sendMessage,
      queryClient,
      inputRef,
    ]
  )

  // Handle plan approval with yolo mode (auto-approve all future tools)
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handlePlanApprovalYolo = useCallback(
    (messageId: string, updatedPlan?: string) => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      const {
        addSendingSession,
        setSelectedModel,
        setLastSentMessage,
        setError,
        setExecutingMode,
      } = useChatStore.getState()

      // Mark as at-bottom so Tier 4 / Tier 2 auto-scroll kicks in when
      // streaming starts. Don't physically scroll — let native CSS scroll
      // anchoring handle the plan collapse smoothly.
      markAtBottom()

      // Format approval message - include updated plan if provided
      const preferences = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const sessionBackendYolo = getEffectiveSessionBackend(sessionId)
      const message = buildPlanApprovalMessage({
        mode: 'yolo',
        backend: sessionBackendYolo,
        updatedPlan,
        ...getPlanApprovalPromptOptions(preferences),
      })
      // Resolve yolo overrides (skip if backend override doesn't match session)
      const yoloBackendOverride = yoloBackendRef.current
      const yoloOverridesApply =
        !yoloBackendOverride || yoloBackendOverride === sessionBackendYolo
      const yoloModel = yoloOverridesApply
        ? (yoloModelRef.current ?? selectedModelRef.current)
        : selectedModelRef.current
      const yoloThinking =
        yoloOverridesApply && isThinkingLevel(yoloThinkingLevelRef.current)
          ? yoloThinkingLevelRef.current
          : selectedThinkingLevelRef.current
      const yoloEffort =
        yoloOverridesApply && yoloEffortLevelRef.current
          ? (yoloEffortLevelRef.current as EffortLevel)
          : selectedEffortLevelRef.current
      // Send approval message so the backend continues with execution
      setLastSentMessage(sessionId, message)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, yoloModel)
      setExecutingMode(sessionId, 'yolo')

      completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        nextExecutionMode: 'yolo',
        logContext: 'useMessageHandlers',
      }).finally(() => {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })

        sendMessage.mutate(
          {
            sessionId,
            worktreeId,
            worktreePath,
            message,
            model: yoloModel,
            executionMode: 'yolo',
            thinkingLevel: yoloThinking,
            effortLevel: useAdaptiveThinkingRef.current
              ? yoloEffort
              : undefined,
            mcpConfig: getMcpConfig(),
            customProfileName: getCustomProfileName(),
          },
          {
            onSettled: () => {
              inputRef.current?.focus()
            },
          }
        )
      })
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getEffectiveSessionBackend,
      yoloModelRef,
      yoloBackendRef,
      yoloThinkingLevelRef,
      yoloEffortLevelRef,
      getMcpConfig,
      getCustomProfileName,
      markAtBottom,
      sendMessage,
      queryClient,
      inputRef,
    ]
  )

  // Callback for floating button pending plan approval
  const handlePendingPlanApprovalCallback = useCallback(() => {
    if (pendingPlanMessage) {
      handlePlanApproval(pendingPlanMessage.id)
    }
  }, [pendingPlanMessage, handlePlanApproval])

  // Handle plan approval during streaming (when message isn't persisted yet)
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handleStreamingPlanApproval = useCallback(() => {
    const sessionId = activeSessionIdRef.current
    const worktreeId = activeWorktreeIdRef.current
    const worktreePath = activeWorktreePathRef.current
    if (!sessionId || !worktreeId || !worktreePath) return

    // Mark as approved in streaming state (prevents double-approval)
    const {
      setStreamingPlanApproved,
      setExecutionMode: setMode,
      setSelectedModel,
      setLastSentMessage,
      setError,
      addSendingSession,
      setExecutingMode,
      setSessionReviewing,
      setWaitingForInput,
      clearToolCalls,
      clearStreamingContentBlocks,
    } = useChatStore.getState()
    setStreamingPlanApproved(sessionId, true)

    // Clear the preserved tool calls and review state since we're sending a response
    clearToolCalls(sessionId)
    clearStreamingContentBlocks(sessionId)
    setSessionReviewing(sessionId, false)
    setWaitingForInput(sessionId, false)

    // Mark as at-bottom so Tier 4 / Tier 2 auto-scroll kicks in when
    // streaming starts. Don't physically scroll — let native CSS scroll
    // anchoring handle the plan collapse smoothly.
    markAtBottom()

    // Resolve build overrides (skip if backend override doesn't match session)
    const streamBuildSessionBackend = getEffectiveSessionBackend(sessionId)
    const streamBuildBackendOverride = buildBackendRef.current
    const streamBuildOverridesApply =
      !streamBuildBackendOverride ||
      streamBuildBackendOverride === streamBuildSessionBackend
    const streamBuildModel = streamBuildOverridesApply
      ? (buildModelRef.current ?? selectedModelRef.current)
      : selectedModelRef.current
    const streamBuildThinking =
      streamBuildOverridesApply &&
      isThinkingLevel(buildThinkingLevelRef.current)
        ? buildThinkingLevelRef.current
        : selectedThinkingLevelRef.current
    const streamBuildEffort =
      streamBuildOverridesApply && buildEffortLevelRef.current
        ? (buildEffortLevelRef.current as EffortLevel)
        : selectedEffortLevelRef.current
    // Explicitly set to build mode (not toggle, to avoid switching back to plan if already in build)
    setMode(sessionId, 'build')
    setSelectedModel(sessionId, streamBuildModel)

    // Send approval message to Claude so it continues with execution
    // NOTE: setLastSentMessage is critical for permission denial flow - without it,
    // the denied message context won't be set and approval UI won't work
    const preferences = queryClient.getQueryData<AppPreferences>(
      preferencesQueryKeys.preferences()
    )
    const buildApprovalMsg = buildPlanApprovalMessage({
      mode: 'build',
      backend: streamBuildSessionBackend,
      ...getPlanApprovalPromptOptions(preferences),
    })
    setLastSentMessage(sessionId, buildApprovalMsg)
    setError(sessionId, null)
    addSendingSession(sessionId)
    setExecutingMode(sessionId, 'build')

    sendMessage.mutate(
      {
        sessionId,
        worktreeId,
        worktreePath,
        message: buildApprovalMsg,
        model: streamBuildModel,
        executionMode: 'build',
        thinkingLevel: streamBuildThinking,
        effortLevel: useAdaptiveThinkingRef.current
          ? streamBuildEffort
          : undefined,
        mcpConfig: getMcpConfig(),
        customProfileName: getCustomProfileName(),
      },
      {
        onSettled: () => {
          inputRef.current?.focus()
        },
      }
    )
  }, [
    activeSessionIdRef,
    activeWorktreeIdRef,
    activeWorktreePathRef,
    selectedModelRef,
    selectedThinkingLevelRef,
    selectedEffortLevelRef,
    useAdaptiveThinkingRef,
    getEffectiveSessionBackend,
    buildModelRef,
    buildBackendRef,
    buildThinkingLevelRef,
    buildEffortLevelRef,
    getMcpConfig,
    getCustomProfileName,
    markAtBottom,
    sendMessage,
    inputRef,
  ])

  // Handle plan approval during streaming with yolo mode (auto-approve all future tools)
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handleStreamingPlanApprovalYolo = useCallback(() => {
    const sessionId = activeSessionIdRef.current
    const worktreeId = activeWorktreeIdRef.current
    const worktreePath = activeWorktreePathRef.current
    if (!sessionId || !worktreeId || !worktreePath) return

    // Mark as approved in streaming state (prevents double-approval)
    const {
      setStreamingPlanApproved,
      setExecutionMode: setMode,
      setSelectedModel,
      setLastSentMessage,
      setError,
      addSendingSession,
      setExecutingMode,
      setSessionReviewing,
      setWaitingForInput,
      clearToolCalls,
      clearStreamingContentBlocks,
    } = useChatStore.getState()
    setStreamingPlanApproved(sessionId, true)

    // Clear the preserved tool calls and review state since we're sending a response
    clearToolCalls(sessionId)
    clearStreamingContentBlocks(sessionId)
    setSessionReviewing(sessionId, false)
    setWaitingForInput(sessionId, false)

    // Mark as at-bottom so Tier 4 / Tier 2 auto-scroll kicks in when
    // streaming starts. Don't physically scroll — let native CSS scroll
    // anchoring handle the plan collapse smoothly.
    markAtBottom()

    // Resolve yolo overrides (skip if backend override doesn't match session)
    const streamYoloSessionBackend = getEffectiveSessionBackend(sessionId)
    const streamYoloBackendOverride = yoloBackendRef.current
    const streamYoloOverridesApply =
      !streamYoloBackendOverride ||
      streamYoloBackendOverride === streamYoloSessionBackend
    const streamYoloModel = streamYoloOverridesApply
      ? (yoloModelRef.current ?? selectedModelRef.current)
      : selectedModelRef.current
    const streamYoloThinking =
      streamYoloOverridesApply && isThinkingLevel(yoloThinkingLevelRef.current)
        ? yoloThinkingLevelRef.current
        : selectedThinkingLevelRef.current
    const streamYoloEffort =
      streamYoloOverridesApply && yoloEffortLevelRef.current
        ? (yoloEffortLevelRef.current as EffortLevel)
        : selectedEffortLevelRef.current
    // Set to yolo mode for auto-approval of all future tools
    setMode(sessionId, 'yolo')
    setSelectedModel(sessionId, streamYoloModel)

    // Send approval message to Claude so it continues with execution
    const preferences = queryClient.getQueryData<AppPreferences>(
      preferencesQueryKeys.preferences()
    )
    const yoloApprovalMsg = buildPlanApprovalMessage({
      mode: 'yolo',
      backend: streamYoloSessionBackend,
      ...getPlanApprovalPromptOptions(preferences),
    })
    setLastSentMessage(sessionId, yoloApprovalMsg)
    setError(sessionId, null)
    addSendingSession(sessionId)
    setExecutingMode(sessionId, 'yolo')

    sendMessage.mutate(
      {
        sessionId,
        worktreeId,
        worktreePath,
        message: yoloApprovalMsg,
        model: streamYoloModel,
        executionMode: 'yolo',
        thinkingLevel: streamYoloThinking,
        effortLevel: useAdaptiveThinkingRef.current
          ? streamYoloEffort
          : undefined,
        mcpConfig: getMcpConfig(),
        customProfileName: getCustomProfileName(),
      },
      {
        onSettled: () => {
          inputRef.current?.focus()
        },
      }
    )
  }, [
    activeSessionIdRef,
    activeWorktreeIdRef,
    activeWorktreePathRef,
    selectedModelRef,
    selectedThinkingLevelRef,
    selectedEffortLevelRef,
    useAdaptiveThinkingRef,
    getEffectiveSessionBackend,
    yoloModelRef,
    yoloBackendRef,
    yoloThinkingLevelRef,
    yoloEffortLevelRef,
    getMcpConfig,
    getCustomProfileName,
    markAtBottom,
    sendMessage,
    inputRef,
  ])

  // Handle clear context approval for persisted messages
  // Resolves plan content from message tool calls, marks approved, creates new session, sends plan
  const handleClearContextApproval = useCallback(
    async (messageId: string, mode: 'yolo' | 'build' = 'yolo') => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      // Get the message to extract plan content
      const sessionData = queryClient.getQueryData<Session>(
        chatQueryKeys.session(sessionId)
      )
      const message = sessionData?.messages.find(m => m.id === messageId)
      if (!message?.tool_calls) {
        toast.error('No plan content available')
        return
      }

      // Resolve plan content from tool calls
      let planContent = findPlanContent(message.tool_calls)
      if (!planContent) {
        const planFilePath = findPlanFilePath(message.tool_calls)
        if (planFilePath) {
          try {
            planContent = await readPlanFile(planFilePath)
          } catch (err) {
            toast.error(`Failed to read plan file: ${err}`)
            return
          }
        }
      }
      if (!planContent) {
        toast.error('No plan content available')
        return
      }

      // Mark plan approved on original session
      void completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        logContext: 'clearContext',
      }).finally(() => {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })
      })

      const store = useChatStore.getState()

      // Create new session
      let newSession: Session
      try {
        newSession = await createSession.mutateAsync({
          worktreeId,
          worktreePath,
        })
      } catch (err) {
        toast.error(`Failed to create session: ${err}`)
        return
      }

      // Switch to new session
      store.setActiveSession(worktreeId, newSession.id)

      // Resolve model/backend/thinking based on mode
      const isYolo = mode === 'yolo'
      const modeModelRef = isYolo ? yoloModelRef : buildModelRef
      const modeBackendRef = isYolo ? yoloBackendRef : buildBackendRef
      const modeThinkingRef = isYolo
        ? yoloThinkingLevelRef
        : buildThinkingLevelRef
      const modeEffortRef = isYolo ? yoloEffortLevelRef : buildEffortLevelRef

      const currentSessionBackend = queryClient.getQueryData<Session>(
        chatQueryKeys.session(sessionId)
      )?.backend
      const prefs = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const continuation = resolveApprovedPlanContinuation({
        mode,
        planContent,
        originalBackend: currentSessionBackend,
        originalModel: selectedModelRef.current,
        preferences: prefs,
        modeBackendOverride: modeBackendRef.current,
        modeModelOverride: modeModelRef.current,
        modeThinkingOverride: modeThinkingRef.current,
        modeEffortOverride: modeEffortRef.current,
        fallbackThinkingLevel: selectedThinkingLevelRef.current,
        fallbackEffortLevel: selectedEffortLevelRef.current,
        useAdaptiveThinking: useAdaptiveThinkingRef.current,
        returnOriginalBackend: false,
        useNonAdaptiveEffortOverride: false,
      })
      await sendApprovedPlanContinuation({
        queryClient,
        sendMessage,
        target: {
          sessionId: newSession.id,
          worktreeId,
          worktreePath,
        },
        mode,
        continuation,
        logContext: 'clearContext',
        mcpConfig: getMcpConfig(),
        customProfileName: getCustomProfileName(),
      })

      closeOriginalApprovedSession({
        queryClient,
        preferences: prefs,
        worktreeId,
        worktreePath,
        sessionId,
        replacementSessionId: newSession.id,
        logContext: 'useMessageHandlers',
      })
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      buildModelRef,
      buildBackendRef,
      buildThinkingLevelRef,
      buildEffortLevelRef,
      yoloModelRef,
      yoloBackendRef,
      yoloThinkingLevelRef,
      yoloEffortLevelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      createSession,
      sendMessage,
      queryClient,
    ]
  )

  // Handle clear context approval during streaming
  const handleStreamingClearContextApproval = useCallback(
    async (mode: 'yolo' | 'build' = 'yolo') => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      // Get streaming content blocks to extract plan content
      const store = useChatStore.getState()
      const contentBlocks = store.streamingContentBlocks[sessionId]
      const toolCalls = store.activeToolCalls[sessionId]

      // Try to get plan content from tool calls first, then from streaming blocks
      let planContent: string | null = null
      if (toolCalls) {
        planContent = findPlanContent(toolCalls)
        if (!planContent) {
          const planFilePath = findPlanFilePath(toolCalls)
          if (planFilePath) {
            try {
              planContent = await readPlanFile(planFilePath)
            } catch {
              // Fall through to content blocks
            }
          }
        }
      }

      if (!planContent && contentBlocks) {
        // Try to extract from streaming content blocks (text content)
        for (const block of contentBlocks) {
          if ('text' in block && block.text) {
            planContent = block.text
            break
          }
        }
      }

      if (!planContent) {
        toast.error('No plan content available')
        return
      }

      // Mark as approved in streaming state
      store.setStreamingPlanApproved(sessionId, true)
      store.clearToolCalls(sessionId)
      store.clearStreamingContentBlocks(sessionId)
      store.setSessionReviewing(sessionId, false)
      store.setWaitingForInput(sessionId, false)

      // Create new session
      let newSession: Session
      try {
        newSession = await createSession.mutateAsync({
          worktreeId,
          worktreePath,
        })
      } catch (err) {
        toast.error(`Failed to create session: ${err}`)
        return
      }

      // Switch to new session
      store.setActiveSession(worktreeId, newSession.id)

      // Resolve model/backend/thinking based on mode
      const isYolo = mode === 'yolo'
      const modeModelRef = isYolo ? yoloModelRef : buildModelRef
      const modeBackendRef = isYolo ? yoloBackendRef : buildBackendRef
      const modeThinkingRef = isYolo
        ? yoloThinkingLevelRef
        : buildThinkingLevelRef
      const modeEffortRef = isYolo ? yoloEffortLevelRef : buildEffortLevelRef

      const currentSessionBackend = queryClient.getQueryData<Session>(
        chatQueryKeys.session(sessionId)
      )?.backend
      const prefs = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const continuation = resolveApprovedPlanContinuation({
        mode,
        planContent,
        originalBackend: currentSessionBackend,
        originalModel: selectedModelRef.current,
        preferences: prefs,
        modeBackendOverride: modeBackendRef.current,
        modeModelOverride: modeModelRef.current,
        modeThinkingOverride: modeThinkingRef.current,
        modeEffortOverride: modeEffortRef.current,
        fallbackThinkingLevel: selectedThinkingLevelRef.current,
        fallbackEffortLevel: selectedEffortLevelRef.current,
        useAdaptiveThinking: useAdaptiveThinkingRef.current,
        returnOriginalBackend: false,
        useNonAdaptiveEffortOverride: false,
      })
      await sendApprovedPlanContinuation({
        queryClient,
        sendMessage,
        target: {
          sessionId: newSession.id,
          worktreeId,
          worktreePath,
        },
        mode,
        continuation,
        logContext: 'streamingClearContext',
        mcpConfig: getMcpConfig(),
        customProfileName: getCustomProfileName(),
      })

      closeOriginalApprovedSession({
        queryClient,
        preferences: prefs,
        worktreeId,
        worktreePath,
        sessionId,
        replacementSessionId: newSession.id,
        logContext: 'useMessageHandlers',
      })
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      buildModelRef,
      buildBackendRef,
      buildThinkingLevelRef,
      buildEffortLevelRef,
      yoloModelRef,
      yoloBackendRef,
      yoloThinkingLevelRef,
      yoloEffortLevelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      createSession,
      sendMessage,
      queryClient,
    ]
  )

  const handleClearContextApprovalBuild = useCallback(
    (messageId: string) => handleClearContextApproval(messageId, 'build'),
    [handleClearContextApproval]
  )

  const handleStreamingClearContextApprovalBuild = useCallback(
    () => handleStreamingClearContextApproval('build'),
    [handleStreamingClearContextApproval]
  )

  // Handle worktree approval (create new worktree + send plan)
  const handleWorktreeApproval = useCallback(
    async (messageId: string, mode: 'yolo' | 'build' = 'build') => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      const projectId = projectIdRef.current
      if (!sessionId || !worktreeId || !worktreePath || !projectId) return

      // Get the message to extract plan content
      const sessionData = queryClient.getQueryData<Session>(
        chatQueryKeys.session(sessionId)
      )
      const message = sessionData?.messages.find(m => m.id === messageId)
      if (!message?.tool_calls) {
        toast.error('No plan content available')
        return
      }

      // Resolve plan content from tool calls
      let planContent = findPlanContent(message.tool_calls)
      if (!planContent) {
        const planFilePath = findPlanFilePath(message.tool_calls)
        if (planFilePath) {
          try {
            planContent = await readPlanFile(planFilePath)
          } catch (err) {
            toast.error(`Failed to read plan file: ${err}`)
            return
          }
        }
      }
      if (!planContent) {
        toast.error('No plan content available')
        return
      }

      // Mark plan approved on original session
      void completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        logContext: 'worktreeApproval',
      }).finally(() => {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })
      })

      const store = useChatStore.getState()

      // Create new worktree
      let pendingWorktree: Worktree
      try {
        pendingWorktree = await invoke<Worktree>('create_worktree', {
          projectId,
        })
      } catch (err) {
        toast.error(`Failed to create worktree: ${err}`)
        return
      }
      markWorktreeSilentReady(pendingWorktree.id)

      // Wait for worktree to be ready
      let readyWorktree: Worktree
      try {
        readyWorktree = await new Promise<Worktree>((resolve, reject) => {
          const timeout = setTimeout(() => {
            void unlistenCreated.then(fn => fn())
            void unlistenError.then(fn => fn())
            reject(new Error('Worktree creation timed out'))
          }, 120_000)

          const unlistenCreated = listen<WorktreeCreatedEvent>(
            'worktree:created',
            event => {
              if (event.payload.worktree.id === pendingWorktree.id) {
                clearTimeout(timeout)
                void unlistenCreated.then(fn => fn())
                void unlistenError.then(fn => fn())
                resolve(event.payload.worktree)
              }
            }
          )

          const unlistenError = listen<WorktreeCreateErrorEvent>(
            'worktree:error',
            event => {
              if (event.payload.id === pendingWorktree.id) {
                clearTimeout(timeout)
                void unlistenCreated.then(fn => fn())
                void unlistenError.then(fn => fn())
                reject(new Error(event.payload.error))
              }
            }
          )
        })
      } catch (err) {
        toast.error(`Worktree creation failed: ${err}`)
        return
      }

      // Use the default session auto-created by the backend, or create one if none exists
      let newSession: Session
      try {
        const sessionsData = await invoke<WorktreeSessions>('get_sessions', {
          worktreeId: readyWorktree.id,
          worktreePath: readyWorktree.path,
        })
        if (sessionsData.sessions.length > 0 && sessionsData.sessions[0]) {
          newSession = sessionsData.sessions[0]
        } else {
          newSession = await invoke<Session>('create_session', {
            worktreeId: readyWorktree.id,
            worktreePath: readyWorktree.path,
          })
        }
      } catch (err) {
        toast.error(`Failed to get session: ${err}`)
        return
      }

      store.setActiveSession(readyWorktree.id, newSession.id)
      store.addUserInitiatedSession(newSession.id)
      const projectsStore = useProjectsStore.getState()
      const uiStore = useUIStore.getState()
      navigateToApprovedWorktree(
        readyWorktree,
        {
          activeWorktreePath: store.activeWorktreePath,
          sessionChatModalOpen: uiStore.sessionChatModalOpen,
        },
        {
          expandProject: projectsStore.expandProject,
          selectWorktree: projectsStore.selectWorktree,
          registerWorktreePath: store.registerWorktreePath,
          setActiveWorktree: store.setActiveWorktree,
          openWorktreeModal: (worktreeId, worktreePath) => {
            window.dispatchEvent(
              new CustomEvent('open-worktree-modal', {
                detail: { worktreeId, worktreePath },
              })
            )
          },
        }
      )

      // Resolve model/backend/thinking based on mode
      const isYolo = mode === 'yolo'
      const modeModelRef = isYolo ? yoloModelRef : buildModelRef
      const modeBackendRef = isYolo ? yoloBackendRef : buildBackendRef
      const modeThinkingRef = isYolo
        ? yoloThinkingLevelRef
        : buildThinkingLevelRef
      const modeEffortRef = isYolo ? yoloEffortLevelRef : buildEffortLevelRef

      const currentSessionBackend = queryClient.getQueryData<Session>(
        chatQueryKeys.session(sessionId)
      )?.backend
      const prefs = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const continuation = resolveApprovedPlanContinuation({
        mode,
        planContent,
        originalBackend: currentSessionBackend,
        originalModel: selectedModelRef.current,
        preferences: prefs,
        modeBackendOverride: modeBackendRef.current,
        modeModelOverride: modeModelRef.current,
        modeThinkingOverride: modeThinkingRef.current,
        modeEffortOverride: modeEffortRef.current,
        fallbackThinkingLevel: selectedThinkingLevelRef.current,
        fallbackEffortLevel: selectedEffortLevelRef.current,
        useAdaptiveThinking: useAdaptiveThinkingRef.current,
        returnOriginalBackend: false,
        useNonAdaptiveEffortOverride: false,
      })
      await sendApprovedPlanContinuation({
        queryClient,
        sendMessage,
        target: {
          sessionId: newSession.id,
          worktreeId: readyWorktree.id,
          worktreePath: readyWorktree.path,
        },
        mode,
        continuation,
        logContext: 'worktreeApproval',
        mcpConfig: getMcpConfig(),
        customProfileName: getCustomProfileName(),
      })

      closeOriginalApprovedSession({
        queryClient,
        preferences: prefs,
        worktreeId,
        worktreePath,
        sessionId,
        logContext: 'worktreeApproval',
      })
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      projectIdRef,
      selectedModelRef,
      buildModelRef,
      buildBackendRef,
      buildThinkingLevelRef,
      buildEffortLevelRef,
      yoloModelRef,
      yoloBackendRef,
      yoloThinkingLevelRef,
      yoloEffortLevelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      sendMessage,
      queryClient,
    ]
  )

  // Handle streaming worktree approval
  const handleStreamingWorktreeApproval = useCallback(
    async (mode: 'yolo' | 'build' = 'build') => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      const projectId = projectIdRef.current
      if (!sessionId || !worktreeId || !worktreePath || !projectId) return

      // Get streaming content blocks to extract plan content
      const store = useChatStore.getState()
      const contentBlocks = store.streamingContentBlocks[sessionId]
      const toolCalls = store.activeToolCalls[sessionId]

      let planContent: string | null = null
      if (toolCalls) {
        planContent = findPlanContent(toolCalls)
        if (!planContent) {
          const planFilePath = findPlanFilePath(toolCalls)
          if (planFilePath) {
            try {
              planContent = await readPlanFile(planFilePath)
            } catch {
              // Fall through to content blocks
            }
          }
        }
      }

      if (!planContent && contentBlocks) {
        for (const block of contentBlocks) {
          if ('text' in block && block.text) {
            planContent = block.text
            break
          }
        }
      }

      if (!planContent) {
        toast.error('No plan content available')
        return
      }

      // Mark as approved in streaming state
      store.setStreamingPlanApproved(sessionId, true)
      store.clearToolCalls(sessionId)
      store.clearStreamingContentBlocks(sessionId)
      store.setSessionReviewing(sessionId, false)
      store.setWaitingForInput(sessionId, false)

      // Create new worktree
      let pendingWorktree: Worktree
      try {
        pendingWorktree = await invoke<Worktree>('create_worktree', {
          projectId,
        })
      } catch (err) {
        toast.error(`Failed to create worktree: ${err}`)
        return
      }
      markWorktreeSilentReady(pendingWorktree.id)

      // Wait for worktree to be ready
      let readyWorktree: Worktree
      try {
        readyWorktree = await new Promise<Worktree>((resolve, reject) => {
          const timeout = setTimeout(() => {
            void unlistenCreated.then(fn => fn())
            void unlistenError.then(fn => fn())
            reject(new Error('Worktree creation timed out'))
          }, 120_000)

          const unlistenCreated = listen<WorktreeCreatedEvent>(
            'worktree:created',
            event => {
              if (event.payload.worktree.id === pendingWorktree.id) {
                clearTimeout(timeout)
                void unlistenCreated.then(fn => fn())
                void unlistenError.then(fn => fn())
                resolve(event.payload.worktree)
              }
            }
          )

          const unlistenError = listen<WorktreeCreateErrorEvent>(
            'worktree:error',
            event => {
              if (event.payload.id === pendingWorktree.id) {
                clearTimeout(timeout)
                void unlistenCreated.then(fn => fn())
                void unlistenError.then(fn => fn())
                reject(new Error(event.payload.error))
              }
            }
          )
        })
      } catch (err) {
        toast.error(`Worktree creation failed: ${err}`)
        return
      }

      const toastId = `worktree-plan-${sessionId}`
      toast.loading('Sending plan...', { id: toastId })

      // Navigate to new worktree
      const projectsStore = useProjectsStore.getState()
      projectsStore.expandProject(readyWorktree.project_id)
      projectsStore.selectWorktree(readyWorktree.id)
      store.registerWorktreePath(readyWorktree.id, readyWorktree.path)
      store.setActiveWorktree(readyWorktree.id, readyWorktree.path)
      // Use the default session auto-created by the backend, or create one if none exists
      let newSession: Session
      try {
        const sessionsData = await invoke<WorktreeSessions>('get_sessions', {
          worktreeId: readyWorktree.id,
          worktreePath: readyWorktree.path,
        })
        if (sessionsData.sessions.length > 0 && sessionsData.sessions[0]) {
          newSession = sessionsData.sessions[0]
        } else {
          newSession = await invoke<Session>('create_session', {
            worktreeId: readyWorktree.id,
            worktreePath: readyWorktree.path,
          })
        }
      } catch (err) {
        toast.error(`Failed to get session: ${err}`)
        return
      }

      store.setActiveSession(readyWorktree.id, newSession.id)
      store.addUserInitiatedSession(newSession.id)
      const uiStore = useUIStore.getState()
      navigateToApprovedWorktree(
        readyWorktree,
        {
          activeWorktreePath: store.activeWorktreePath,
          sessionChatModalOpen: uiStore.sessionChatModalOpen,
        },
        {
          expandProject: projectsStore.expandProject,
          selectWorktree: projectsStore.selectWorktree,
          registerWorktreePath: store.registerWorktreePath,
          setActiveWorktree: store.setActiveWorktree,
          openWorktreeModal: (worktreeId, worktreePath) => {
            window.dispatchEvent(
              new CustomEvent('open-worktree-modal', {
                detail: { worktreeId, worktreePath },
              })
            )
          },
        }
      )

      // Resolve model/backend/thinking based on mode
      const isYolo = mode === 'yolo'
      const modeModelRef = isYolo ? yoloModelRef : buildModelRef
      const modeBackendRef = isYolo ? yoloBackendRef : buildBackendRef
      const modeThinkingRef = isYolo
        ? yoloThinkingLevelRef
        : buildThinkingLevelRef
      const modeEffortRef = isYolo ? yoloEffortLevelRef : buildEffortLevelRef

      const currentSessionBackend = queryClient.getQueryData<Session>(
        chatQueryKeys.session(sessionId)
      )?.backend
      const prefs = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const continuation = resolveApprovedPlanContinuation({
        mode,
        planContent,
        originalBackend: currentSessionBackend,
        originalModel: selectedModelRef.current,
        preferences: prefs,
        modeBackendOverride: modeBackendRef.current,
        modeModelOverride: modeModelRef.current,
        modeThinkingOverride: modeThinkingRef.current,
        modeEffortOverride: modeEffortRef.current,
        fallbackThinkingLevel: selectedThinkingLevelRef.current,
        fallbackEffortLevel: selectedEffortLevelRef.current,
        useAdaptiveThinking: useAdaptiveThinkingRef.current,
        returnOriginalBackend: false,
        useNonAdaptiveEffortOverride: false,
      })
      await sendApprovedPlanContinuation({
        queryClient,
        sendMessage,
        target: {
          sessionId: newSession.id,
          worktreeId: readyWorktree.id,
          worktreePath: readyWorktree.path,
        },
        mode,
        continuation,
        logContext: 'streamingWorktreeApproval',
        mcpConfig: getMcpConfig(),
        customProfileName: getCustomProfileName(),
      })

      closeOriginalApprovedSession({
        queryClient,
        preferences: prefs,
        worktreeId,
        worktreePath,
        sessionId,
        logContext: 'streamingWorktreeApproval',
      })
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      projectIdRef,
      selectedModelRef,
      buildModelRef,
      buildBackendRef,
      buildThinkingLevelRef,
      buildEffortLevelRef,
      yoloModelRef,
      yoloBackendRef,
      yoloThinkingLevelRef,
      yoloEffortLevelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      sendMessage,
      queryClient,
    ]
  )

  const handleWorktreeBuildApproval = useCallback(
    (messageId: string) => handleWorktreeApproval(messageId, 'build'),
    [handleWorktreeApproval]
  )

  const handleWorktreeYoloApproval = useCallback(
    (messageId: string) => handleWorktreeApproval(messageId, 'yolo'),
    [handleWorktreeApproval]
  )

  const handleStreamingWorktreeBuildApproval = useCallback(
    () => handleStreamingWorktreeApproval('build'),
    [handleStreamingWorktreeApproval]
  )

  const handleStreamingWorktreeYoloApproval = useCallback(
    () => handleStreamingWorktreeApproval('yolo'),
    [handleStreamingWorktreeApproval]
  )

  // Handle permission approval (when tools require user approval)
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handlePermissionApproval = useCallback(
    (sessionId: string, approvedPatterns: string[]) => {
      logger.warn(
        '[useMessageHandlers] handlePermissionApproval CALLED',
        sessionId,
        approvedPatterns
      )
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!worktreeId || !worktreePath) return

      const {
        addApprovedTool,
        clearPendingDenials,
        getDeniedMessageContext,
        clearDeniedMessageContext,
        getApprovedTools,
        getPendingDenials,
        addSendingSession,
        setLastSentMessage,
        setError,
        setSelectedModel,
        setExecutingMode,
        setExecutionMode,
        setWaitingForInput,
      } = useChatStore.getState()
      const denials = getPendingDenials(sessionId)
      const isCodexApproval = denials.some(denial => denial.rpc_id != null)

      // Codex path: send approval response via JSON-RPC (process is still running)
      if (isCodexApproval) {
        const currentMode =
          useChatStore.getState().executionModes[sessionId] ??
          executionModeRef.current
        const nextMode = getCodexPermissionApprovalMode(currentMode, false)
        clearPendingDenials(sessionId)
        clearDeniedMessageContext(sessionId)
        setWaitingForInput(sessionId, false)
        clearCachedWaitingState(
          sessionId,
          worktreeId,
          worktreePath,
          nextMode,
          true
        )
        addSendingSession(sessionId)
        if (nextMode !== currentMode) {
          setExecutionMode(sessionId, nextMode)
          invoke('broadcast_session_setting', {
            sessionId,
            key: 'executionMode',
            value: nextMode,
          }).catch(err => {
            logger.error(
              '[useMessageHandlers] Codex broadcast executionMode failed:',
              err
            )
          })
          invoke('update_session_state', {
            worktreeId,
            worktreePath,
            sessionId,
            selectedExecutionMode: nextMode,
          }).catch(() => undefined)
        }

        requestAnimationFrame(() => {
          scrollToBottom(true)
        })

        // Send accept for each denial that has an rpc_id
        for (const denial of denials) {
          if (denial.rpc_id != null) {
            invoke('approve_codex_command', {
              sessionId,
              rpcId: denial.rpc_id,
              decision: 'accept',
            }).catch(err => {
              logger.error('[ChatWindow] Failed to approve Codex command:', err)
              toast.error(`Failed to approve command: ${err}`)
            })
          }
        }
        return
      }

      // Claude path: re-send message with approved tools
      for (const pattern of approvedPatterns) {
        addApprovedTool(sessionId, pattern)
      }

      const allApprovedTools = getApprovedTools(sessionId)

      const context = getDeniedMessageContext(sessionId)
      if (!context) {
        logger.error('[ChatWindow] No denied message context found for re-send')
        clearPendingDenials(sessionId)
        return
      }

      clearPendingDenials(sessionId)
      clearDeniedMessageContext(sessionId)
      setWaitingForInput(sessionId, false)
      setExecutionMode(sessionId, 'build')
      invoke('broadcast_session_setting', {
        sessionId,
        key: 'executionMode',
        value: 'build',
      }).catch(err => {
        logger.error(
          '[useMessageHandlers] Claude broadcast executionMode=build failed:',
          err
        )
      })
      invoke('update_session_state', {
        worktreeId,
        worktreePath,
        sessionId,
        selectedExecutionMode: 'build',
      }).catch(() => undefined)

      requestAnimationFrame(() => {
        scrollToBottom(true)
      })

      const bashCommands: string[] = []
      const otherPatterns: string[] = []
      for (const pattern of approvedPatterns) {
        const bashMatch = pattern.match(/^Bash\((.+)\)$/)
        if (bashMatch?.[1]) {
          bashCommands.push(bashMatch[1])
        } else {
          otherPatterns.push(pattern)
        }
      }

      let continuationMessage: string
      if (bashCommands.length > 0 && otherPatterns.length === 0) {
        if (bashCommands.length === 1) {
          continuationMessage = `I approved the command. Run it now: \`${bashCommands[0]}\``
        } else {
          continuationMessage = `I approved these commands. Run them now:\n${bashCommands.map(cmd => `- \`${cmd}\``).join('\n')}`
        }
      } else if (bashCommands.length > 0) {
        continuationMessage = `I approved: ${approvedPatterns.join(', ')}. Execute them now.`
      } else {
        continuationMessage = `I approved ${approvedPatterns.join(', ')}. Continue with the task.`
      }

      const modelToUse = context.model ?? selectedModelRef.current
      const modeToUse = context.executionMode ?? executionModeRef.current
      setLastSentMessage(sessionId, continuationMessage)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, modelToUse)
      setExecutingMode(sessionId, modeToUse)

      sendMessage.mutate(
        {
          sessionId,
          worktreeId,
          worktreePath,
          message: continuationMessage,
          model: modelToUse,
          executionMode: modeToUse,
          thinkingLevel:
            context.thinkingLevel ?? selectedThinkingLevelRef.current,
          effortLevel: useAdaptiveThinkingRef.current
            ? selectedEffortLevelRef.current
            : undefined,
          allowedTools: [...GIT_ALLOWED_TOOLS, ...allApprovedTools],
          mcpConfig: getMcpConfig(),
          customProfileName: getCustomProfileName(),
        },
        {
          onSettled: () => {
            inputRef.current?.focus()
          },
        }
      )
    },
    [
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      executionModeRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      scrollToBottom,
      sendMessage,
      inputRef,
      clearCachedWaitingState,
    ]
  )

  const handlePermissionApprovalAndPersist = useCallback(
    async (sessionId: string, approvedPatterns: string[]) => {
      const commands = approvedPatterns
        .map(commandFromBashPattern)
        .filter((command): command is string => command != null)

      if (commands.length === 0) {
        toast.error('No command rule to save')
        return
      }

      try {
        await Promise.all(commands.map(addGlobalCommandPermissionRule))
      } catch (err) {
        logger.error(
          '[useMessageHandlers] Failed to save command permission rule:',
          err
        )
        toast.error(`Failed to save command rule: ${err}`)
        return
      }

      toast.success('Command rule saved')
      handlePermissionApproval(sessionId, approvedPatterns)
    },
    [handlePermissionApproval]
  )

  // Handle permission approval with yolo mode (auto-approve all future tools)
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handlePermissionApprovalYolo = useCallback(
    (sessionId: string, approvedPatterns: string[]) => {
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!worktreeId || !worktreePath) return

      const {
        addApprovedTool,
        clearPendingDenials,
        getDeniedMessageContext,
        clearDeniedMessageContext,
        getPendingDenials,
        addSendingSession,
        setLastSentMessage,
        setError,
        setSelectedModel,
        setExecutingMode,
        setExecutionMode: setMode,
        setWaitingForInput,
      } = useChatStore.getState()
      const denials = getPendingDenials(sessionId)
      const isCodexApproval = denials.some(denial => denial.rpc_id != null)

      // Codex path: accept current denial and switch to yolo for future messages
      if (isCodexApproval) {
        const currentMode =
          useChatStore.getState().executionModes[sessionId] ??
          executionModeRef.current
        const nextMode = getCodexPermissionApprovalMode(currentMode, true)
        clearPendingDenials(sessionId)
        clearDeniedMessageContext(sessionId)
        setWaitingForInput(sessionId, false)
        clearCachedWaitingState(
          sessionId,
          worktreeId,
          worktreePath,
          nextMode,
          true
        )
        addSendingSession(sessionId)
        setMode(sessionId, nextMode)
        invoke('broadcast_session_setting', {
          sessionId,
          key: 'executionMode',
          value: nextMode,
        }).catch(err => {
          logger.error(
            '[useMessageHandlers] Codex broadcast executionMode=yolo failed:',
            err
          )
        })
        invoke('update_session_state', {
          worktreeId,
          worktreePath,
          sessionId,
          selectedExecutionMode: nextMode,
        }).catch(() => undefined)

        requestAnimationFrame(() => {
          scrollToBottom(true)
        })

        for (const denial of denials) {
          if (denial.rpc_id != null) {
            invoke('approve_codex_command', {
              sessionId,
              rpcId: denial.rpc_id,
              decision: 'accept',
            }).catch(err => {
              logger.error('[ChatWindow] Failed to approve Codex command:', err)
            })
          }
        }
        return
      }

      // Claude path
      for (const pattern of approvedPatterns) {
        addApprovedTool(sessionId, pattern)
      }

      const context = getDeniedMessageContext(sessionId)
      if (!context) {
        logger.error('[ChatWindow] No denied message context found for re-send')
        clearPendingDenials(sessionId)
        return
      }

      clearPendingDenials(sessionId)
      clearDeniedMessageContext(sessionId)
      setWaitingForInput(sessionId, false)

      // Scroll to bottom after DOM updates from collapsing the permission approval UI
      requestAnimationFrame(() => {
        scrollToBottom(true)
      })

      // Build explicit continuation message that tells Claude exactly what to run
      // Extract commands from Bash(command) patterns for a more direct instruction
      const bashCommands: string[] = []
      const otherPatterns: string[] = []
      for (const pattern of approvedPatterns) {
        const bashMatch = pattern.match(/^Bash\((.+)\)$/)
        if (bashMatch?.[1]) {
          bashCommands.push(bashMatch[1])
        } else {
          otherPatterns.push(pattern)
        }
      }

      // Build a message that explicitly asks Claude to run the commands
      let continuationMessage: string
      if (bashCommands.length > 0 && otherPatterns.length === 0) {
        // Only Bash commands - be very explicit
        if (bashCommands.length === 1) {
          continuationMessage = `I approved the command. Run it now: \`${bashCommands[0]}\``
        } else {
          continuationMessage = `I approved these commands. Run them now:\n${bashCommands.map(cmd => `- \`${cmd}\``).join('\n')}`
        }
      } else if (bashCommands.length > 0) {
        // Mix of Bash and other tools
        continuationMessage = `I approved: ${approvedPatterns.join(', ')}. Execute them now.`
      } else {
        // Only non-Bash tools
        continuationMessage = `I approved ${approvedPatterns.join(', ')}. Continue with the task.`
      }

      // Set to yolo mode for auto-approval of all future tools
      setMode(sessionId, 'yolo')

      // Send continuation with yolo mode (no need for allowedTools in yolo mode)
      const modelToUse = context.model ?? selectedModelRef.current
      setLastSentMessage(sessionId, continuationMessage)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, modelToUse)
      setExecutingMode(sessionId, 'yolo')

      sendMessage.mutate(
        {
          sessionId,
          worktreeId,
          worktreePath,
          message: continuationMessage,
          model: modelToUse,
          executionMode: 'yolo',
          thinkingLevel:
            context.thinkingLevel ?? selectedThinkingLevelRef.current,
          effortLevel: useAdaptiveThinkingRef.current
            ? selectedEffortLevelRef.current
            : undefined,
          mcpConfig: getMcpConfig(),
          customProfileName: getCustomProfileName(),
        },
        {
          onSettled: () => {
            inputRef.current?.focus()
          },
        }
      )
    },
    [
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      scrollToBottom,
      sendMessage,
      inputRef,
      clearCachedWaitingState,
    ]
  )

  // Handle permission denial (user cancels approval request)
  const handlePermissionDeny = useCallback(
    (sessionId: string) => {
      const {
        clearPendingDenials,
        clearDeniedMessageContext,
        getPendingDenials,
        setWaitingForInput,
        removeSendingSession,
      } = useChatStore.getState()
      const denials = getPendingDenials(sessionId)
      const isCodexApproval = denials.some(denial => denial.rpc_id != null)

      // For Codex: send decline response to unblock the attached process
      if (isCodexApproval) {
        for (const denial of denials) {
          if (denial.rpc_id != null) {
            invoke('approve_codex_command', {
              sessionId,
              rpcId: denial.rpc_id,
              decision: 'decline',
            }).catch(err => {
              logger.error('[ChatWindow] Failed to decline Codex command:', err)
            })
          }
        }
        clearPendingDenials(sessionId)
        clearDeniedMessageContext(sessionId)
        setWaitingForInput(sessionId, false)
        const worktreeId = activeWorktreeIdRef.current
        const worktreePath = activeWorktreePathRef.current
        if (worktreeId && worktreePath) {
          clearCachedWaitingState(
            sessionId,
            worktreeId,
            worktreePath,
            undefined,
            true
          )
        }
        toast.info('Request cancelled')
        return
      }

      clearPendingDenials(sessionId)
      clearDeniedMessageContext(sessionId)
      setWaitingForInput(sessionId, false)
      removeSendingSession(sessionId)
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (worktreeId && worktreePath) {
        clearCachedWaitingState(sessionId, worktreeId, worktreePath)
      }
      toast.info('Request cancelled')
    },
    [activeWorktreeIdRef, activeWorktreePathRef, clearCachedWaitingState]
  )

  const handleCodexMcpElicitationRespond = useCallback(
    (
      sessionId: string,
      rpcId: number,
      action: 'accept' | 'decline' | 'cancel',
      content: Record<string, unknown> | null
    ) => {
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!worktreeId || !worktreePath) return

      const {
        addSendingSession,
        getPendingDenials,
        getPendingCodexMcpElicitations,
        setPendingCodexMcpElicitations,
        clearPendingCodexMcpElicitations,
        clearDeniedMessageContext,
        setWaitingForInput,
      } = useChatStore.getState()

      const remainingDenials = getPendingDenials(sessionId)
      const remainingElicitations = getPendingCodexMcpElicitations(
        sessionId
      ).filter(elicitation => elicitation.rpc_id !== rpcId)
      const shouldKeepWaiting =
        remainingDenials.length > 0 || remainingElicitations.length > 0

      if (remainingElicitations.length > 0) {
        setPendingCodexMcpElicitations(sessionId, remainingElicitations)
      } else {
        clearPendingCodexMcpElicitations(sessionId)
      }

      if (remainingDenials.length === 0) {
        clearDeniedMessageContext(sessionId)
      }

      if (shouldKeepWaiting) {
        setWaitingForInput(sessionId, true)
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old =>
            old
              ? {
                  ...old,
                  waiting_for_input: true,
                  waiting_for_input_type: null,
                  pending_codex_mcp_elicitations: remainingElicitations,
                  ...(remainingDenials.length === 0
                    ? { denied_message_context: undefined }
                    : {}),
                }
              : old
        )
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktreeId),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(session =>
                session.id === sessionId
                  ? {
                      ...session,
                      waiting_for_input: true,
                      waiting_for_input_type: null,
                      pending_codex_mcp_elicitations: remainingElicitations,
                      ...(remainingDenials.length === 0
                        ? { denied_message_context: undefined }
                        : {}),
                    }
                  : session
              ),
            }
          }
        )
        queryClient.setQueryData<AllSessionsResponse>(['all-sessions'], old => {
          if (!old) return old
          return {
            ...old,
            entries: old.entries.map(entry =>
              entry.worktree_id === worktreeId
                ? {
                    ...entry,
                    sessions: entry.sessions.map(session =>
                      session.id === sessionId
                        ? {
                            ...session,
                            waiting_for_input: true,
                            waiting_for_input_type: null,
                            pending_codex_mcp_elicitations:
                              remainingElicitations,
                            ...(remainingDenials.length === 0
                              ? { denied_message_context: undefined }
                              : {}),
                          }
                        : session
                    ),
                  }
                : entry
            ),
          }
        })
        invoke('update_session_state', {
          worktreeId,
          worktreePath,
          sessionId,
          pendingCodexMcpElicitations: remainingElicitations,
          ...(remainingDenials.length === 0
            ? { deniedMessageContext: null }
            : {}),
          waitingForInput: true,
          waitingForInputType: null,
        }).catch(err => {
          logger.error(
            '[useMessageHandlers] Failed to persist remaining MCP elicitation state:',
            err
          )
        })
      } else {
        setWaitingForInput(sessionId, false)
        clearCachedWaitingState(
          sessionId,
          worktreeId,
          worktreePath,
          undefined,
          true
        )
      }

      if (action === 'accept') {
        addSendingSession(sessionId)
        requestAnimationFrame(() => {
          scrollToBottom(true)
        })
      } else {
        toast.info(
          action === 'decline' ? 'Request declined' : 'Request cancelled'
        )
      }

      invoke('answer_codex_mcp_elicitation', {
        sessionId,
        rpcId,
        action,
        content,
      }).catch(err => {
        logger.error(
          '[useMessageHandlers] Failed to answer Codex MCP elicitation:',
          err
        )
        toast.error(`Failed to answer MCP request: ${err}`)
      })
    },
    [
      activeWorktreeIdRef,
      activeWorktreePathRef,
      clearCachedWaitingState,
      queryClient,
      scrollToBottom,
    ]
  )

  // Handle fixing a review finding
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handleFixFinding = useCallback(
    async (finding: ReviewFinding, customSuggestion?: string) => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      // Use custom suggestion if provided, otherwise use first suggestion
      const suggestionToApply =
        customSuggestion ?? finding.suggestions[0]?.code ?? ''

      const message = `Fix the following code review finding:

**File:** ${finding.file}
**Line:** ${finding.line}
**Issue:** ${finding.title}

${finding.description}

**Current code:**
\`\`\`
${finding.code}
\`\`\`

**Suggested fix:**
${suggestionToApply}

Please apply this fix to the file.`

      const {
        addSendingSession,
        setLastSentMessage,
        setError,
        setSelectedModel,
        setExecutingMode,
        markFindingFixed,
        isSending,
        enqueueMessage,
      } = useChatStore.getState()

      // Mark this finding as fixed (we don't have the index here, so we generate a key based on file+line)
      // The finding key format is: file:line:index - we'll match on file:line prefix
      // Get sessions data from query cache instead of closure for stable callback
      const cachedSessionsData = queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions(worktreeId)
      )
      const allContent =
        cachedSessionsData?.sessions
          ?.find((s: Session) => s.id === sessionId)
          ?.messages?.filter((m: { role: string }) => m.role === 'assistant')
          ?.map((m: { content: string }) => m.content)
          ?.join('\n') ?? ''
      const findings = parseReviewFindings(allContent)
      const findingIndex = findings.findIndex(
        f =>
          f.file === finding.file &&
          f.line === finding.line &&
          f.title === finding.title
      )
      if (findingIndex >= 0) {
        markFindingFixed(sessionId, getFindingKey(finding, findingIndex))
      }

      // If session is already busy, queue the fix message
      if (isSending(sessionId)) {
        const queuedMsg = {
          id: generateId(),
          message,
          pendingImages: [] as never[],
          pendingFiles: [] as never[],
          skills: [] as never[],
          pendingTextFiles: [] as never[],
          model: selectedModelRef.current,
          provider: getCustomProfileName() ?? null,
          executionMode: 'build' as const,
          thinkingLevel: selectedThinkingLevelRef.current,
          effortLevel: useAdaptiveThinkingRef.current
            ? selectedEffortLevelRef.current
            : undefined,
          mcpConfig: getMcpConfig(),
          queuedAt: Date.now(),
        }
        enqueueMessage(sessionId, queuedMsg)
        persistEnqueue(worktreeId, worktreePath, sessionId, queuedMsg)
        toast.info('Fix queued — will start when current task completes')
        return
      }

      setLastSentMessage(sessionId, message)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, selectedModelRef.current)
      setExecutingMode(sessionId, 'build') // Fixes are always in build mode

      sendMessage.mutate(
        {
          sessionId,
          worktreeId,
          worktreePath,
          message,
          model: selectedModelRef.current,
          executionMode: 'build',
          thinkingLevel: selectedThinkingLevelRef.current,
          effortLevel: useAdaptiveThinkingRef.current
            ? selectedEffortLevelRef.current
            : undefined,
          mcpConfig: getMcpConfig(),
          customProfileName: getCustomProfileName(),
        },
        {
          onSettled: () => {
            inputRef.current?.focus()
          },
        }
      )
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      sendMessage,
      queryClient,
      inputRef,
    ]
  )

  // Handle fixing all review findings at once
  // PERFORMANCE: Uses refs for session/worktree IDs to keep callback stable across session switches
  const handleFixAllFindings = useCallback(
    async (
      findingsWithSuggestions: { finding: ReviewFinding; suggestion?: string }[]
    ) => {
      const sessionId = activeSessionIdRef.current
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!sessionId || !worktreeId || !worktreePath) return

      const message = `Fix the following ${findingsWithSuggestions.length} code review findings:

${findingsWithSuggestions
  .map(
    ({ finding, suggestion }, i) => `
### ${i + 1}. ${finding.title}
**File:** ${finding.file}
**Line:** ${finding.line}

${finding.description}

**Current code:**
\`\`\`
${finding.code}
\`\`\`

**Suggested fix:**
${suggestion ?? finding.suggestions[0]?.code ?? '(no suggestion)'}
`
  )
  .join('\n---\n')}

Please apply all these fixes to the respective files.`

      const {
        addSendingSession,
        setLastSentMessage,
        setError,
        setSelectedModel,
        setExecutingMode,
        markFindingFixed,
        isSending,
        enqueueMessage,
      } = useChatStore.getState()

      // Mark all findings as fixed
      // Get sessions data from query cache instead of closure for stable callback
      const cachedSessionsData = queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions(worktreeId)
      )
      const allContent =
        cachedSessionsData?.sessions
          ?.find((s: Session) => s.id === sessionId)
          ?.messages?.filter((m: { role: string }) => m.role === 'assistant')
          ?.map((m: { content: string }) => m.content)
          ?.join('\n') ?? ''
      const allFindings = parseReviewFindings(allContent)

      for (const { finding } of findingsWithSuggestions) {
        const findingIndex = allFindings.findIndex(
          f =>
            f.file === finding.file &&
            f.line === finding.line &&
            f.title === finding.title
        )
        if (findingIndex >= 0) {
          markFindingFixed(sessionId, getFindingKey(finding, findingIndex))
        }
      }

      // If session is already busy, queue the fix message
      if (isSending(sessionId)) {
        const queuedMsg = {
          id: generateId(),
          message,
          pendingImages: [] as never[],
          pendingFiles: [] as never[],
          skills: [] as never[],
          pendingTextFiles: [] as never[],
          model: selectedModelRef.current,
          provider: getCustomProfileName() ?? null,
          executionMode: 'build' as const,
          thinkingLevel: selectedThinkingLevelRef.current,
          effortLevel: useAdaptiveThinkingRef.current
            ? selectedEffortLevelRef.current
            : undefined,
          mcpConfig: getMcpConfig(),
          queuedAt: Date.now(),
        }
        enqueueMessage(sessionId, queuedMsg)
        persistEnqueue(worktreeId, worktreePath, sessionId, queuedMsg)
        toast.info('Fix queued — will start when current task completes')
        return
      }

      setLastSentMessage(sessionId, message)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, selectedModelRef.current)
      setExecutingMode(sessionId, 'build') // Fixes are always in build mode

      sendMessage.mutate(
        {
          sessionId,
          worktreeId,
          worktreePath,
          message,
          model: selectedModelRef.current,
          executionMode: 'build',
          thinkingLevel: selectedThinkingLevelRef.current,
          effortLevel: useAdaptiveThinkingRef.current
            ? selectedEffortLevelRef.current
            : undefined,
          mcpConfig: getMcpConfig(),
          customProfileName: getCustomProfileName(),
        },
        {
          onSettled: () => {
            inputRef.current?.focus()
          },
        }
      )
    },
    [
      activeSessionIdRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      getMcpConfig,
      getCustomProfileName,
      sendMessage,
      queryClient,
      inputRef,
    ]
  )

  return {
    handleQuestionAnswer,
    handleSkipQuestion,
    handlePlanApproval,
    handlePlanApprovalYolo,
    handleStreamingPlanApproval,
    handleStreamingPlanApprovalYolo,
    handleClearContextApproval,
    handleStreamingClearContextApproval,
    handleClearContextApprovalBuild,
    handleStreamingClearContextApprovalBuild,
    handleWorktreeBuildApproval,
    handleStreamingWorktreeBuildApproval,
    handleWorktreeYoloApproval,
    handleStreamingWorktreeYoloApproval,
    handlePendingPlanApprovalCallback,
    handlePermissionApproval,
    handlePermissionApprovalAndPersist,
    handlePermissionApprovalYolo,
    handlePermissionDeny,
    handleCodexMcpElicitationRespond,
    handleFixFinding,
    handleFixAllFindings,
  }
}
