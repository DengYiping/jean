import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatShortcutDisplay, DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { invoke, listen } from '@/lib/transport'
import { Bot, GitBranch, GitMerge, Layers } from 'lucide-react'
import {
  useSession,
  useSessions,
  useSendMessage,
  useSetSessionModel,
  useSetSessionThinkingLevel,
  useSetSessionEffortLevel,
  useSetSessionBackend,
  useSetSessionProvider,
  useCreateSession,
  chatQueryKeys,
  useUpdateSessionState,
} from '@/services/chat'
import { useWorktree, useProjects, useRunScripts } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import type {
  Worktree,
  WorktreeCreatedEvent,
  WorktreeCreateErrorEvent,
} from '@/types/projects'
import {
  useLoadedIssueContexts,
  useLoadedPRContexts,
  useAttachedSavedContexts,
} from '@/services/github'
import { useLoadedLinearIssueContexts } from '@/services/linear'
import {
  useChatStore,
  DEFAULT_MODEL,
  DEFAULT_THINKING_LEVEL,
  type ClaudeModel,
} from '@/store/chat-store'
import { usePreferences, usePatchPreferences } from '@/services/preferences'
import { getLabelTextColor } from '@/lib/label-colors'
import { PREDEFINED_CLI_PROFILES, type CliBackend } from '@/types/preferences'
import type {
  ChatMessage,
  ToolCall,
  ThinkingLevel,
  EffortLevel,
  ContentBlock,
  PendingImage,
  PendingTextFile,
  SkillReference,
  CodexMcpElicitation as CodexMcpElicitationType,
  PermissionDenial,
  PendingFile,
  SupervisorAction,
} from '@/types/chat'
import { isAskUserQuestion } from '@/types/chat'
import { getSkillName } from '@/lib/path-utils'
import {
  getActiveSkillsFromText,
  stripLeadingInjectedSkillTokens,
} from '@/lib/skill-prompt'
import { resolveParallelExecutionPromptForSession } from '@/lib/parallel-execution-prompt'
import { copyToClipboard } from '@/lib/clipboard'
import { buildMessageWithAttachmentRefs } from '@/lib/queued-message'
import { cn } from '@/lib/utils'
import { PermissionApproval } from './PermissionApproval'
import { CodexMcpElicitation } from './CodexMcpElicitation'
import { SetupScriptOutput } from './SetupScriptOutput'
import { TodoWidget } from './TodoWidget'
import { AgentWidget } from './AgentWidget'
import { normalizeTodosForDisplay } from './tool-call-utils'
import { ImagePreview } from './ImagePreview'
import { TextFilePreview } from './TextFilePreview'
import { SkillBadge } from './SkillBadge'
import { FileContentModal } from './FileContentModal'
import { FilePreview } from './FilePreview'
import { ChatInput } from './ChatInput'
import { SessionDebugPanel } from './SessionDebugPanel'
import { ChatToolbar } from './ChatToolbar'
import { ReviewResultsPanel } from './ReviewResultsPanel'
import { QueuedMessagesList } from './QueuedMessageItem'
import { FloatingButtons } from './FloatingButtons'
import { PlanDialog, type PlanDialogMode } from './PlanDialog'
import { RecapDialog } from './RecapDialog'
import { StreamingMessage } from './StreamingMessage'
import { CompactStreamingTicker } from './CompactStreamingTicker'
import { CodexGoalBanner } from './CodexGoalBanner'
import { StreamingStatusBar } from './StreamingStatusBar'
import { ChatErrorFallback } from './ChatErrorFallback'
import { logger } from '@/lib/logger'
import { hydrateRunningSnapshot } from '@/lib/hydrate-running-snapshot'
import { saveCrashState } from '@/lib/recovery'
import { ErrorBanner } from './ErrorBanner'
import { SessionDigestReminder } from './SessionDigestReminder'
import {
  VirtualizedMessageList,
  type VirtualizedMessageListHandle,
} from './VirtualizedMessageList'
import { CompactMessageList } from './CompactMessageList'
import {
  appendPromptMetadataToPlainText,
  buildPromptAttachmentMetadata,
  encodePromptAttachmentMetadata,
  stripAllMarkers,
} from './message-content-utils'
import { useUIStore } from '@/store/ui-store'
import { buildMcpConfigJson } from '@/services/mcp'
import type { McpServerInfo } from '@/types/chat'
import { useGitStatus } from '@/services/git-status'
import { useRemotePicker } from '@/hooks/useRemotePicker'
import { supportsAdaptiveThinking } from '@/lib/model-utils'
import { useClaudeCliStatus } from '@/services/claude-cli'
import { usePrStatus, usePrStatusEvents } from '@/services/pr-status'
import type { PrDisplayStatus, CheckStatus } from '@/types/pr-status'
import type {
  QueuedMessage,
  Session,
  SessionDigest,
  WorktreeSessions,
} from '@/types/chat'
import type { DiffRequest } from '@/types/git-diff'
import { FileDiffModal } from './FileDiffModal'

// Lazy-loaded heavy modals (code splitting)
const GitDiffModal = lazy(() =>
  import('./GitDiffModal').then(mod => ({ default: mod.GitDiffModal }))
)
const LoadContextModal = lazy(() =>
  import('../magic/LoadContextModal').then(mod => ({
    default: mod.LoadContextModal,
  }))
)
const LinkedProjectsModal = lazy(() =>
  import('../magic/LinkedProjectsModal').then(mod => ({
    default: mod.LinkedProjectsModal,
  }))
)
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  type ImperativePanelHandle,
} from '@/components/ui/resizable'
import { TerminalPanel } from './TerminalPanel'
import { useTerminalStore } from '@/store/terminal-store'

// Extracted hooks (useStreamingEvents is now in App.tsx for global persistence)
import { useScrollManagement } from './hooks/useScrollManagement'
import { useGitOperations } from './hooks/useGitOperations'
import { useContextOperations } from './hooks/useContextOperations'
import { useMessageHandlers } from './hooks/useMessageHandlers'
import { useMagicCommands } from './hooks/useMagicCommands'
import { useDragAndDropImages } from './hooks/useDragAndDropImages'
import { usePlanDialogApproval } from './hooks/usePlanDialogApproval'
import { useChatWindowEvents } from './hooks/useChatWindowEvents'
import { useInvestigateHandlers } from './hooks/useInvestigateHandlers'
import { useMcpServerResolution } from './hooks/useMcpServerResolution'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { useToolbarHandlers } from './hooks/useToolbarHandlers'
import { useMessageSending } from './hooks/useMessageSending'
import { useAgentHarnessFanout } from './hooks/useAgentHarnessFanout'
import { usePlanState } from './hooks/usePlanState'
import { useActiveTodosAndAgents } from './hooks/useActiveTodosAndAgents'
import { usePendingAttachments } from './hooks/usePendingAttachments'
import { useQueuedMessages } from './hooks/useQueuedMessages'
import { completePlanApprovalTransition } from './hooks/plan-approval-transition'
import { resolveApprovedPlanContinuation } from './hooks/approved-plan-continuation'
import { sendApprovedPlanContinuation } from './hooks/send-approved-plan-continuation'
import { dedupeInFlightAssistantMessage } from './in-flight-message-dedupe'
import { shouldShowPermissionApproval } from './permission-approval-utils'
import type { PendingInputSnapshot } from './pending-input'

// PERFORMANCE: Stable empty array references to prevent infinite render loops
// When Zustand selectors return [], a new reference is created each time
// Using these constants ensures referential equality for empty states
const EMPTY_TOOL_CALLS: ToolCall[] = []
const EMPTY_CONTENT_BLOCKS: ContentBlock[] = []
const EMPTY_PENDING_IMAGES: PendingImage[] = []
const EMPTY_PENDING_TEXT_FILES: PendingTextFile[] = []
const EMPTY_PENDING_FILES: PendingFile[] = []
const EMPTY_PENDING_SKILLS: SkillReference[] = []
const EMPTY_INPUT_DRAFT = ''
const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = []
const EMPTY_PERMISSION_DENIALS: PermissionDenial[] = []
const EMPTY_CODEX_MCP_ELICITATIONS: CodexMcpElicitationType[] = []

interface ChatWindowProps {
  /** When true, hides terminal panel and other elements not needed in modal */
  isModal?: boolean
  /** Override worktree ID (used in modal mode to avoid setting global state) */
  worktreeId?: string
  /** Override worktree path (used in modal mode to avoid setting global state) */
  worktreePath?: string
}

export function ChatWindow({
  isModal = false,
  worktreeId: propWorktreeId,
  worktreePath: propWorktreePath,
}: ChatWindowProps = {}) {
  // PERFORMANCE: Use focused selectors instead of whole-store destructuring
  // This prevents re-renders when other sessions' state changes (e.g., streaming chunks)

  // Stable values that don't change per-session
  // Use props if provided (modal mode), otherwise fall back to store
  const storeWorktreeId = useChatStore(state => state.activeWorktreeId)
  const storeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const activeWorktreeId = propWorktreeId ?? storeWorktreeId
  const activeWorktreePath = propWorktreePath ?? storeWorktreePath
  const hasPendingAutoInvestigate = useUIStore(state => {
    if (!activeWorktreeId) return false
    return (
      state.autoInvestigateWorktreeIds.has(activeWorktreeId) ||
      state.autoInvestigatePRWorktreeIds.has(activeWorktreeId) ||
      state.autoInvestigateSecurityAlertWorktreeIds.has(activeWorktreeId) ||
      state.autoInvestigateAdvisoryWorktreeIds.has(activeWorktreeId) ||
      state.autoInvestigateLinearIssueWorktreeIds.has(activeWorktreeId)
    )
  })

  // PERFORMANCE: Proper selector for activeSessionId - subscribes to changes
  // This triggers re-render when tabs are clicked (setActiveSession updates activeSessionIds)
  // Without this, ChatWindow wouldn't know when to re-render on tab switch
  let activeSessionId = useChatStore(state =>
    activeWorktreeId ? state.activeSessionIds[activeWorktreeId] : undefined
  )
  const sessionParallelExecutionPromptEnabled = useChatStore(state =>
    activeSessionId
      ? state.parallelExecutionPromptEnabledBySession[activeSessionId]
      : undefined
  )

  // PERF: Direct data subscription for isSending - triggers re-render when sendingSessionIds changes
  // (Previously used function selector which was a stable ref that never triggered re-renders)
  const isSendingForSession = useChatStore(state =>
    activeSessionId
      ? (state.sendingSessionIds[activeSessionId] ?? false)
      : false
  )
  // Timestamp when current send started (for elapsed timer)
  const sendStartedAt = useChatStore(state =>
    activeSessionId ? (state.sendStartedAt[activeSessionId] ?? null) : null
  )
  // Duration of last completed run (ms) — stored by completeSession
  const completedDurationMs = useChatStore(state =>
    activeSessionId ? (state.completedDurations[activeSessionId] ?? null) : null
  )
  // Session label for top-right badge
  const sessionLabel = useChatStore(state =>
    activeSessionId ? (state.sessionLabels[activeSessionId] ?? null) : null
  )

  // Function selectors - these return stable function references
  const isQuestionAnswered = useChatStore(state => state.isQuestionAnswered)
  const getSubmittedAnswers = useChatStore(state => state.getSubmittedAnswers)
  const areQuestionsSkipped = useChatStore(state => state.areQuestionsSkipped)
  const isFindingFixed = useChatStore(state => state.isFindingFixed)
  // DATA subscription for answered questions - triggers re-render when persisted state is restored
  // Subscribe to the size of answered questions (a stable primitive) to trigger re-renders
  // when questions are answered, without creating new Set references on every store update
  const answeredQuestionsSize = useChatStore(state =>
    activeSessionId ? (state.answeredQuestions[activeSessionId]?.size ?? 0) : 0
  )
  // Review sidebar state
  const reviewSidebarVisible = useChatStore(state => state.reviewSidebarVisible)
  const hasReviewResults = useChatStore(state =>
    activeSessionId ? !!state.reviewResults[activeSessionId] : false
  )
  // Whether session is in review state (used to hide "restored session" indicator after prompt finishes)
  const isSessionReviewing = useChatStore(state =>
    activeSessionId
      ? (state.reviewingSessions[activeSessionId] ?? false)
      : false
  )
  const isStreamingPlanApproved = useChatStore(
    state => state.isStreamingPlanApproved
  )
  // Terminal panel visibility (per-worktree)
  const terminalVisible = useTerminalStore(state => state.terminalVisible)
  const terminalPanelOpen = useTerminalStore(state =>
    activeWorktreeId
      ? (state.terminalPanelOpen[activeWorktreeId] ?? false)
      : false
  )
  const { setTerminalVisible } = useTerminalStore.getState()

  // Sync terminal panel with terminalVisible state
  useEffect(() => {
    const panel = terminalPanelRef.current
    if (!panel) return

    if (terminalVisible) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [terminalVisible])

  // Terminal panel collapse/expand handlers
  const handleTerminalCollapse = useCallback(() => {
    setTerminalVisible(false)
  }, [setTerminalVisible])

  const handleTerminalExpand = useCallback(() => {
    setTerminalVisible(true)
  }, [setTerminalVisible])

  // Sync review sidebar panel with reviewSidebarVisible state
  useEffect(() => {
    const panel = reviewPanelRef.current
    if (!panel) return

    if (reviewSidebarVisible) {
      panel.expand()
    } else {
      panel.collapse()
    }
  }, [reviewSidebarVisible])

  // Review sidebar collapse/expand handlers
  const handleReviewSidebarCollapse = useCallback(() => {
    useChatStore.getState().setReviewSidebarVisible(false)
  }, [])

  const handleReviewSidebarExpand = useCallback(() => {
    useChatStore.getState().setReviewSidebarVisible(true)
  }, [])

  // Actions - get via getState() for stable references (no subscriptions needed)
  const {
    setInputDraft,
    clearInputDraft,
    setExecutionMode,
    setError,
    clearSetupScriptResult,
  } = useChatStore.getState()

  const queryClient = useQueryClient()

  // Load sessions to ensure we have a valid active session
  const {
    data: sessionsData,
    isLoading: isSessionsLoading,
    isFetching: isSessionsFetching,
  } = useSessions(activeWorktreeId, activeWorktreePath)

  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      import.meta.env.MODE === 'test' ||
      !activeWorktreeId ||
      isSessionsFetching
    ) {
      return
    }
    logger.debug('[ChatWindow] sessions loaded', {
      worktreeId: activeWorktreeId,
      sessionCount: sessionsData?.sessions.length ?? 0,
      activeSessionId: sessionsData?.active_session_id ?? null,
    })
  }, [activeWorktreeId, isSessionsFetching, sessionsData])

  const uiStateInitialized = useUIStore(state => state.uiStateInitialized)

  // Sync active session from backend if store doesn't have one
  useEffect(() => {
    // Wait for UI state to be restored from persisted storage first,
    // otherwise we'd overwrite the restored activeSessionIds with the first session
    if (!uiStateInitialized) return
    // Skip while refetching - stale cached data could overwrite a valid selection
    // (e.g., when creating a new session, the cache doesn't include it yet)
    if (!activeWorktreeId || !sessionsData || isSessionsFetching) return

    const store = useChatStore.getState()
    const currentActive = store.activeSessionIds[activeWorktreeId]
    const sessions = sessionsData.sessions
    if (!sessions) return
    const firstSession = sessions[0]

    // If no active session in store, or it doesn't exist in loaded sessions
    if (sessions.length > 0 && firstSession) {
      const sessionExists = sessions.some(s => s.id === currentActive)
      if (!currentActive || !sessionExists) {
        const targetSession = sessionsData.active_session_id ?? firstSession.id
        store.setActiveSession(activeWorktreeId, targetSession)
      }
    }
  }, [sessionsData, activeWorktreeId, isSessionsFetching, uiStateInitialized])

  // Use backend's active session if store doesn't have one yet
  if (!activeSessionId && sessionsData?.sessions?.length) {
    activeSessionId =
      sessionsData.active_session_id ?? sessionsData.sessions[0]?.id
  }

  // PERFORMANCE: Defer the session ID used for content rendering
  // This allows React to show old session content while rendering new session in background
  // The activeSessionId is used for immediate feedback (tab highlighting, sending messages)
  // The deferredSessionId is used for content that can be rendered concurrently
  const deferredSessionId = useDeferredValue(activeSessionId)
  const isSessionSwitching = deferredSessionId !== activeSessionId

  // Load the active session's messages (uses deferred ID for concurrent rendering)
  const { data: session, isLoading } = useSession(
    deferredSessionId ?? null,
    activeWorktreeId,
    activeWorktreePath
  )

  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      import.meta.env.MODE === 'test' ||
      isLoading ||
      !deferredSessionId
    ) {
      return
    }
    logger.debug('[ChatWindow] session loaded', {
      worktreeId: activeWorktreeId,
      sessionId: deferredSessionId,
      hasSession: !!session,
      messageCount: session?.messages.length ?? 0,
    })
  }, [activeWorktreeId, deferredSessionId, isLoading, session])

  useEffect(() => {
    if (!deferredSessionId || !session) return
    const lastMsg = session.messages.at(-1)
    if (lastMsg?.role === 'assistant' && lastMsg.id.startsWith('running-')) {
      hydrateRunningSnapshot(deferredSessionId, lastMsg)
    }
  }, [deferredSessionId, session])

  useEffect(() => {
    if (!deferredSessionId) return
    useChatStore
      .getState()
      .setCodexGoal(deferredSessionId, session?.codex_goal ?? null)
  }, [deferredSessionId, session?.codex_goal])
  const automationBadge = session?.automation_owned
    ? (session.automation_name ?? 'Automation')
    : null

  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()
  const linkedProjectsModalOpen = useUIStore(
    state => state.linkedProjectsModalOpen
  )
  const sessionModalOpen = useUIStore(state => state.sessionChatModalOpen)
  const focusChatShortcut = formatShortcutDisplay(
    (preferences?.keybindings?.focus_chat_input ??
      DEFAULT_KEYBINDINGS.focus_chat_input) as string
  )
  const approveShortcut = formatShortcutDisplay(
    (preferences?.keybindings?.approve_plan ??
      DEFAULT_KEYBINDINGS.approve_plan) as string
  )
  const approveShortcutYolo = formatShortcutDisplay(
    (preferences?.keybindings?.approve_plan_yolo ??
      DEFAULT_KEYBINDINGS.approve_plan_yolo) as string
  )
  const approveShortcutClearContext = formatShortcutDisplay(
    (preferences?.keybindings?.approve_plan_clear_context ??
      DEFAULT_KEYBINDINGS.approve_plan_clear_context) as string
  )
  const approveShortcutClearContextBuild = formatShortcutDisplay(
    (preferences?.keybindings?.approve_plan_clear_context_build ??
      DEFAULT_KEYBINDINGS.approve_plan_clear_context_build) as string
  )
  const sendMessage = useSendMessage()
  const createSession = useCreateSession()
  const updateSessionState = useUpdateSessionState()
  const setSessionModel = useSetSessionModel()
  const setSessionThinkingLevel = useSetSessionThinkingLevel()
  const setSessionEffortLevel = useSetSessionEffortLevel()
  const setSessionBackend = useSetSessionBackend()
  const setSessionProvider = useSetSessionProvider()

  // Fetch worktree data for PR link display
  const { data: worktree } = useWorktree(activeWorktreeId ?? null)

  // Fetch projects to get project path for run toggle
  const { data: projects } = useProjects()
  const project = worktree
    ? projects?.find(p => p.id === worktree.project_id)
    : null

  // Git status for pull indicator
  const { data: gitStatus } = useGitStatus(activeWorktreeId ?? null)

  // Loaded issue contexts for indicator
  const { data: loadedIssueContexts } = useLoadedIssueContexts(
    activeSessionId ?? null,
    activeWorktreeId
  )

  // Loaded PR contexts for indicator and investigate PR functionality
  const { data: loadedPRContexts } = useLoadedPRContexts(
    activeSessionId ?? null,
    activeWorktreeId
  )

  // Loaded Linear issue contexts for indicator
  const { data: loadedLinearContexts } = useLoadedLinearIssueContexts(
    activeSessionId ?? null,
    activeWorktreeId ?? null,
    worktree?.project_id ?? null
  )

  // Attached saved contexts for indicator
  const { data: attachedSavedContexts } = useAttachedSavedContexts(
    activeSessionId ?? null
  )
  // Diff stats with cached fallback
  const uncommittedAdded =
    gitStatus?.uncommitted_added ?? worktree?.cached_uncommitted_added ?? 0
  const uncommittedRemoved =
    gitStatus?.uncommitted_removed ?? worktree?.cached_uncommitted_removed ?? 0
  const branchDiffAdded =
    gitStatus?.branch_diff_added ?? worktree?.cached_branch_diff_added ?? 0
  const branchDiffRemoved =
    gitStatus?.branch_diff_removed ?? worktree?.cached_branch_diff_removed ?? 0

  // PR status for dynamic PR button
  usePrStatusEvents() // Listen for PR status updates
  const { data: prStatus } = usePrStatus(activeWorktreeId ?? null)
  // Use live status if available, otherwise fall back to cached
  const displayStatus =
    prStatus?.display_status ??
    (worktree?.cached_pr_status as PrDisplayStatus | undefined)
  const checkStatus =
    prStatus?.check_status ??
    (worktree?.cached_check_status as CheckStatus | undefined)
  const mergeableStatus = prStatus?.mergeable ?? undefined

  // Run scripts for this worktree (used by keyboard shortcuts and quick actions)
  const { data: runScripts = [] } = useRunScripts(
    activeWorktreePath ?? null,
    project?.path ?? null
  )

  // Per-session provider selection: persisted session → zustand → project default → global default
  const projectDefaultProvider = project?.default_provider ?? null
  const globalDefaultProvider = preferences?.default_provider ?? null
  const defaultProvider = projectDefaultProvider ?? globalDefaultProvider
  const zustandProvider = useChatStore(state =>
    deferredSessionId ? state.selectedProviders[deferredSessionId] : undefined
  )
  const sessionProvider = session?.selected_provider ?? zustandProvider
  const selectedProvider =
    sessionProvider !== undefined ? sessionProvider : defaultProvider
  // __anthropic__ is the sentinel for "use default Anthropic" — treat as non-custom for feature detection
  const isCustomProvider = Boolean(
    selectedProvider && selectedProvider !== '__anthropic__'
  )

  // Installed backends (only these should be selectable)
  const { installedBackends } = useInstalledBackends()

  // Per-session backend selection: session → zustand → project default → global default
  const zustandBackend = useChatStore(state =>
    deferredSessionId ? state.selectedBackends[deferredSessionId] : undefined
  )
  const projectDefaultBackend = (project?.default_backend ??
    null) as CliBackend | null
  const globalDefaultBackend = (preferences?.default_backend ??
    'claude') as CliBackend
  const resolvedBackend: CliBackend =
    (session?.backend as CliBackend) ??
    zustandBackend ??
    projectDefaultBackend ??
    globalDefaultBackend
  // Model string is definitive backend source (matches Rust safety net in send_chat_message).
  // Prevents race where setSessionModel invalidation refetches before setSessionBackend persists.
  const modelImpliedBackend: CliBackend | null =
    session?.selected_model?.startsWith('opencode/')
      ? 'opencode'
      : session?.selected_model?.startsWith('codex') ||
          session?.selected_model?.includes('codex')
        ? 'codex'
        : null
  // Clamp to installed backends — prevents showing "Claude" when only Codex is installed
  const selectedBackend: CliBackend =
    modelImpliedBackend ??
    (installedBackends.length > 0 &&
    !installedBackends.includes(resolvedBackend)
      ? (installedBackends[0] as CliBackend)
      : resolvedBackend)
  const isCodexBackend = selectedBackend === 'codex'
  const isOpencodeBackend = selectedBackend === 'opencode'

  // Per-session model selection, falls back to preferences default (backend-aware)
  const defaultModel: string = isCodexBackend
    ? (preferences?.selected_codex_model ?? 'gpt-5.5')
    : isOpencodeBackend
      ? (preferences?.selected_opencode_model ?? 'opencode/gpt-5.3-codex')
      : ((preferences?.selected_model as ClaudeModel) ?? DEFAULT_MODEL)
  const selectedModel: string = session?.selected_model ?? defaultModel

  // Per-session thinking level, falls back to preferences default
  const defaultThinkingLevel =
    (preferences?.thinking_level as ThinkingLevel) ?? DEFAULT_THINKING_LEVEL
  // PERFORMANCE: Use deferredSessionId for content selectors to prevent sync cascade on tab switch
  const sessionThinkingLevel = useChatStore(state =>
    deferredSessionId ? state.thinkingLevels[deferredSessionId] : undefined
  )
  const selectedThinkingLevel =
    (session?.selected_thinking_level as ThinkingLevel) ??
    sessionThinkingLevel ??
    defaultThinkingLevel

  // Per-session effort level, falls back to preferences default (backend-aware)
  const defaultEffortLevel = isCodexBackend
    ? ((
        {
          low: 'low',
          medium: 'medium',
          high: 'high',
          xhigh: 'max',
        } as Record<string, EffortLevel>
      )[preferences?.default_codex_reasoning_effort ?? 'high'] ?? 'high')
    : ((preferences?.default_effort_level as EffortLevel) ?? 'high')
  const sessionEffortLevel = useChatStore(state =>
    deferredSessionId ? state.effortLevels[deferredSessionId] : undefined
  )
  const selectedEffortLevel: EffortLevel =
    (session?.selected_effort_level as EffortLevel) ??
    sessionEffortLevel ??
    defaultEffortLevel

  // MCP servers: resolve enabled servers cascade (session → project → global)
  // Fetches from ALL installed backends so toolbar shows grouped sections
  const { availableMcpServers, enabledMcpServers } = useMcpServerResolution({
    activeWorktreePath,
    deferredSessionId,
    project,
    preferences,
    selectedBackend,
  })

  // CLI version for adaptive thinking feature detection
  const { data: cliStatus } = useClaudeCliStatus()
  // Custom providers don't support Opus adaptive thinking — use thinking levels instead
  const useAdaptiveThinkingFlag =
    !isCustomProvider &&
    supportsAdaptiveThinking(selectedModel, cliStatus?.version ?? null)

  // Hide thinking level UI entirely for providers that don't support it
  const customCliProfiles = preferences?.custom_cli_profiles ?? []
  const activeProfile = isCustomProvider
    ? customCliProfiles.find(p => p.name === selectedProvider)
    : null
  // Fall back to predefined template's supports_thinking for profiles saved before this field existed
  const activeSupportsThinking =
    activeProfile?.supports_thinking ??
    PREDEFINED_CLI_PROFILES.find(p => p.name === selectedProvider)
      ?.supports_thinking
  const hideThinkingLevel = activeSupportsThinking === false

  const isSending = isSendingForSession

  // PERFORMANCE: Content selectors use deferredSessionId to prevent sync re-render cascade
  // When switching tabs, these selectors return stable values until React catches up
  // This prevents the ~1 second freeze from 15+ selectors re-evaluating simultaneously
  // IMPORTANT: Use stable empty array constants to prevent infinite render loops
  const streamingContent = useChatStore(state =>
    deferredSessionId ? (state.streamingContents[deferredSessionId] ?? '') : ''
  )
  const currentToolCalls = useChatStore(state =>
    deferredSessionId
      ? (state.activeToolCalls[deferredSessionId] ?? EMPTY_TOOL_CALLS)
      : EMPTY_TOOL_CALLS
  )
  const currentStreamingContentBlocks = useChatStore(state =>
    deferredSessionId
      ? (state.streamingContentBlocks[deferredSessionId] ??
        EMPTY_CONTENT_BLOCKS)
      : EMPTY_CONTENT_BLOCKS
  )
  // Per-session input - check if there's any input for submit button state
  // PERFORMANCE: Track hasValue via callback from ChatInput instead of store subscription
  // ChatInput notifies on mount, session change, and empty/non-empty boundary changes
  const [hasInputValue, setHasInputValue] = useState(false)
  // Per-session execution mode (defaults to 'plan' for new sessions)
  // Uses deferredSessionId for display consistency with other content
  const executionMode = useChatStore(state =>
    deferredSessionId
      ? (state.executionModes[deferredSessionId] ??
        session?.selected_execution_mode ??
        'plan')
      : 'plan'
  )
  // Executing mode - the mode the currently-running prompt was sent with
  // Uses activeSessionId for immediate status feedback (not deferred)
  const executingMode = useChatStore(state =>
    activeSessionId ? state.executingModes[activeSessionId] : undefined
  )
  // Streaming execution mode - uses executing mode when sending, otherwise selected mode
  const streamingExecutionMode = executingMode ?? executionMode
  // Whether this session is waiting for user input (AskUserQuestion/ExitPlanMode)
  const isWaitingForInput = useChatStore(state =>
    activeSessionId
      ? (state.waitingForInputSessionIds[activeSessionId] ?? false)
      : false
  )
  // Per-session error state (uses deferredSessionId for content consistency)
  const currentError = useChatStore(state =>
    deferredSessionId ? (state.errors[deferredSessionId] ?? null) : null
  )
  // Per-worktree setup script result (stays at worktree level)
  const setupScriptResult = useChatStore(state =>
    activeWorktreeId ? state.setupScriptResults[activeWorktreeId] : undefined
  )
  // PERFORMANCE: Input-related selectors use activeSessionId for immediate feedback
  // When user switches tabs, attachments should reflect the NEW session immediately
  const currentPendingImages = useChatStore(state =>
    activeSessionId
      ? (state.pendingImages[activeSessionId] ?? EMPTY_PENDING_IMAGES)
      : EMPTY_PENDING_IMAGES
  )
  const currentPendingTextFiles = useChatStore(state =>
    activeSessionId
      ? (state.pendingTextFiles[activeSessionId] ?? EMPTY_PENDING_TEXT_FILES)
      : EMPTY_PENDING_TEXT_FILES
  )
  const currentPendingFiles = useChatStore(state =>
    activeSessionId
      ? (state.pendingFiles[activeSessionId] ?? EMPTY_PENDING_FILES)
      : EMPTY_PENDING_FILES
  )
  const currentDraftSkillBindings = useChatStore(state =>
    activeSessionId
      ? (state.draftSkillBindings[activeSessionId] ?? EMPTY_PENDING_SKILLS)
      : EMPTY_PENDING_SKILLS
  )
  const currentDraftTextForSkills = useChatStore(state =>
    activeSessionId
      ? (state.inputDrafts[activeSessionId] ?? EMPTY_INPUT_DRAFT)
      : EMPTY_INPUT_DRAFT
  )
  const currentPendingSkills = useMemo(
    () =>
      getActiveSkillsFromText(
        currentDraftTextForSkills,
        currentDraftSkillBindings
      ),
    [currentDraftTextForSkills, currentDraftSkillBindings]
  )
  const hasPendingAttachments =
    currentPendingImages.length > 0 ||
    currentPendingTextFiles.length > 0 ||
    currentPendingFiles.length > 0 ||
    currentPendingSkills.length > 0
  // Per-session message queue (uses deferredSessionId for content consistency)
  const currentQueuedMessages = useChatStore(state =>
    deferredSessionId
      ? (state.messageQueues[deferredSessionId] ?? EMPTY_QUEUED_MESSAGES)
      : EMPTY_QUEUED_MESSAGES
  )
  // Per-session pending permission denials (uses deferredSessionId for content consistency)
  const pendingDenials = useChatStore(state =>
    deferredSessionId
      ? (state.pendingPermissionDenials[deferredSessionId] ??
        EMPTY_PERMISSION_DENIALS)
      : EMPTY_PERMISSION_DENIALS
  )
  const pendingCodexMcpElicitations = useChatStore(state =>
    deferredSessionId
      ? (state.pendingCodexMcpElicitations[deferredSessionId] ??
        EMPTY_CODEX_MCP_ELICITATIONS)
      : EMPTY_CODEX_MCP_ELICITATIONS
  )
  const showPermissionApproval = shouldShowPermissionApproval({
    pendingDenialsCount: pendingDenials.length,
    isSending,
    executionMode,
    isCodexBackend,
  })

  // PERFORMANCE: Pre-compute last assistant message to avoid rescanning in multiple memos
  // This reference only changes when the actual last assistant message changes
  const lastAssistantMessage = useMemo(() => {
    const messages = session?.messages ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') {
        return messages[i]
      }
    }
    return undefined
  }, [session?.messages])

  // Check if there are pending (unanswered) questions
  // Look at the last assistant message's tool_calls since streaming tool calls
  // are cleared when the response completes (chat:done calls clearToolCalls)
  // Note: Uses answeredQuestionsSize as dependency to trigger re-render when questions
  // are answered, then reads the actual Set from getState() for the .has() check
  const hasPendingQuestions = useMemo(() => {
    if (!activeSessionId || isSending) return false
    if (!lastAssistantMessage?.tool_calls) return false

    const answered = useChatStore.getState().answeredQuestions[activeSessionId]
    return lastAssistantMessage.tool_calls.some(
      tc => isAskUserQuestion(tc) && !answered?.has(tc.id)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, lastAssistantMessage, isSending, answeredQuestionsSize])

  const effectiveParallelExecutionPromptEnabled =
    sessionParallelExecutionPromptEnabled ??
    preferences?.parallel_execution_prompt_enabled ??
    false

  const handleParallelExecutionPromptToggle = useCallback(
    (checked: boolean) => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      useChatStore
        .getState()
        .setParallelExecutionPromptEnabled(activeSessionId, checked)

      updateSessionState.mutate({
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        sessionId: activeSessionId,
        parallelExecutionPromptEnabled: checked,
      })
    },
    [activeSessionId, activeWorktreeId, activeWorktreePath, updateSessionState]
  )

  const handleSupervisorActionChange = useCallback(
    (action: SupervisorAction | null) => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      queryClient.setQueryData<Session>(
        chatQueryKeys.session(activeSessionId),
        old => (old ? { ...old, supervisor_action: action } : old)
      )
      queryClient.setQueryData<WorktreeSessions>(
        chatQueryKeys.sessions(activeWorktreeId),
        old =>
          old
            ? {
                ...old,
                sessions: old.sessions.map(session =>
                  session.id === activeSessionId
                    ? { ...session, supervisor_action: action }
                    : session
                ),
              }
            : old
      )

      updateSessionState.mutate({
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        sessionId: activeSessionId,
        supervisorAction: action,
      })
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      queryClient,
      updateSessionState,
    ]
  )

  const handleToggleParallelExecutionPrompting = useCallback(() => {
    handleParallelExecutionPromptToggle(
      !effectiveParallelExecutionPromptEnabled
    )
  }, [
    effectiveParallelExecutionPromptEnabled,
    handleParallelExecutionPromptToggle,
  ])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const clearChatInputStateRef = useRef<(() => void) | null>(null)
  // PERFORMANCE: Refs for session/worktree IDs and settings to avoid recreating callbacks when session changes
  // This enables stable callback references that read current values from refs
  const activeSessionIdRef = useRef(activeSessionId)
  const activeWorktreeIdRef = useRef(activeWorktreeId)
  const activeWorktreePathRef = useRef(activeWorktreePath)
  const selectedModelRef = useRef(selectedModel)
  const buildModelRef = useRef<string | null>(preferences?.build_model ?? null)
  const yoloModelRef = useRef<string | null>(preferences?.yolo_model ?? null)
  const buildBackendRef = useRef<string | null>(
    preferences?.build_backend ?? null
  )
  const buildThinkingLevelRef = useRef<string | null>(
    preferences?.build_thinking_level ?? null
  )
  const buildEffortLevelRef = useRef<string | null>(
    preferences?.build_effort_level ?? null
  )
  const yoloBackendRef = useRef<string | null>(
    preferences?.yolo_backend ?? null
  )
  const yoloThinkingLevelRef = useRef<string | null>(
    preferences?.yolo_thinking_level ?? null
  )
  const yoloEffortLevelRef = useRef<string | null>(
    preferences?.yolo_effort_level ?? null
  )
  const selectedProviderRef = useRef(selectedProvider)
  const selectedThinkingLevelRef = useRef(selectedThinkingLevel)
  const selectedEffortLevelRef = useRef(selectedEffortLevel)
  const useAdaptiveThinkingRef = useRef(useAdaptiveThinkingFlag)
  const isCodexBackendRef = useRef(isCodexBackend)
  const executionModeRef = useRef(executionMode)
  const projectIdRef = useRef<string | null>(worktree?.project_id ?? null)
  const enabledMcpServersRef = useRef(enabledMcpServers)
  const mcpServersDataRef = useRef<McpServerInfo[]>(availableMcpServers)
  const selectedBackendRef = useRef(selectedBackend)

  // Keep refs in sync with current values (runs on every render, but cheap)
  activeSessionIdRef.current = activeSessionId
  activeWorktreeIdRef.current = activeWorktreeId
  activeWorktreePathRef.current = activeWorktreePath
  selectedModelRef.current = selectedModel
  buildModelRef.current = preferences?.build_model ?? null
  yoloModelRef.current = preferences?.yolo_model ?? null
  buildBackendRef.current = preferences?.build_backend ?? null
  buildThinkingLevelRef.current = preferences?.build_thinking_level ?? null
  buildEffortLevelRef.current = preferences?.build_effort_level ?? null
  yoloBackendRef.current = preferences?.yolo_backend ?? null
  yoloThinkingLevelRef.current = preferences?.yolo_thinking_level ?? null
  yoloEffortLevelRef.current = preferences?.yolo_effort_level ?? null
  selectedProviderRef.current = selectedProvider
  selectedThinkingLevelRef.current = selectedThinkingLevel
  selectedEffortLevelRef.current = selectedEffortLevel
  useAdaptiveThinkingRef.current = useAdaptiveThinkingFlag
  isCodexBackendRef.current = isCodexBackend
  executionModeRef.current = executionMode
  projectIdRef.current = worktree?.project_id ?? null
  enabledMcpServersRef.current = enabledMcpServers
  mcpServersDataRef.current = availableMcpServers
  selectedBackendRef.current = selectedBackend

  // Stable callback for useMessageHandlers to build MCP config from current refs
  const getMcpConfig = useCallback(
    () =>
      buildMcpConfigJson(
        mcpServersDataRef.current,
        enabledMcpServersRef.current
      ),
    []
  )

  const virtualizedListRef = useRef<VirtualizedMessageListHandle>(null)

  // Ref for approve button (passed to VirtualizedMessageList)
  const approveButtonRef = useRef<HTMLButtonElement>(null)
  const [isInlineApproveVisible, setIsInlineApproveVisible] = useState(false)

  // Terminal panel ref for imperative collapse/expand
  const terminalPanelRef = useRef<ImperativePanelHandle>(null)
  // Review sidebar panel ref for imperative collapse/expand
  const reviewPanelRef = useRef<ImperativePanelHandle>(null)

  // Scroll management hook - handles scroll state and callbacks
  const {
    scrollViewportRef,
    isAtBottom,
    areFindingsVisible,
    scrollToBottom,
    markAtBottom,
    beginKeyboardScroll,
    endKeyboardScroll,
    scrollToFindings,
    handleScroll,
    handleScrollToBottomHandled,
  } = useScrollManagement({
    messages: session?.messages,
    virtualizedListRef,
    activeWorktreeId,
    isSending,
  })

  // Drag and drop images into chat input
  const { isDragging } = useDragAndDropImages(activeSessionId)

  // State for file content modal (opened by clicking filenames in tool calls)
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null)

  // State for git diff modal (opened by clicking diff stats)
  const [diffRequest, setDiffRequest] = useState<DiffRequest | null>(null)

  // Sync git diff modal open state to UI store (blocks execute_run keybinding)
  useEffect(() => {
    useUIStore.getState().setGitDiffModalOpen(!!diffRequest)
    return () => useUIStore.getState().setGitDiffModalOpen(false)
  }, [diffRequest])

  // State for single file diff modal (opened by clicking edited file badges)
  const [editedFilePath, setEditedFilePath] = useState<string | null>(null)

  // Active todos and agents from streaming/persisted tool calls (with dismissal tracking)
  const {
    activeTodos,
    todoSourceMessageId,
    todoIsFromStreaming: isFromStreaming,
    dismissedTodoMessageId,
    setDismissedTodoMessageId,
    activeAgents,
    agentSourceMessageId,
    agentIsFromStreaming,
    dismissedAgentMessageId,
    setDismissedAgentMessageId,
  } = useActiveTodosAndAgents({
    activeSessionId,
    isSending,
    currentToolCalls,
    lastAssistantMessage,
  })

  // Plan state: pending plan message, streaming plan, content, file path
  const {
    pendingPlanMessage,
    hasStreamingPlan,
    latestPlanContent,
    latestPlanFilePath,
  } = usePlanState({
    session,
    currentToolCalls,
    isSending,
    activeSessionId,
    isStreamingPlanApproved,
    isQuestionAnswered,
  })
  const approvedPlanMessageIds = useMemo(
    () => new Set(session?.approved_plan_message_ids ?? []),
    [session?.approved_plan_message_ids]
  )

  useEffect(() => {
    const hasPendingPlan = !!pendingPlanMessage || hasStreamingPlan
    if (!hasPendingPlan) {
      setIsInlineApproveVisible(false)
      return
    }

    const viewport = scrollViewportRef.current
    const button = approveButtonRef.current
    if (!viewport || !button) {
      setIsInlineApproveVisible(false)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInlineApproveVisible(entry?.isIntersecting ?? false)
      },
      {
        root: viewport,
        threshold: 0.01,
      }
    )

    observer.observe(button)
    return () => observer.disconnect()
  }, [
    pendingPlanMessage?.id,
    hasStreamingPlan,
    activeSessionId,
    session?.messages?.length,
  ])

  // When the approval UI appears after the final render, keep the viewport pinned
  // so the inline Approve controls stay visible instead of requiring a manual scroll.
  useEffect(() => {
    if (!isAtBottom) return
    if (!pendingPlanMessage && !hasStreamingPlan) return

    requestAnimationFrame(() => {
      scrollToBottom(true)
    })
  }, [hasStreamingPlan, isAtBottom, pendingPlanMessage?.id, scrollToBottom])

  // State for plan dialog
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false)
  const [planDialogContent, setPlanDialogContent] = useState<string | null>(
    null
  )
  const [planDialogMode, setPlanDialogMode] =
    useState<PlanDialogMode>('default')

  // State for recap dialog
  const [isRecapDialogOpen, setIsRecapDialogOpen] = useState(false)
  const [recapDialogDigest, setRecapDialogDigest] =
    useState<SessionDigest | null>(null)
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false)

  // Plan dialog approval handlers (DRYs 4x-duplicated onApprove/onApproveYolo callbacks)
  const {
    handlePlanDialogApprove,
    handlePlanDialogApproveWithCustomPrompt,
    handlePlanDialogApproveYolo,
  } = usePlanDialogApproval({
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
  })

  const openBuildCustomPromptDialog = useCallback(() => {
    if (latestPlanContent) {
      setPlanDialogContent(latestPlanContent)
    } else {
      setPlanDialogContent(null)
    }
    setPlanDialogMode('build-custom')
    setIsPlanDialogOpen(true)
  }, [latestPlanContent])

  const resolvePlanDialogContinuation = useCallback(
    (mode: 'build' | 'yolo', editedPlanContent: string) => {
      const isYolo = mode === 'yolo'
      const modeModelRef = isYolo ? yoloModelRef : buildModelRef
      const modeBackendRef = isYolo ? yoloBackendRef : buildBackendRef
      const modeThinkingRef = isYolo
        ? yoloThinkingLevelRef
        : buildThinkingLevelRef
      const modeEffortRef = isYolo ? yoloEffortLevelRef : buildEffortLevelRef

      return resolveApprovedPlanContinuation({
        mode,
        planContent: editedPlanContent,
        originalBackend: session?.backend,
        originalModel: selectedModelRef.current,
        preferences,
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
    },
    [
      buildBackendRef,
      buildEffortLevelRef,
      buildModelRef,
      buildThinkingLevelRef,
      preferences,
      selectedEffortLevelRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      session?.backend,
      useAdaptiveThinkingRef,
      yoloBackendRef,
      yoloEffortLevelRef,
      yoloModelRef,
      yoloThinkingLevelRef,
    ]
  )

  // Clear context approval handler for PlanDialog
  const handlePlanDialogClearContextApprove = useCallback(
    async (editedPlanContent: string) => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      // Mark pending plan approved if exists
      void completePlanApprovalTransition({
        queryClient,
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        sessionId: activeSessionId,
        messageId: pendingPlanMessage?.id,
        logContext: 'PlanDialog CC Yolo',
      })

      const store = useChatStore.getState()

      // Create new session
      let newSession: Session
      try {
        newSession = await createSession.mutateAsync({
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
        })
      } catch (err) {
        toast.error(`Failed to create session: ${err}`)
        return
      }

      // Switch to new session
      store.setActiveSession(activeWorktreeId, newSession.id)

      // Send plan as first message in YOLO mode
      const continuation = resolvePlanDialogContinuation(
        'yolo',
        editedPlanContent
      )
      if (continuation.modeOverride) {
        toast.info(`${continuation.modeLabel}: ${continuation.modeOverride}`)
      }
      await sendApprovedPlanContinuation({
        queryClient,
        sendMessage,
        target: {
          sessionId: newSession.id,
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
        },
        mode: 'yolo',
        continuation,
        logContext: 'PlanDialog CC Yolo',
      })
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      pendingPlanMessage,
      queryClient,
      createSession,
      sendMessage,
      resolvePlanDialogContinuation,
    ]
  )

  // Clear context approval handler for PlanDialog (build mode)
  const handlePlanDialogClearContextBuildApprove = useCallback(
    async (editedPlanContent: string) => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      // Mark pending plan approved if exists
      void completePlanApprovalTransition({
        queryClient,
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        sessionId: activeSessionId,
        messageId: pendingPlanMessage?.id,
        logContext: 'PlanDialog CC Build',
      })

      const store = useChatStore.getState()

      // Create new session
      let newSession: Session
      try {
        newSession = await createSession.mutateAsync({
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
        })
      } catch (err) {
        toast.error(`Failed to create session: ${err}`)
        return
      }

      // Switch to new session
      store.setActiveSession(activeWorktreeId, newSession.id)

      // Send plan as first message in build mode using build overrides
      const continuation = resolvePlanDialogContinuation(
        'build',
        editedPlanContent
      )
      if (continuation.modeOverride) {
        toast.info(`${continuation.modeLabel}: ${continuation.modeOverride}`)
      }
      await sendApprovedPlanContinuation({
        queryClient,
        sendMessage,
        target: {
          sessionId: newSession.id,
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
        },
        mode: 'build',
        continuation,
        logContext: 'PlanDialog CC Build',
      })
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      pendingPlanMessage,
      queryClient,
      createSession,
      sendMessage,
      resolvePlanDialogContinuation,
    ]
  )

  // Worktree approval handler for PlanDialog (creates new worktree + session)
  const handlePlanDialogWorktreeApprove = useCallback(
    async (editedPlanContent: string, mode: 'build' | 'yolo') => {
      const projectId = worktree?.project_id
      if (
        !activeSessionId ||
        !activeWorktreeId ||
        !activeWorktreePath ||
        !projectId
      )
        return

      const toastId = toast.loading('Creating worktree...')

      // Mark pending plan approved if exists
      void completePlanApprovalTransition({
        queryClient,
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        sessionId: activeSessionId,
        messageId: pendingPlanMessage?.id,
        logContext: 'PlanDialog Worktree',
      })

      const store = useChatStore.getState()

      // Create new worktree
      let pendingWorktree: Worktree
      try {
        pendingWorktree = await invoke<Worktree>('create_worktree', {
          projectId,
        })
      } catch (err) {
        toast.error(`Failed to create worktree: ${err}`, { id: toastId })
        return
      }

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
        toast.error(`Worktree creation failed: ${err}`, { id: toastId })
        return
      }

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
        toast.error(`Failed to get session: ${err}`, { id: toastId })
        return
      }

      store.setActiveSession(readyWorktree.id, newSession.id)
      store.addUserInitiatedSession(newSession.id)

      // Resolve mode-specific overrides
      const continuation = resolvePlanDialogContinuation(
        mode,
        editedPlanContent
      )
      if (continuation.modeOverride) {
        toast.info(`${continuation.modeLabel}: ${continuation.modeOverride}`)
      }
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
        logContext: `PlanDialog WT ${continuation.modeLabel}`,
      })

      toast.success(`Plan sent to new worktree (${continuation.modeLabel})`, {
        id: toastId,
      })
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      worktree?.project_id,
      pendingPlanMessage,
      queryClient,
      sendMessage,
      resolvePlanDialogContinuation,
    ]
  )

  const handlePlanDialogWorktreeBuildApprove = useCallback(
    (editedPlanContent: string) =>
      handlePlanDialogWorktreeApprove(editedPlanContent, 'build'),
    [handlePlanDialogWorktreeApprove]
  )

  const handlePlanDialogWorktreeYoloApprove = useCallback(
    (editedPlanContent: string) =>
      handlePlanDialogWorktreeApprove(editedPlanContent, 'yolo'),
    [handlePlanDialogWorktreeApprove]
  )

  // Opens a new session and sends the review fix message there
  const handleReviewFix = useCallback(
    async (message: string, executionMode: 'build' | 'yolo') => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      // Mark the current session as no longer reviewing
      const store = useChatStore.getState()
      store.setSessionReviewing(activeSessionId, false)

      // Create new session
      let newSession: Session
      try {
        newSession = await createSession.mutateAsync({
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
        })
      } catch (err) {
        toast.error(`Failed to create session: ${err}`)
        return
      }

      // Switch to new session
      store.setActiveSession(activeWorktreeId, newSession.id)

      const model =
        preferences?.magic_prompt_models?.code_review_model ??
        selectedModelRef.current
      store.setExecutionMode(newSession.id, executionMode)
      store.setLastSentMessage(newSession.id, message)
      store.setError(newSession.id, null)
      store.addSendingSession(newSession.id)
      store.setSelectedModel(newSession.id, model)
      store.setExecutingMode(newSession.id, executionMode)
      queryClient.setQueryData<Session>(
        chatQueryKeys.session(newSession.id),
        old =>
          old
            ? {
                ...old,
                selected_execution_mode: executionMode,
                selected_model: model,
              }
            : old
      )

      // Persist the selected mode immediately so the newly created session does
      // not refetch back to the default plan mode before or during execution.
      await invoke('update_session_state', {
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        sessionId: newSession.id,
        selectedExecutionMode: executionMode,
      }).catch(err =>
        logger.error('[review fix] Failed to persist execution mode:', err)
      )

      sendMessage.mutate({
        sessionId: newSession.id,
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        message,
        model,
        executionMode,
        thinkingLevel: selectedThinkingLevelRef.current,
      })
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      createSession,
      preferences,
      sendMessage,
      selectedModelRef,
      selectedThinkingLevelRef,
    ]
  )

  // Note: Streaming event listeners are in App.tsx, not here
  // This ensures they stay active even when ChatWindow is unmounted

  // Message sending pipeline: resolveCustomProfile, sendMessageNow, handleSubmit, git diff handlers
  const {
    resolveCustomProfile,
    sendMessageNow,
    handleSubmit,
    handleCancel,
    handleGitDiffAddToPrompt,
    handleGitDiffExecutePrompt,
  } = useMessageSending({
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    inputRef,
    selectedModelRef,
    selectedProviderRef,
    selectedThinkingLevelRef,
    selectedEffortLevelRef,
    executionModeRef,
    useAdaptiveThinkingRef,
    isCodexBackendRef,
    mcpServersDataRef,
    enabledMcpServersRef,
    selectedBackendRef,
    preferences,
    sendMessage,
    queryClient,
    markAtBottom,
    sessionsData,
    setInputDraft,
    clearInputDraft,
    clearChatInputState: () => clearChatInputStateRef.current?.(),
  })

  const getPendingInputSnapshot =
    useCallback((): PendingInputSnapshot | null => {
      if (!activeSessionId) return null

      const store = useChatStore.getState()
      const liveInputValue = inputRef.current?.value
      const textMessage = (
        liveInputValue ??
        store.inputDrafts[activeSessionId] ??
        ''
      ).trim()
      const images = [...store.getPendingImages(activeSessionId)]
      const files = [...store.getPendingFiles(activeSessionId)]
      const skills = [
        ...store.getActiveDraftSkills(activeSessionId, textMessage),
      ]
      const textFiles = [...store.getPendingTextFiles(activeSessionId)]

      if (
        !textMessage &&
        images.length === 0 &&
        files.length === 0 &&
        textFiles.length === 0 &&
        skills.length === 0
      ) {
        return null
      }

      return {
        sourceSessionId: activeSessionId,
        message: textMessage,
        images,
        files,
        skills,
        textFiles,
      }
    }, [activeSessionId, inputRef])

  const clearPendingInputSnapshot = useCallback(
    (snapshot: PendingInputSnapshot) => {
      const store = useChatStore.getState()

      clearInputDraft(snapshot.sourceSessionId)
      store.clearPendingImages(snapshot.sourceSessionId)
      store.clearPendingFiles(snapshot.sourceSessionId)
      store.clearDraftSkillBindings(snapshot.sourceSessionId)
      store.clearPendingTextFiles(snapshot.sourceSessionId)
      store.setSessionReviewing(snapshot.sourceSessionId, false)

      if (activeSessionId === snapshot.sourceSessionId) {
        clearChatInputStateRef.current?.()
      }
    },
    [activeSessionId, clearInputDraft]
  )

  const resolveShortcutExecutionConfig = useCallback(
    (mode: 'build' | 'yolo') => {
      const isYolo = mode === 'yolo'
      const modeLabel = isYolo ? 'Yolo' : 'Build'
      const modeBackendOverride = (
        isYolo ? yoloBackendRef.current : buildBackendRef.current
      ) as Session['backend'] | null
      const modeModelOverride = isYolo
        ? yoloModelRef.current
        : buildModelRef.current
      const modeThinkingOverride = isYolo
        ? yoloThinkingLevelRef.current
        : buildThinkingLevelRef.current
      const targetBackend = (modeBackendOverride ??
        selectedBackendRef.current ??
        session?.backend ??
        'claude') as 'claude' | 'codex' | 'opencode'

      const model =
        modeModelOverride ??
        (modeBackendOverride === 'codex'
          ? (preferences?.selected_codex_model ?? 'gpt-5.5')
          : modeBackendOverride === 'opencode'
            ? (preferences?.selected_opencode_model ?? 'opencode/gpt-5.3-codex')
            : selectedModelRef.current)

      const overrideStr =
        modeModelOverride || modeBackendOverride
          ? [modeBackendOverride, model].filter(Boolean).join(' / ')
          : ''
      const thinkingLevel: ThinkingLevel =
        targetBackend === 'codex'
          ? 'off'
          : ((modeThinkingOverride ??
              selectedThinkingLevelRef.current) as ThinkingLevel)
      const effortLevel: EffortLevel | undefined =
        targetBackend === 'codex'
          ? ((
              {
                low: 'low',
                medium: 'medium',
                high: 'high',
                xhigh: 'max',
                max: 'max',
              } as Record<string, EffortLevel>
            )[modeThinkingOverride ?? ''] ?? selectedEffortLevelRef.current)
          : undefined
      const provider =
        selectedProviderRef.current === '__anthropic__'
          ? null
          : selectedProviderRef.current
      const { customProfileName } = resolveCustomProfile(model, provider)

      return {
        modeLabel,
        targetBackend,
        model,
        thinkingLevel,
        effortLevel,
        overrideStr,
        provider,
        customProfileName,
      }
    },
    [
      buildBackendRef,
      yoloBackendRef,
      buildModelRef,
      yoloModelRef,
      buildThinkingLevelRef,
      yoloThinkingLevelRef,
      selectedBackendRef,
      session?.backend,
      preferences?.selected_codex_model,
      preferences?.selected_opencode_model,
      selectedModelRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      selectedProviderRef,
      resolveCustomProfile,
    ]
  )

  const sendShortcutInputToSession = useCallback(
    async ({
      snapshot,
      targetSessionId,
      targetWorktreeId,
      targetWorktreePath,
      mode,
    }: {
      snapshot: PendingInputSnapshot
      targetSessionId: string
      targetWorktreeId: string
      targetWorktreePath: string
      mode: 'build' | 'yolo'
    }) => {
      const store = useChatStore.getState()
      const {
        modeLabel,
        targetBackend,
        model,
        thinkingLevel,
        effortLevel,
        overrideStr,
        provider,
        customProfileName,
      } = resolveShortcutExecutionConfig(mode)

      if (overrideStr) {
        toast.info(`${modeLabel}: ${overrideStr}`)
      }

      const message = buildMessageWithAttachmentRefs({
        message: snapshot.message,
        pendingFiles: snapshot.files,
        pendingImages: snapshot.images,
        pendingTextFiles: snapshot.textFiles,
        skills: snapshot.skills,
      })
      clearPendingInputSnapshot(snapshot)

      store.setExecutionMode(targetSessionId, mode)
      store.setLastSentMessage(targetSessionId, message)
      store.setError(targetSessionId, null)
      store.addSendingSession(targetSessionId)
      store.setSelectedModel(targetSessionId, model)
      store.setExecutingMode(targetSessionId, mode)
      store.setSelectedBackend(targetSessionId, targetBackend)
      store.setSelectedProvider(targetSessionId, provider)

      if (
        snapshot.images.length > 0 ||
        snapshot.files.length > 0 ||
        snapshot.skills.length > 0 ||
        snapshot.textFiles.length > 0
      ) {
        store.setLastSentAttachments(targetSessionId, {
          images: snapshot.images,
          files: snapshot.files,
          textFiles: snapshot.textFiles,
          skills: snapshot.skills,
        })
      }

      queryClient.setQueryData<Session>(
        chatQueryKeys.session(targetSessionId),
        old =>
          old
            ? {
                ...old,
                backend: targetBackend,
                selected_execution_mode: mode,
                selected_model: model,
                selected_provider: provider ?? undefined,
              }
            : old
      )

      await invoke('update_session_state', {
        worktreeId: targetWorktreeId,
        worktreePath: targetWorktreePath,
        sessionId: targetSessionId,
        selectedExecutionMode: mode,
      }).catch(err =>
        logger.error('[shortcut send] Failed to persist execution mode:', err)
      )

      await invoke('set_session_model', {
        worktreeId: targetWorktreeId,
        worktreePath: targetWorktreePath,
        sessionId: targetSessionId,
        model,
      }).catch(err =>
        logger.error('[shortcut send] Failed to persist model:', err)
      )

      await invoke('set_session_backend', {
        worktreeId: targetWorktreeId,
        worktreePath: targetWorktreePath,
        sessionId: targetSessionId,
        backend: targetBackend,
      }).catch(err =>
        logger.error('[shortcut send] Failed to persist backend:', err)
      )

      await invoke('set_session_provider', {
        worktreeId: targetWorktreeId,
        worktreePath: targetWorktreePath,
        sessionId: targetSessionId,
        provider,
      }).catch(err =>
        logger.error('[shortcut send] Failed to persist provider:', err)
      )

      sendMessage.mutate({
        sessionId: targetSessionId,
        worktreeId: targetWorktreeId,
        worktreePath: targetWorktreePath,
        message,
        model,
        executionMode: mode,
        thinkingLevel,
        effortLevel,
        parallelExecutionPrompt: resolveParallelExecutionPromptForSession(
          targetSessionId,
          preferences
        ),
        aiLanguage: preferences?.ai_language,
        mcpConfig: buildMcpConfigJson(
          mcpServersDataRef.current ?? [],
          enabledMcpServersRef.current
        ),
        chromeEnabled: preferences?.chrome_enabled ?? false,
        customProfileName,
        backend: targetBackend,
      })
    },
    [
      resolveShortcutExecutionConfig,
      clearPendingInputSnapshot,
      queryClient,
      preferences?.ai_language,
      preferences?.chrome_enabled,
      mcpServersDataRef,
      enabledMcpServersRef,
      sendMessage,
    ]
  )

  const handleHarnessFanoutSend = useAgentHarnessFanout({
    projectId: worktree?.project_id,
    sourceBaseBranch: worktree?.branch,
    sourceHasUncommittedChanges: uncommittedAdded > 0 || uncommittedRemoved > 0,
    getPendingInputSnapshot,
    clearPendingInputSnapshot,
    executionModeRef,
    selectedThinkingLevelRef,
    selectedEffortLevelRef,
    selectedProviderRef,
    selectedModelRef,
    mcpServersDataRef,
    enabledMcpServersRef,
    preferences,
    queryClient,
    sendMessage,
    resolveCustomProfile,
  })

  const handleInputNewSessionShortcut = useCallback(
    async (mode: 'build' | 'yolo') => {
      if (!activeWorktreeId || !activeWorktreePath) return

      const snapshot = getPendingInputSnapshot()
      if (!snapshot) return

      let newSession: Session
      try {
        newSession = await createSession.mutateAsync({
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
        })
      } catch (err) {
        toast.error(`Failed to create session: ${err}`)
        return
      }

      const store = useChatStore.getState()
      store.setActiveSession(activeWorktreeId, newSession.id)
      store.addUserInitiatedSession(newSession.id)

      await sendShortcutInputToSession({
        snapshot,
        targetSessionId: newSession.id,
        targetWorktreeId: activeWorktreeId,
        targetWorktreePath: activeWorktreePath,
        mode,
      })
    },
    [
      activeWorktreeId,
      activeWorktreePath,
      getPendingInputSnapshot,
      createSession,
      clearPendingInputSnapshot,
      sendShortcutInputToSession,
    ]
  )

  const handleInputNewWorktreeShortcut = useCallback(
    async (mode: 'build' | 'yolo') => {
      const projectId = worktree?.project_id
      if (!projectId) return

      const snapshot = getPendingInputSnapshot()
      if (!snapshot) return

      const toastId = toast.loading('Creating worktree...')

      let pendingWorktree: Worktree
      try {
        pendingWorktree = await invoke<Worktree>('create_worktree', {
          projectId,
        })
      } catch (err) {
        toast.error(`Failed to create worktree: ${err}`, { id: toastId })
        return
      }

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
        toast.error(`Worktree creation failed: ${err}`, { id: toastId })
        return
      }

      let newSession: Session
      try {
        const readySessions = await invoke<WorktreeSessions>('get_sessions', {
          worktreeId: readyWorktree.id,
          worktreePath: readyWorktree.path,
        })
        if (readySessions.sessions.length > 0 && readySessions.sessions[0]) {
          newSession = readySessions.sessions[0]
        } else {
          newSession = await invoke<Session>('create_session', {
            worktreeId: readyWorktree.id,
            worktreePath: readyWorktree.path,
          })
        }
      } catch (err) {
        toast.error(`Failed to get session: ${err}`, { id: toastId })
        return
      }

      const store = useChatStore.getState()
      const projectsStore = useProjectsStore.getState()
      projectsStore.expandProject(readyWorktree.project_id)
      projectsStore.selectWorktree(readyWorktree.id)
      store.registerWorktreePath(readyWorktree.id, readyWorktree.path)
      store.setActiveWorktree(readyWorktree.id, readyWorktree.path)
      store.setActiveSession(readyWorktree.id, newSession.id)
      store.addUserInitiatedSession(newSession.id)

      await sendShortcutInputToSession({
        snapshot,
        targetSessionId: newSession.id,
        targetWorktreeId: readyWorktree.id,
        targetWorktreePath: readyWorktree.path,
        mode,
      })

      toast.success(`Prompt sent to new worktree (${mode})`, { id: toastId })
    },
    [
      worktree?.project_id,
      getPendingInputSnapshot,
      clearPendingInputSnapshot,
      sendShortcutInputToSession,
    ]
  )

  const handleInputNewBuildSession = useCallback(() => {
    void handleInputNewSessionShortcut('build')
  }, [handleInputNewSessionShortcut])

  const handleInputNewYoloSession = useCallback(() => {
    void handleInputNewSessionShortcut('yolo')
  }, [handleInputNewSessionShortcut])

  const handleInputNewBuildWorktree = useCallback(() => {
    void handleInputNewWorktreeShortcut('build')
  }, [handleInputNewWorktreeShortcut])

  const handleInputNewYoloWorktree = useCallback(() => {
    void handleInputNewWorktreeShortcut('yolo')
  }, [handleInputNewWorktreeShortcut])

  // Note: Queue processing moved to useQueueProcessor hook in App.tsx
  // This ensures queued messages execute even when the worktree is unfocused

  // Git operations hook - handles commit, PR, review, merge operations
  const {
    handleCommit,
    handleCommitAndPush,
    handlePull,
    handlePullUpstream,
    handlePush,
    handleOpenPr,
    handleReview,
    handleMerge,
    handleMergePr,
    handleResolveConflicts,
    handleResolvePrConflicts,
    executeMerge,
    showMergeDialog,
    setShowMergeDialog,
  } = useGitOperations({
    activeWorktreeId,
    activeSessionId,
    activeWorktreePath,
    worktree,
    project,
    queryClient,
    inputRef,
    preferences,
  })

  // Wrap push/pull/commit-and-push with remote picker for multi-remote repos
  const pickRemoteOrRun = useRemotePicker(activeWorktreePath)

  const handlePushWithPicker = useCallback(
    () =>
      worktree?.pr_number
        ? handlePush()
        : pickRemoteOrRun(remote => handlePush(remote)),
    [worktree?.pr_number, pickRemoteOrRun, handlePush]
  )

  const handleCommitAndPushWithPicker = useCallback(
    () =>
      worktree?.pr_number
        ? handleCommitAndPush()
        : pickRemoteOrRun(remote => handleCommitAndPush(remote)),
    [worktree?.pr_number, pickRemoteOrRun, handleCommitAndPush]
  )

  const handlePullWithPicker = useCallback(
    () => pickRemoteOrRun(remote => handlePull(remote)),
    [pickRemoteOrRun, handlePull]
  )

  const handleOpenPullRequestReview = useCallback(() => {
    if (!activeWorktreePath || !worktree?.pr_number) return
    useUIStore.getState().openPullRequestReviewDialog({
      projectPath: activeWorktreePath,
      prNumber: worktree.pr_number,
    })
  }, [activeWorktreePath, worktree?.pr_number])

  // Global cancel keyboard shortcut (Cmd+Option+Backspace / Ctrl+Alt+Backspace)
  // ChatInput handles this when focused, but we need a global handler for when
  // focus is elsewhere (e.g., ReviewResultsPanel after clicking Fix)
  useEffect(() => {
    if (!isSending) return

    const handleGlobalCancel = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.altKey &&
        (e.key === 'Backspace' || e.key === 'Delete')
      ) {
        e.preventDefault()
        e.stopPropagation()
        handleCancel()
      }
    }

    document.addEventListener('keydown', handleGlobalCancel)
    return () => document.removeEventListener('keydown', handleGlobalCancel)
  }, [isSending, handleCancel])

  // Context operations hook - handles save/load context
  const {
    handleLoadContext,
    handleSaveContext,
    loadContextModalOpen,
    setLoadContextModalOpen,
  } = useContextOperations({
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    worktree,
    queryClient,
    preferences,
  })
  const handleLinkedProjectsModalChange = useCallback((open: boolean) => {
    useUIStore.getState().setLinkedProjectsModalOpen(open)
  }, [])

  // Window event listeners are called after useMessageHandlers (needs plan approval handlers)

  // PERFORMANCE: Stable callbacks for ChatToolbar to prevent re-renders
  const {
    handleToolbarModelChange,
    handleToolbarBackendChange,
    handleTabBackendSwitch,
    handleToolbarProviderChange,
    handleToolbarThinkingLevelChange,
    handleToolbarEffortLevelChange,
    handleToggleMcpServer,
    handleOpenProjectSettings,
    handleToolbarSetExecutionMode,
    handleOpenMagicModal,
    handleLoadContextModalChange,
  } = useToolbarHandlers({
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    activeSessionIdRef,
    activeWorktreeIdRef,
    activeWorktreePathRef,
    enabledMcpServersRef,
    selectedBackend,
    installedBackends,
    session,
    preferences,
    queryClient,
    worktreeProjectId: worktree?.project_id,
    setSessionModel,
    setSessionBackend,
    setSessionProvider,
    setSessionThinkingLevel,
    setSessionEffortLevel,
    setExecutionMode,
    setLoadContextModalOpen,
  })

  // Investigate issue/PR and workflow run handlers
  const {
    handleInvestigate,
    handleInvestigateWorkflowRun,
    handleReviewComments,
  } = useInvestigateHandlers({
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    inputRef,
    preferences,
    selectedModelRef,
    selectedThinkingLevelRef,
    executionModeRef,
    mcpServersDataRef,
    enabledMcpServersRef,
    activeWorktreeIdRef,
    activeWorktreePathRef,
    sendMessage,
    setSessionProvider,
    setSessionBackend,
    setSessionModel,
    setSessionEffortLevel,
    createSession,
    resolveCustomProfile,
    cliVersion: cliStatus?.version ?? null,
    worktreeProjectId: worktree?.project_id,
  })

  // Listen for magic-command events from MagicModal
  useMagicCommands({
    handleSaveContext,
    handleLoadContext,
    handleCommit,
    handleCommitAndPush: handleCommitAndPushWithPicker,
    handlePull: handlePullWithPicker,
    handlePullUpstream,
    handlePush: handlePushWithPicker,
    handleOpenPr,
    handleReview,
    handleMerge,
    handleMergePr,
    handleResolveConflicts,
    handleLinkedProjects: () =>
      useUIStore.getState().setLinkedProjectsModalOpen(true),
    handleInvestigateWorkflowRun,
    handleInvestigate,
    handleReviewComments,
    isModal,
    sessionModalOpen,
  })

  // Pick up per-worktree auto-investigate flags (set by useNewWorktreeHandlers
  // when worktree is created with auto-investigate). Uses per-worktree Sets so
  // multiple concurrent worktree creations each get their own investigation.
  // Guard: wait for worktree status === 'ready' to ensure the git directory
  // exists on disk before spawning Claude CLI (which uses current_dir).
  const worktreeStatus = worktree?.status
  useEffect(() => {
    if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return
    if (worktreeStatus !== 'ready') return
    if (!hasPendingAutoInvestigate) return
    const uiStore = useUIStore.getState()
    if (uiStore.consumeAutoInvestigate(activeWorktreeId)) {
      handleInvestigate('issue')
    } else if (uiStore.consumeAutoInvestigatePR(activeWorktreeId)) {
      handleInvestigate('pr')
    } else if (uiStore.consumeAutoInvestigateSecurityAlert(activeWorktreeId)) {
      handleInvestigate('security-alert')
    } else if (uiStore.consumeAutoInvestigateAdvisory(activeWorktreeId)) {
      handleInvestigate('advisory')
    } else if (uiStore.consumeAutoInvestigateLinearIssue(activeWorktreeId)) {
      handleInvestigate('linear-issue')
    }
  }, [
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    worktreeStatus,
    hasPendingAutoInvestigate,
    handleInvestigate,
  ])

  // Message handlers hook - handles questions, plan approval, permission approval, finding fixes
  const {
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
    handlePermissionApproval,
    handlePermissionApprovalAndPersist,
    handlePermissionApprovalYolo,
    handlePermissionDeny,
    handleCodexMcpElicitationRespond,
    handleFixFinding,
    handleFixAllFindings,
  } = useMessageHandlers({
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
    getCustomProfileName: () => {
      return selectedProviderRef.current ?? undefined
    },
    executionModeRef,
    selectedThinkingLevelRef,
    selectedEffortLevelRef,
    useAdaptiveThinkingRef,
    getMcpConfig,
    markAtBottom,
    sendMessage,
    createSession,
    queryClient,
    scrollToBottom,
    inputRef,
    pendingPlanMessage,
    projectIdRef,
  })

  // Copy a sent user message to the clipboard with attachment metadata
  // When pasted back, ChatInput detects the custom format and restores attachments
  const handleCopyToInput = useCallback(async (message: ChatMessage) => {
    const metadata = buildPromptAttachmentMetadata(
      message.content,
      getSkillName
    )
    const cleanText = stripLeadingInjectedSkillTokens(
      stripAllMarkers(message.content),
      metadata.skills
    )

    const encodedMetadata = encodePromptAttachmentMetadata(metadata)
    const fallbackText = appendPromptMetadataToPlainText(cleanText, metadata)
    const escapedCleanText = cleanText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const htmlContent = `<span data-jean-prompt="${encodedMetadata}">${escapedCleanText}</span>`

    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([cleanText], { type: 'text/plain' }),
            'text/html': new Blob([htmlContent], { type: 'text/html' }),
          }),
        ])
        toast.success('Prompt copied')
        return
      } catch {
        // Fall through to plain-text metadata fallback.
      }
    }

    await copyToClipboard(fallbackText)
    toast.success('Prompt copied')
  }, [])

  // Window event listeners (focus, plan, recap, git-diff, cancel, create-session, plan approval, etc.)
  useChatWindowEvents({
    inputRef,
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    isModal,
    latestPlanContent,
    latestPlanFilePath,
    setPlanDialogContent,
    setIsPlanDialogOpen,
    setPlanDialogMode,
    session,
    isRecapDialogOpen,
    recapDialogDigest,
    setRecapDialogDigest,
    setIsRecapDialogOpen,
    setIsGeneratingRecap,
    gitStatus,
    setDiffRequest,
    isAtBottom,
    scrollToBottom,
    currentStreamingContentBlocks,
    isSending,
    currentQueuedMessages,
    createSession,
    preferences,
    patchPreferences,
    handleSaveContext,
    handleLoadContext,
    runScripts,
    hasStreamingPlan,
    pendingPlanMessage,
    handleStreamingPlanApproval,
    handleStreamingPlanApprovalYolo,
    handlePlanApproval,
    handlePlanApprovalYolo,
    handleClearContextApproval,
    handleStreamingClearContextApproval,
    handleClearContextApprovalBuild,
    handleStreamingClearContextApprovalBuild,
    handleWorktreeBuildApproval,
    handleStreamingWorktreeBuildApproval,
    handleWorktreeYoloApproval,
    handleStreamingWorktreeYoloApproval,
    handleInputNewSessionYolo: handleInputNewYoloSession,
    handleInputNewSessionBuild: handleInputNewBuildSession,
    handleInputNewWorktreeBuild: handleInputNewBuildWorktree,
    handleInputNewWorktreeYolo: handleInputNewYoloWorktree,
    handleToggleParallelExecutionPrompting,
    scrollViewportRef,
    beginKeyboardScroll,
    endKeyboardScroll,
  })

  // Combined floating-button approval callbacks (dispatch to streaming or pending variant)
  const floatingApprove = useCallback(() => {
    if (hasStreamingPlan) handleStreamingPlanApproval()
    else if (pendingPlanMessage) handlePlanApproval(pendingPlanMessage.id)
  }, [
    hasStreamingPlan,
    handleStreamingPlanApproval,
    pendingPlanMessage,
    handlePlanApproval,
  ])

  const floatingYoloApprove = useCallback(() => {
    if (hasStreamingPlan) handleStreamingPlanApprovalYolo()
    else if (pendingPlanMessage) handlePlanApprovalYolo(pendingPlanMessage.id)
  }, [
    hasStreamingPlan,
    handleStreamingPlanApprovalYolo,
    pendingPlanMessage,
    handlePlanApprovalYolo,
  ])

  const floatingClearContextBuildApprove = useCallback(() => {
    if (hasStreamingPlan) handleStreamingClearContextApprovalBuild()
    else if (pendingPlanMessage)
      handleClearContextApprovalBuild(pendingPlanMessage.id)
  }, [
    hasStreamingPlan,
    handleStreamingClearContextApprovalBuild,
    pendingPlanMessage,
    handleClearContextApprovalBuild,
  ])

  const floatingClearContextApprove = useCallback(() => {
    if (hasStreamingPlan) handleStreamingClearContextApproval()
    else if (pendingPlanMessage)
      handleClearContextApproval(pendingPlanMessage.id)
  }, [
    hasStreamingPlan,
    handleStreamingClearContextApproval,
    pendingPlanMessage,
    handleClearContextApproval,
  ])

  const floatingWorktreeBuildApprove = useCallback(() => {
    if (hasStreamingPlan) handleStreamingWorktreeBuildApproval()
    else if (pendingPlanMessage)
      handleWorktreeBuildApproval(pendingPlanMessage.id)
  }, [
    hasStreamingPlan,
    handleStreamingWorktreeBuildApproval,
    pendingPlanMessage,
    handleWorktreeBuildApproval,
  ])

  const floatingWorktreeYoloApprove = useCallback(() => {
    if (hasStreamingPlan) handleStreamingWorktreeYoloApproval()
    else if (pendingPlanMessage)
      handleWorktreeYoloApproval(pendingPlanMessage.id)
  }, [
    hasStreamingPlan,
    handleStreamingWorktreeYoloApproval,
    pendingPlanMessage,
    handleWorktreeYoloApproval,
  ])

  // Pending attachment removal and slash command execution
  const {
    handleRemovePendingImage,
    handleRemovePendingTextFile,
    handleRemovePendingSkill,
    handleRemovePendingFile,
    handleCommandExecute,
  } = usePendingAttachments({
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    selectedModelRef,
    selectedProviderRef,
    executionModeRef,
    selectedThinkingLevelRef,
    selectedEffortLevelRef,
    useAdaptiveThinkingRef,
    isCodexBackendRef,
    mcpServersDataRef,
    enabledMcpServersRef,
    selectedBackendRef,
    inputRef,
    setInputDraft,
    sendMessageNow,
  })

  const {
    handleRemoveQueuedMessage,
    handleReorderQueuedMessages,
    handleSteerQueuedMessage,
  } = useQueuedMessages({
    activeSessionId,
    activeWorktreeId,
    activeWorktreePath,
    selectedBackend,
  })

  // Messages for rendering - memoize to ensure stable reference
  const messages = useMemo(
    () =>
      dedupeInFlightAssistantMessage(session?.messages ?? [], {
        isSending,
        streamingContent,
        streamingContentBlocks: currentStreamingContentBlocks,
        streamingToolCalls: currentToolCalls,
      }),
    [
      session?.messages,
      isSending,
      streamingContent,
      currentStreamingContentBlocks,
      currentToolCalls,
    ]
  )

  // Virtualizer for message list - always use virtualization for consistent performance
  // Even small conversations benefit from virtualization when messages have heavy content
  // Note: MainWindowContent handles the case when no worktree is selected
  if (!activeWorktreePath || !activeWorktreeId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a worktree to start chatting
      </div>
    )
  }

  return (
    <ErrorBoundary
      resetKeys={[activeWorktreeId]}
      onError={(error, errorInfo) => {
        logger.error('ChatWindow crashed', {
          error: error.message,
          stack: error.stack,
        })
        saveCrashState(
          { activeWorktreeId, activeSessionId },
          {
            error: error.message,
            stack: error.stack ?? '',
            componentStack: errorInfo.componentStack ?? undefined,
          }
        ).catch(() => {
          /* noop */
        })
      }}
      fallbackRender={({ error, resetErrorBoundary }) => (
        <ChatErrorFallback
          error={error}
          resetErrorBoundary={resetErrorBoundary}
          activeWorktreeId={activeWorktreeId}
        />
      )}
    >
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel
            defaultSize={hasReviewResults && reviewSidebarVisible ? 50 : 100}
            minSize={40}
          >
            <ResizablePanelGroup direction="vertical" className="h-full">
              <ResizablePanel
                defaultSize={terminalVisible ? 70 : 100}
                minSize={30}
              >
                <div className="flex h-full flex-col">
                  {/* Messages area */}
                  <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                    {/* Session label badge - absolute positioned to avoid covering content */}
                    {sessionLabel && (
                      <span
                        className="absolute top-2 right-4 z-20 inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: sessionLabel.color,
                          color: getLabelTextColor(sessionLabel.color),
                        }}
                      >
                        {sessionLabel.name}
                      </span>
                    )}
                    {automationBadge && (
                      <span className="absolute top-2 left-4 z-20 inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                        <Bot className="h-3 w-3" />
                        {automationBadge}
                      </span>
                    )}
                    {/* Bottom fade gradient so messages don't hard-cut at the input area */}
                    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-8 bg-gradient-to-b from-transparent to-background" />
                    {/* Session digest reminder (shows when opening a session that had activity while out of focus) */}
                    {activeSessionId && (
                      <SessionDigestReminder sessionId={activeSessionId} />
                    )}
                    <ScrollArea
                      className="h-full w-full"
                      viewportRef={scrollViewportRef}
                      onScroll={handleScroll}
                    >
                      <div className="mx-auto max-w-7xl px-4 pt-4 pb-6 md:px-6 min-w-0 w-full">
                        <div className="select-text space-y-4 font-mono text-sm min-w-0 break-words overflow-x-auto">
                          {/* Debug info (enabled via Settings → Experimental → Debug mode) */}
                          {preferences?.debug_mode_enabled &&
                            activeWorktreeId &&
                            activeWorktreePath &&
                            activeSessionId && (
                              <div className="text-[0.625rem] text-muted-foreground/50 bg-muted/30 rounded font-mono">
                                <SessionDebugPanel
                                  worktreeId={activeWorktreeId}
                                  worktreePath={activeWorktreePath}
                                  sessionId={activeSessionId}
                                  selectedModel={selectedModel}
                                  selectedProvider={selectedProvider}
                                  selectedBackend={selectedBackend}
                                  onFileClick={setViewingFilePath}
                                />
                              </div>
                            )}
                          {/* Setup script output from jean.json */}
                          {setupScriptResult && activeWorktreeId && (
                            <SetupScriptOutput
                              result={setupScriptResult}
                              onDismiss={() =>
                                clearSetupScriptResult(activeWorktreeId)
                              }
                            />
                          )}
                          <CodexGoalBanner
                            sessionId={activeSessionId ?? null}
                            worktreeId={activeWorktreeId ?? null}
                            worktreePath={activeWorktreePath ?? null}
                            isCodexBackend={isCodexBackend}
                          />
                          {isLoading ||
                          isSessionsLoading ||
                          isSessionSwitching ? (
                            <div className="text-muted-foreground">
                              Loading...
                            </div>
                          ) : preferences?.compact_chat_view_enabled ? (
                            <CompactMessageList
                              ref={virtualizedListRef}
                              messages={messages}
                              scrollContainerRef={scrollViewportRef}
                              totalMessages={messages.length}
                              pendingPlanMessageId={
                                pendingPlanMessage?.id ?? null
                              }
                              sessionId={deferredSessionId ?? ''}
                              worktreePath={activeWorktreePath ?? ''}
                              approveShortcut={approveShortcut}
                              approveShortcutYolo={approveShortcutYolo}
                              approveShortcutClearContext={
                                approveShortcutClearContext
                              }
                              approveShortcutClearContextBuild={
                                approveShortcutClearContextBuild
                              }
                              approveButtonRef={approveButtonRef}
                              approvedPlanMessageIds={approvedPlanMessageIds}
                              isSending={isSending}
                              onPlanApproval={handlePlanApproval}
                              onCustomBuildPrompt={openBuildCustomPromptDialog}
                              onPlanApprovalYolo={handlePlanApprovalYolo}
                              onClearContextApproval={
                                handleClearContextApproval
                              }
                              onClearContextApprovalBuild={
                                handleClearContextApprovalBuild
                              }
                              onWorktreeBuildApproval={
                                worktree?.project_id
                                  ? handleWorktreeBuildApproval
                                  : undefined
                              }
                              onWorktreeYoloApproval={
                                worktree?.project_id
                                  ? handleWorktreeYoloApproval
                                  : undefined
                              }
                              onQuestionAnswer={handleQuestionAnswer}
                              onQuestionSkip={handleSkipQuestion}
                              onFileClick={setViewingFilePath}
                              onEditedFileClick={setViewingFilePath}
                              onFixFinding={handleFixFinding}
                              onFixAllFindings={handleFixAllFindings}
                              isQuestionAnswered={isQuestionAnswered}
                              getSubmittedAnswers={getSubmittedAnswers}
                              areQuestionsSkipped={areQuestionsSkipped}
                              isFindingFixed={isFindingFixed}
                              onCopyToInput={handleCopyToInput}
                              shouldScrollToBottom={isAtBottom}
                              onScrollToBottomHandled={
                                handleScrollToBottomHandled
                              }
                              completedDurationMs={completedDurationMs}
                            />
                          ) : (
                            <VirtualizedMessageList
                              ref={virtualizedListRef}
                              messages={messages}
                              scrollContainerRef={scrollViewportRef}
                              totalMessages={messages.length}
                              pendingPlanMessageId={
                                pendingPlanMessage?.id ?? null
                              }
                              sessionId={deferredSessionId ?? ''}
                              worktreePath={activeWorktreePath ?? ''}
                              approveShortcut={approveShortcut}
                              approveShortcutYolo={approveShortcutYolo}
                              approveShortcutClearContext={
                                approveShortcutClearContext
                              }
                              approveShortcutClearContextBuild={
                                approveShortcutClearContextBuild
                              }
                              approveButtonRef={approveButtonRef}
                              approvedPlanMessageIds={approvedPlanMessageIds}
                              isSending={isSending}
                              onPlanApproval={handlePlanApproval}
                              onCustomBuildPrompt={openBuildCustomPromptDialog}
                              onPlanApprovalYolo={handlePlanApprovalYolo}
                              onClearContextApproval={
                                handleClearContextApproval
                              }
                              onClearContextApprovalBuild={
                                handleClearContextApprovalBuild
                              }
                              onWorktreeBuildApproval={
                                worktree?.project_id
                                  ? handleWorktreeBuildApproval
                                  : undefined
                              }
                              onWorktreeYoloApproval={
                                worktree?.project_id
                                  ? handleWorktreeYoloApproval
                                  : undefined
                              }
                              onQuestionAnswer={handleQuestionAnswer}
                              onQuestionSkip={handleSkipQuestion}
                              onFileClick={setViewingFilePath}
                              onEditedFileClick={setViewingFilePath}
                              onFixFinding={handleFixFinding}
                              onFixAllFindings={handleFixAllFindings}
                              isQuestionAnswered={isQuestionAnswered}
                              getSubmittedAnswers={getSubmittedAnswers}
                              areQuestionsSkipped={areQuestionsSkipped}
                              isFindingFixed={isFindingFixed}
                              onCopyToInput={handleCopyToInput}
                              shouldScrollToBottom={isAtBottom}
                              onScrollToBottomHandled={
                                handleScrollToBottomHandled
                              }
                              completedDurationMs={completedDurationMs}
                            />
                          )}
                          {isSending &&
                            activeSessionId &&
                            (preferences?.compact_chat_view_enabled ? (
                              <CompactStreamingTicker
                                sessionId={activeSessionId}
                                worktreePath={activeWorktreePath ?? ''}
                                contentBlocks={currentStreamingContentBlocks}
                                toolCalls={currentToolCalls}
                                streamingContent={streamingContent}
                                selectedThinkingLevel={selectedThinkingLevel}
                                approveShortcut={approveShortcut}
                                approveShortcutYolo={approveShortcutYolo}
                                approveShortcutClearContext={
                                  approveShortcutClearContext
                                }
                                approveShortcutClearContextBuild={
                                  approveShortcutClearContextBuild
                                }
                                approveButtonRef={approveButtonRef}
                                onQuestionAnswer={handleQuestionAnswer}
                                onQuestionSkip={handleSkipQuestion}
                                onFileClick={setViewingFilePath}
                                scrollViewportRef={scrollViewportRef}
                                onEditedFileClick={setViewingFilePath}
                                isQuestionAnswered={isQuestionAnswered}
                                getSubmittedAnswers={getSubmittedAnswers}
                                areQuestionsSkipped={areQuestionsSkipped}
                                isStreamingPlanApproved={
                                  isStreamingPlanApproved
                                }
                                onStreamingPlanApproval={
                                  handleStreamingPlanApproval
                                }
                                onStreamingCustomBuildPrompt={
                                  openBuildCustomPromptDialog
                                }
                                onStreamingPlanApprovalYolo={
                                  handleStreamingPlanApprovalYolo
                                }
                                onStreamingClearContextApproval={
                                  handleStreamingClearContextApproval
                                }
                                onStreamingClearContextApprovalBuild={
                                  handleStreamingClearContextApprovalBuild
                                }
                                onStreamingWorktreeBuildApproval={
                                  worktree?.project_id
                                    ? handleStreamingWorktreeBuildApproval
                                    : undefined
                                }
                                onStreamingWorktreeYoloApproval={
                                  worktree?.project_id
                                    ? handleStreamingWorktreeYoloApproval
                                    : undefined
                                }
                              />
                            ) : (
                              <StreamingMessage
                                sessionId={activeSessionId}
                                worktreePath={activeWorktreePath ?? ''}
                                contentBlocks={currentStreamingContentBlocks}
                                toolCalls={currentToolCalls}
                                streamingContent={streamingContent}
                                selectedThinkingLevel={selectedThinkingLevel}
                                approveShortcut={approveShortcut}
                                approveShortcutYolo={approveShortcutYolo}
                                approveShortcutClearContext={
                                  approveShortcutClearContext
                                }
                                approveShortcutClearContextBuild={
                                  approveShortcutClearContextBuild
                                }
                                approveButtonRef={approveButtonRef}
                                onQuestionAnswer={handleQuestionAnswer}
                                onQuestionSkip={handleSkipQuestion}
                                onFileClick={setViewingFilePath}
                                scrollViewportRef={scrollViewportRef}
                                onEditedFileClick={setViewingFilePath}
                                isQuestionAnswered={isQuestionAnswered}
                                getSubmittedAnswers={getSubmittedAnswers}
                                areQuestionsSkipped={areQuestionsSkipped}
                                isStreamingPlanApproved={
                                  isStreamingPlanApproved
                                }
                                onStreamingPlanApproval={
                                  handleStreamingPlanApproval
                                }
                                onStreamingCustomBuildPrompt={
                                  openBuildCustomPromptDialog
                                }
                                onStreamingPlanApprovalYolo={
                                  handleStreamingPlanApprovalYolo
                                }
                                onStreamingClearContextApproval={
                                  handleStreamingClearContextApproval
                                }
                                onStreamingClearContextApprovalBuild={
                                  handleStreamingClearContextApprovalBuild
                                }
                                onStreamingWorktreeBuildApproval={
                                  worktree?.project_id
                                    ? handleStreamingWorktreeBuildApproval
                                    : undefined
                                }
                                onStreamingWorktreeYoloApproval={
                                  worktree?.project_id
                                    ? handleStreamingWorktreeYoloApproval
                                    : undefined
                                }
                              />
                            ))}

                          {/* Permission approval UI - shown when tools require approval (never in yolo mode) */}
                          {showPermissionApproval && activeSessionId && (
                            <PermissionApproval
                              sessionId={activeSessionId}
                              denials={pendingDenials}
                              onApprove={handlePermissionApproval}
                              onApproveAndPersist={
                                handlePermissionApprovalAndPersist
                              }
                              onApproveYolo={handlePermissionApprovalYolo}
                              onDeny={handlePermissionDeny}
                            />
                          )}

                          {activeSessionId &&
                            pendingCodexMcpElicitations.map(elicitation => (
                              <CodexMcpElicitation
                                key={elicitation.rpc_id}
                                sessionId={activeSessionId}
                                elicitation={elicitation}
                                onRespond={handleCodexMcpElicitationRespond}
                              />
                            ))}
                        </div>
                      </div>
                    </ScrollArea>

                    {/* Floating scroll buttons */}
                    <FloatingButtons
                      showApproveButton={
                        (!!pendingPlanMessage || hasStreamingPlan) &&
                        !isInlineApproveVisible
                      }
                      showFindingsButton={!areFindingsVisible}
                      isAtBottom={isAtBottom}
                      approveShortcut={approveShortcut}
                      onApprove={floatingApprove}
                      onCustomBuildPrompt={openBuildCustomPromptDialog}
                      onYoloApprove={floatingYoloApprove}
                      onClearContextBuildApprove={
                        floatingClearContextBuildApprove
                      }
                      onClearContextApprove={floatingClearContextApprove}
                      onWorktreeBuildApprove={
                        worktree?.project_id
                          ? floatingWorktreeBuildApprove
                          : undefined
                      }
                      onWorktreeYoloApprove={
                        worktree?.project_id
                          ? floatingWorktreeYoloApprove
                          : undefined
                      }
                      onScrollToFindings={scrollToFindings}
                      onScrollToBottom={scrollToBottom}
                    />
                  </div>

                  {/* Error banner - shows when request fails */}
                  {currentError && (
                    <ErrorBanner
                      error={currentError}
                      onDismiss={() =>
                        activeSessionId && setError(activeSessionId, null)
                      }
                    />
                  )}

                  {/* Input container - full width, centered content */}
                  <div>
                    <div className="mx-auto max-w-7xl">
                      <div className="relative sm:mx-auto sm:mb-3 sm:max-w-3xl">
                        <div className="px-4 md:px-6">
                          <StreamingStatusBar
                            isSending={isSending}
                            sendStartedAt={sendStartedAt}
                            streamingExecutionMode={streamingExecutionMode}
                            restoredRunStatus={
                              !isSending &&
                              !isWaitingForInput &&
                              !hasPendingQuestions &&
                              !isSessionReviewing
                                ? session?.last_run_status
                                : undefined
                            }
                            restoredExecutionMode={
                              session?.last_run_execution_mode
                            }
                          />
                        </div>

                        {/* Input area - unified container with textarea and toolbar */}
                        <form
                          ref={formRef}
                          onSubmit={handleSubmit}
                          className={cn(
                            'relative overflow-hidden border-t border-border bg-sidebar transition-[background-color,box-shadow] duration-150 sm:rounded-lg sm:border',
                            isDragging &&
                              'ring-2 ring-primary ring-inset bg-primary/5'
                          )}
                        >
                          {activeSessionId && (
                            <QueuedMessagesList
                              messages={currentQueuedMessages}
                              sessionId={activeSessionId}
                              onRemove={handleRemoveQueuedMessage}
                              onReorder={handleReorderQueuedMessages}
                              onSteer={handleSteerQueuedMessage}
                            />
                          )}

                          {/* Pending file preview (@ mentions) */}
                          <FilePreview
                            files={currentPendingFiles}
                            onRemove={handleRemovePendingFile}
                          />

                          {/* Pending image preview */}
                          <ImagePreview
                            images={currentPendingImages}
                            onRemove={handleRemovePendingImage}
                          />

                          {/* Pending text file preview */}
                          <TextFilePreview
                            textFiles={currentPendingTextFiles}
                            onRemove={handleRemovePendingTextFile}
                            disabled={isSending}
                            sessionId={activeSessionId}
                          />

                          {/* Pending skills preview */}
                          {currentPendingSkills.length > 0 && (
                            <div className="px-4 md:px-6 pt-2 flex flex-wrap gap-2">
                              {currentPendingSkills.map(skill => (
                                <SkillBadge
                                  key={skill.path}
                                  skill={skill}
                                  onRemove={() =>
                                    handleRemovePendingSkill(skill.name)
                                  }
                                />
                              ))}
                            </div>
                          )}

                          {/* Task widget - inline fallback for narrow screens */}
                          {activeTodos.length > 0 &&
                            (dismissedTodoMessageId === null ||
                              (todoSourceMessageId !== null &&
                                todoSourceMessageId !==
                                  dismissedTodoMessageId)) && (
                              <div className="px-4 md:px-6 pt-2 xl:hidden">
                                <TodoWidget
                                  todos={normalizeTodosForDisplay(
                                    activeTodos,
                                    isFromStreaming
                                  )}
                                  isStreaming={isSending}
                                  onClose={() =>
                                    setDismissedTodoMessageId(
                                      todoSourceMessageId ?? '__streaming__'
                                    )
                                  }
                                />
                              </div>
                            )}

                          {/* Agent widget - inline fallback for narrow screens */}
                          {activeAgents.length > 0 &&
                            (dismissedAgentMessageId === null ||
                              (agentSourceMessageId !== null &&
                                agentSourceMessageId !==
                                  dismissedAgentMessageId)) && (
                              <div className="px-4 md:px-6 pt-2 xl:hidden">
                                <AgentWidget
                                  agents={activeAgents}
                                  isStreaming={agentIsFromStreaming}
                                  onClose={() =>
                                    setDismissedAgentMessageId(
                                      agentSourceMessageId ?? '__streaming__'
                                    )
                                  }
                                />
                              </div>
                            )}

                          {/* Textarea section */}
                          <div className="px-4 pt-3 pb-2 md:px-6">
                            <ChatInput
                              activeSessionId={activeSessionId}
                              activeWorktreePath={activeWorktreePath}
                              isSending={isSending}
                              executionMode={executionMode}
                              backend={selectedBackend}
                              canSwitchBackendWithTab={
                                (session?.messages?.length ?? 0) === 0
                              }
                              focusChatShortcut={focusChatShortcut}
                              onSubmit={handleSubmit}
                              onCancel={handleCancel}
                              onSwitchBackendWithTab={handleTabBackendSwitch}
                              onCommandExecute={handleCommandExecute}
                              onHasValueChange={setHasInputValue}
                              onRegisterClearHandler={(
                                handler: (() => void) | null
                              ) => {
                                clearChatInputStateRef.current = handler
                              }}
                              formRef={formRef}
                              inputRef={inputRef}
                            />
                          </div>

                          {/* Bottom toolbar */}
                          <ChatToolbar
                            isSending={isSending}
                            hasPendingQuestions={hasPendingQuestions}
                            hasPendingAttachments={hasPendingAttachments}
                            hasInputValue={hasInputValue}
                            executionMode={executionMode}
                            selectedBackend={selectedBackend}
                            sessionHasMessages={
                              (session?.messages?.length ?? 0) > 0
                            }
                            selectedModel={selectedModel}
                            selectedProvider={selectedProvider}
                            providerLocked={
                              (session?.messages?.length ?? 0) > 0
                            }
                            selectedThinkingLevel={selectedThinkingLevel}
                            selectedEffortLevel={selectedEffortLevel}
                            useAdaptiveThinking={useAdaptiveThinkingFlag}
                            hideThinkingLevel={hideThinkingLevel}
                            baseBranch={gitStatus?.base_branch ?? 'main'}
                            uncommittedAdded={uncommittedAdded}
                            uncommittedRemoved={uncommittedRemoved}
                            branchDiffAdded={branchDiffAdded}
                            branchDiffRemoved={branchDiffRemoved}
                            prUrl={worktree?.pr_url}
                            prNumber={worktree?.pr_number}
                            displayStatus={displayStatus}
                            checkStatus={checkStatus}
                            mergeableStatus={mergeableStatus}
                            activeWorktreePath={activeWorktreePath}
                            worktreeId={activeWorktreeId ?? null}
                            activeSessionId={activeSessionId}
                            projectId={worktree?.project_id}
                            loadedIssueContexts={loadedIssueContexts ?? []}
                            loadedPRContexts={loadedPRContexts ?? []}
                            loadedLinearContexts={loadedLinearContexts ?? []}
                            attachedSavedContexts={attachedSavedContexts ?? []}
                            onOpenMagicModal={handleOpenMagicModal}
                            onSaveContext={handleSaveContext}
                            onLoadContext={handleLoadContext}
                            onCommit={handleCommit}
                            onCommitAndPush={handleCommitAndPushWithPicker}
                            onOpenPr={handleOpenPr}
                            onOpenPullRequestReview={
                              handleOpenPullRequestReview
                            }
                            onReview={() => handleReview()}
                            onMerge={handleMerge}
                            onMergePr={handleMergePr}
                            onResolvePrConflicts={handleResolvePrConflicts}
                            onResolveConflicts={handleResolveConflicts}
                            hasOpenPr={Boolean(worktree?.pr_url)}
                            onSetDiffRequest={setDiffRequest}
                            installedBackends={installedBackends}
                            onBackendChange={handleToolbarBackendChange}
                            onModelChange={handleToolbarModelChange}
                            onProviderChange={handleToolbarProviderChange}
                            customCliProfiles={
                              preferences?.custom_cli_profiles ?? []
                            }
                            onThinkingLevelChange={
                              handleToolbarThinkingLevelChange
                            }
                            onEffortLevelChange={handleToolbarEffortLevelChange}
                            onSetExecutionMode={handleToolbarSetExecutionMode}
                            parallelExecutionPromptEnabled={
                              effectiveParallelExecutionPromptEnabled
                            }
                            onParallelExecutionPromptChange={
                              handleParallelExecutionPromptToggle
                            }
                            supervisorAction={session?.supervisor_action}
                            onSupervisorActionChange={
                              handleSupervisorActionChange
                            }
                            onCancel={handleCancel}
                            queuedMessageCount={currentQueuedMessages.length}
                            onHarnessFanoutSend={handleHarnessFanoutSend}
                            fanoutDisabled={!worktree?.project_id}
                            availableMcpServers={availableMcpServers}
                            enabledMcpServers={enabledMcpServers}
                            onToggleMcpServer={handleToggleMcpServer}
                            onOpenProjectSettings={handleOpenProjectSettings}
                          />
                        </form>

                        {/* Side panel widgets (Tasks + Agents) for wide screens */}
                        {(activeTodos.length > 0 ||
                          activeAgents.length > 0) && (
                          <div className="hidden xl:flex flex-col gap-2 absolute left-full bottom-0 ml-3 w-64 z-20">
                            {activeTodos.length > 0 &&
                              (dismissedTodoMessageId === null ||
                                (todoSourceMessageId !== null &&
                                  todoSourceMessageId !==
                                    dismissedTodoMessageId)) && (
                                <TodoWidget
                                  todos={normalizeTodosForDisplay(
                                    activeTodos,
                                    isFromStreaming
                                  )}
                                  isStreaming={isSending}
                                  onClose={() =>
                                    setDismissedTodoMessageId(
                                      todoSourceMessageId ?? '__streaming__'
                                    )
                                  }
                                />
                              )}
                            {activeAgents.length > 0 &&
                              (dismissedAgentMessageId === null ||
                                (agentSourceMessageId !== null &&
                                  agentSourceMessageId !==
                                    dismissedAgentMessageId)) && (
                                <AgentWidget
                                  agents={activeAgents}
                                  isStreaming={agentIsFromStreaming}
                                  onClose={() =>
                                    setDismissedAgentMessageId(
                                      agentSourceMessageId ?? '__streaming__'
                                    )
                                  }
                                />
                              )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </ResizablePanel>

              {/* Terminal panel - only render when panel is open (not in modal) */}
              {!isModal && activeWorktreePath && terminalPanelOpen && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    ref={terminalPanelRef}
                    defaultSize={terminalVisible ? 30 : 4}
                    minSize={terminalVisible ? 15 : 4}
                    collapsible
                    collapsedSize={4}
                    onCollapse={handleTerminalCollapse}
                    onExpand={handleTerminalExpand}
                  >
                    <TerminalPanel
                      isCollapsed={!terminalVisible}
                      onExpand={handleTerminalExpand}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Review sidebar - shown when active session has review results */}
          {hasReviewResults && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                ref={reviewPanelRef}
                defaultSize={reviewSidebarVisible ? 50 : 0}
                minSize={reviewSidebarVisible ? 20 : 0}
                collapsible
                collapsedSize={0}
                onCollapse={handleReviewSidebarCollapse}
                onExpand={handleReviewSidebarExpand}
              >
                {activeSessionId && (
                  <ReviewResultsPanel
                    sessionId={activeSessionId}
                    onSendFix={handleReviewFix}
                  />
                )}
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        {/* File content modal for viewing files from tool calls */}
        <FileContentModal
          filePath={viewingFilePath}
          onClose={() => setViewingFilePath(null)}
        />

        {/* Git diff modal for viewing diffs */}
        <Suspense fallback={null}>
          <GitDiffModal
            diffRequest={diffRequest}
            onClose={() => setDiffRequest(null)}
            onAddToPrompt={handleGitDiffAddToPrompt}
            onExecutePrompt={handleGitDiffExecutePrompt}
            uncommittedStats={{
              added: uncommittedAdded,
              removed: uncommittedRemoved,
            }}
            branchStats={{ added: branchDiffAdded, removed: branchDiffRemoved }}
            preferredEditor={project?.default_editor}
          />
        </Suspense>

        {/* Single file diff modal for viewing edited file changes */}
        <FileDiffModal
          filePath={editedFilePath}
          worktreePath={activeWorktreePath ?? ''}
          onClose={() => setEditedFilePath(null)}
        />

        {/* Load Context modal for selecting saved contexts */}
        <Suspense fallback={null}>
          <LoadContextModal
            open={loadContextModalOpen}
            onOpenChange={handleLoadContextModalChange}
            worktreeId={activeWorktreeId}
            worktreePath={activeWorktreePath ?? null}
            activeSessionId={activeSessionId ?? null}
            projectName={worktree?.name ?? 'unknown-project'}
            projectId={worktree?.project_id ?? null}
          />
        </Suspense>

        <Suspense fallback={null}>
          <LinkedProjectsModal
            open={linkedProjectsModalOpen}
            onOpenChange={handleLinkedProjectsModalChange}
            projectId={project?.id ?? null}
          />
        </Suspense>

        {/* Plan dialog - editable view of latest plan */}
        {isPlanDialogOpen &&
          (planDialogContent ? (
            <PlanDialog
              content={planDialogContent}
              isOpen={isPlanDialogOpen}
              initialMode={planDialogMode}
              onClose={() => {
                setIsPlanDialogOpen(false)
                setPlanDialogContent(null)
                setPlanDialogMode('default')
              }}
              editable={true}
              approvalContext={
                activeWorktreeId && activeWorktreePath && activeSessionId
                  ? {
                      worktreeId: activeWorktreeId,
                      worktreePath: activeWorktreePath,
                      sessionId: activeSessionId,
                      pendingPlanMessageId: pendingPlanMessage?.id ?? null,
                    }
                  : undefined
              }
              onApprove={handlePlanDialogApprove}
              onApproveWithCustomPrompt={
                handlePlanDialogApproveWithCustomPrompt
              }
              onApproveYolo={handlePlanDialogApproveYolo}
              onClearContextApprove={handlePlanDialogClearContextApprove}
              onClearContextBuildApprove={
                handlePlanDialogClearContextBuildApprove
              }
              onWorktreeBuildApprove={
                worktree?.project_id
                  ? handlePlanDialogWorktreeBuildApprove
                  : undefined
              }
              onWorktreeYoloApprove={
                worktree?.project_id
                  ? handlePlanDialogWorktreeYoloApprove
                  : undefined
              }
            />
          ) : latestPlanFilePath ? (
            <PlanDialog
              filePath={latestPlanFilePath}
              isOpen={isPlanDialogOpen}
              initialMode={planDialogMode}
              onClose={() => {
                setIsPlanDialogOpen(false)
                setPlanDialogMode('default')
              }}
              editable={true}
              approvalContext={
                activeWorktreeId && activeWorktreePath && activeSessionId
                  ? {
                      worktreeId: activeWorktreeId,
                      worktreePath: activeWorktreePath,
                      sessionId: activeSessionId,
                      pendingPlanMessageId: pendingPlanMessage?.id ?? null,
                    }
                  : undefined
              }
              onApprove={handlePlanDialogApprove}
              onApproveWithCustomPrompt={
                handlePlanDialogApproveWithCustomPrompt
              }
              onApproveYolo={handlePlanDialogApproveYolo}
              onClearContextApprove={handlePlanDialogClearContextApprove}
              onClearContextBuildApprove={
                handlePlanDialogClearContextBuildApprove
              }
              onWorktreeBuildApprove={
                worktree?.project_id
                  ? handlePlanDialogWorktreeBuildApprove
                  : undefined
              }
              onWorktreeYoloApprove={
                worktree?.project_id
                  ? handlePlanDialogWorktreeYoloApprove
                  : undefined
              }
            />
          ) : null)}

        {/* Recap dialog */}
        <RecapDialog
          digest={recapDialogDigest}
          isOpen={isRecapDialogOpen}
          onClose={() => {
            setIsRecapDialogOpen(false)
            setRecapDialogDigest(null)
          }}
          isGenerating={isGeneratingRecap}
          onRegenerate={() =>
            window.dispatchEvent(new CustomEvent('open-recap'))
          }
        />

        {/* Merge options dialog */}
        <AlertDialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
          <AlertDialogContent
            onKeyDown={e => {
              const key = e.key.toLowerCase()
              if (key === 'p') {
                e.preventDefault()
                executeMerge('merge')
              } else if (key === 's') {
                e.preventDefault()
                executeMerge('squash')
              } else if (key === 'r') {
                e.preventDefault()
                executeMerge('rebase')
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Merge to Base</AlertDialogTitle>
              <AlertDialogDescription>
                Choose how to merge your changes into the base branch.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2 py-4">
              <Button
                variant="outline"
                className="h-auto justify-between py-3"
                onClick={() => executeMerge('merge')}
              >
                <div className="flex items-center">
                  <GitMerge className="mr-3 h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Preserve History</div>
                    <div className="text-xs text-muted-foreground">
                      Keep all commits, create merge commit
                    </div>
                  </div>
                </div>
                <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  P
                </kbd>
              </Button>
              <Button
                variant="outline"
                className="h-auto justify-between py-3"
                onClick={() => executeMerge('squash')}
              >
                <div className="flex items-center">
                  <Layers className="mr-3 h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Squash Commits</div>
                    <div className="text-xs text-muted-foreground">
                      Combine all commits into one
                    </div>
                  </div>
                </div>
                <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  S
                </kbd>
              </Button>
              <Button
                variant="outline"
                className="h-auto justify-between py-3"
                onClick={() => executeMerge('rebase')}
              >
                <div className="flex items-center">
                  <GitBranch className="mr-3 h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Rebase</div>
                    <div className="text-xs text-muted-foreground">
                      Replay commits on top of base
                    </div>
                  </div>
                </div>
                <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  R
                </kbd>
              </Button>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ErrorBoundary>
  )
}
