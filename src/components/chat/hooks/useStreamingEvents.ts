import { useEffect } from 'react'
import { listen, useWsConnectionStatus } from '@/lib/transport'
import { invoke } from '@/lib/transport'
import { toast } from 'sonner'
import type { QueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { chatQueryKeys } from '@/services/chat'
import { isTauri, saveWorktreePr, projectsQueryKeys } from '@/services/projects'
import { preferencesQueryKeys } from '@/services/preferences'
import type { AppPreferences, NotificationSound } from '@/types/preferences'
import { triggerImmediateGitPoll } from '@/services/git-status'
import { isAskUserQuestion, isExitPlanMode } from '@/types/chat'
import { playNotificationSound } from '@/lib/sounds'
import { findPlanFilePath } from '@/components/chat/tool-call-utils'
import { lookupSessionLabel } from '@/components/chat/hooks/session-label-utils'
import { generateId } from '@/lib/uuid'
import type {
  ChunkEvent,
  CodexMcpElicitation,
  CodexMcpElicitationEvent,
  ToolUseEvent,
  ToolBlockEvent,
  ToolResultEvent,
  ToolEventEvent,
  DoneEvent,
  ErrorEvent,
  CancelledEvent,
  ThinkingEvent,
  PermissionDenial,
  PermissionDeniedEvent,
  CompactingEvent,
  CompactedEvent,
  ThreadTokenUsageEvent,
  Session,
  SessionDigest,
  AllSessionsResponse,
  WorktreeSessions,
  WakeupFiredEvent,
  WakeupScheduledEvent,
  WakeupCancelledEvent,
  PendingWakeupEntry,
  QueuedMessage,
} from '@/types/chat'
import { persistEnqueue } from '@/services/chat'
import {
  applySessionSettingToSession,
  type SessionSettingKey,
} from '@/components/chat/hooks/session-setting-sync'
import { logger } from '@/lib/logger'

interface UseStreamingEventsParams {
  queryClient: QueryClient
}

/**
 * Upsert an optimistic assistant message into the session's message list.
 * If the last message is already an assistant message (e.g. from a cancelled run),
 * replace it instead of appending — prevents duplicate assistant messages when
 * the user cancels and resends.
 */
function upsertAssistantMessage(
  messages: Session['messages'],
  newMsg: Session['messages'][number]
): Session['messages'] {
  const last = messages[messages.length - 1]
  if (last?.role === 'assistant') {
    // Replace the trailing assistant message
    const updated = [...messages]
    updated[updated.length - 1] = newMsg
    return updated
  }
  return [...messages, newMsg]
}

export function shouldPlayPermissionApprovalSound(
  currentDenials: PermissionDeniedEvent['denials'] | undefined,
  newDenials: PermissionDeniedEvent['denials']
): boolean {
  return newDenials.length > 0 && (currentDenials?.length ?? 0) === 0
}

function shouldPlayCodexMcpElicitationSound(
  currentElicitations: CodexMcpElicitation[] | undefined,
  newElicitations: CodexMcpElicitation[]
): boolean {
  return newElicitations.length > 0 && (currentElicitations?.length ?? 0) === 0
}

function shouldPlayWaitingStateTransitionSound(options: {
  wasWaitingForInput?: boolean
  previousPermissionDenialCount?: number
  nextPermissionDenialCount?: number
  previousCodexMcpElicitationCount?: number
  nextCodexMcpElicitationCount?: number
}): boolean {
  const previousPermissionDenialCount =
    options.previousPermissionDenialCount ?? 0
  const nextPermissionDenialCount = options.nextPermissionDenialCount ?? 0
  const previousCodexMcpElicitationCount =
    options.previousCodexMcpElicitationCount ?? 0
  const nextCodexMcpElicitationCount = options.nextCodexMcpElicitationCount ?? 0

  if (nextPermissionDenialCount > 0) {
    return (
      previousPermissionDenialCount === 0 &&
      previousCodexMcpElicitationCount === 0
    )
  }

  if (nextCodexMcpElicitationCount > 0) {
    return (
      previousPermissionDenialCount === 0 &&
      previousCodexMcpElicitationCount === 0
    )
  }

  return !options.wasWaitingForInput
}

function isSessionCurrentlyViewing(
  sessionId: string,
  worktreeId: string
): boolean {
  const { activeWorktreeId, activeSessionIds } = useChatStore.getState()
  const isActiveWorktree = worktreeId === activeWorktreeId
  const isActiveSession = activeSessionIds[worktreeId] === sessionId
  const isViewingInFullView = isActiveWorktree && isActiveSession

  const { sessionChatModalOpen, sessionChatModalWorktreeId } =
    useUIStore.getState()
  const isViewingInModal =
    sessionChatModalOpen &&
    sessionChatModalWorktreeId === worktreeId &&
    isActiveSession

  return isViewingInFullView || isViewingInModal
}

function getWaitingSoundPreference(
  queryClient: QueryClient
): NotificationSound {
  return (queryClient.getQueryData<AppPreferences>(
    preferencesQueryKeys.preferences()
  )?.waiting_sound ?? 'none') as NotificationSound
}

function getReviewSoundPreference(queryClient: QueryClient): NotificationSound {
  return (queryClient.getQueryData<AppPreferences>(
    preferencesQueryKeys.preferences()
  )?.review_sound ?? 'none') as NotificationSound
}

function updateAllSessionsCache(
  queryClient: QueryClient,
  worktreeId: string,
  updater: (session: Session) => Session
): void {
  queryClient.setQueryData<AllSessionsResponse>(['all-sessions'], old => {
    if (!old) return old

    return {
      ...old,
      entries: old.entries.map(entry =>
        entry.worktree_id === worktreeId
          ? {
              ...entry,
              sessions: entry.sessions.map(updater),
            }
          : entry
      ),
    }
  })
}

function invalidateUnreadQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.unreadSessions(),
  })
  queryClient.invalidateQueries({
    queryKey: chatQueryKeys.unreadCount(),
  })
}

function applyPermissionWaitingState(
  session: Session,
  denials: PermissionDenial[],
  options?: {
    updatedAt?: number
    lastOpenedAt?: number
  }
): Session {
  return {
    ...session,
    ...(options?.updatedAt ? { updated_at: options.updatedAt } : {}),
    ...(options?.lastOpenedAt !== undefined
      ? { last_opened_at: options.lastOpenedAt }
      : {}),
    waiting_for_input: true,
    waiting_for_input_type: null,
    pending_permission_denials: denials,
    is_reviewing: false,
  }
}

function applyCodexMcpElicitationWaitingState(
  session: Session,
  elicitations: CodexMcpElicitation[],
  options?: {
    updatedAt?: number
    lastOpenedAt?: number
  }
): Session {
  return {
    ...session,
    ...(options?.updatedAt ? { updated_at: options.updatedAt } : {}),
    ...(options?.lastOpenedAt !== undefined
      ? { last_opened_at: options.lastOpenedAt }
      : {}),
    waiting_for_input: true,
    waiting_for_input_type: null,
    pending_codex_mcp_elicitations: elicitations,
    is_reviewing: false,
  }
}

function mergePermissionDenials(
  currentDenials: PermissionDenial[] | undefined,
  newDenials: PermissionDenial[]
): PermissionDenial[] {
  if ((currentDenials?.length ?? 0) === 0) return newDenials
  if (newDenials.length === 0) return currentDenials ?? []

  const merged = [...(currentDenials ?? [])]
  for (const denial of newDenials) {
    const existingIndex = merged.findIndex(
      current => current.tool_use_id === denial.tool_use_id
    )
    if (existingIndex === -1) {
      merged.push(denial)
    } else {
      merged[existingIndex] = denial
    }
  }
  return merged
}

function mergeCodexMcpElicitations(
  currentElicitations: CodexMcpElicitation[] | undefined,
  newElicitations: CodexMcpElicitation[]
): CodexMcpElicitation[] {
  if ((currentElicitations?.length ?? 0) === 0) return newElicitations
  if (newElicitations.length === 0) return currentElicitations ?? []

  const merged = [...(currentElicitations ?? [])]
  for (const elicitation of newElicitations) {
    const existingIndex = merged.findIndex(
      current => current.rpc_id === elicitation.rpc_id
    )
    if (existingIndex === -1) {
      merged.push(elicitation)
    } else {
      merged[existingIndex] = elicitation
    }
  }
  return merged
}

function getOptimisticAttentionTimestamp(previousUpdatedAt?: number): number {
  const now = Math.floor(Date.now() / 1000)
  return Math.max(now, (previousUpdatedAt ?? 0) + 1)
}

async function resolveWorktreePath(worktreeId: string): Promise<string | null> {
  const store = useChatStore.getState()
  const existingPath = store.worktreePaths[worktreeId]
  if (existingPath) return existingPath

  try {
    const worktree = await invoke<{ path: string }>('get_worktree', {
      worktreeId,
    })
    if (worktree.path) {
      store.registerWorktreePath(worktreeId, worktree.path)
      return worktree.path
    }
  } catch (error) {
    logger.warn('[useStreamingEvents] Failed to resolve worktree path', {
      worktreeId,
      error,
    })
  }

  return null
}

/**
 * Hook that sets up global Tauri event listeners for streaming events from Rust.
 * Events include session_id for routing to the correct session.
 *
 * Handles: chat:chunk, chat:tool_use, chat:tool_block, chat:thinking,
 * chat:tool_result, chat:permission_denied, chat:done, chat:error,
 * chat:cancelled, chat:compacted
 */
export default function useStreamingEvents({
  queryClient,
}: UseStreamingEventsParams): void {
  // Re-run effect when WS connects so listeners are registered in web mode
  const wsConnected = useWsConnectionStatus()

  useEffect(() => {
    if (!isTauri()) return

    const {
      appendStreamingContent,
      addToolCall,
      updateToolCallOutput,
      appendToolEvent,
      addTextBlock,
      addToolBlock,
      appendThinkingBlock,
      addSendingSession,
    } = useChatStore.getState()

    // Hydrate ScheduleWakeup indicator store from backend so reloads do not
    // show historical tool_use blocks stuck in the "pending" spinner state.
    invoke<PendingWakeupEntry[]>('list_pending_wakeups')
      .then(entries => {
        const store = useChatStore.getState()
        for (const entry of entries) {
          store.setScheduledWakeup(entry.wakeup.tool_call_id, {
            ...entry.wakeup,
            status: 'pending',
          })
        }
      })
      .catch(err => {
        console.error('[useStreamingEvents] list_pending_wakeups failed:', err)
      })

    // Sync sending state across clients (web <-> native)
    const unlistenSending = listen<{
      session_id: string
      worktree_id: string
      user_message: string
    }>('chat:sending', event => {
      const { session_id, worktree_id: wtId, user_message } = event.payload
      // Check if THIS client initiated the send (sender calls addSendingSession
      // before sendMessage.mutate, so it's already in sendingSessionIds).
      const isSender = !!useChatStore.getState().sendingSessionIds[session_id]
      addSendingSession(session_id)
      // Only invalidate for non-sender clients. The sender already has correct
      // optimistic state; refetching can overwrite it with stale disk data
      // (especially on WebSocket where dispatch is concurrent).
      if (!isSender) {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(wtId),
        })
      }
      // Add the user message to the session cache so cross-client viewers
      // see it immediately. Skip if this client already has the message
      // (the sender added it via onMutate optimistic update).
      if (user_message) {
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(session_id),
          old => {
            if (!old) return old
            const lastMsg = old.messages.at(-1)
            // Skip if the last message already matches (sender's optimistic update)
            if (lastMsg?.role === 'user' && lastMsg.content === user_message) {
              return old
            }
            return {
              ...old,
              messages: [
                ...old.messages,
                {
                  id: `sending-${session_id}-${Date.now()}`,
                  session_id,
                  role: 'user' as const,
                  content: user_message,
                  timestamp: Math.floor(Date.now() / 1000),
                  tool_calls: [],
                },
              ],
            }
          }
        )
      }
    })

    // Buffer chunks and flush on animation frames to avoid per-chunk re-renders.
    // Codex app-server sends very frequent deltas; without batching, each delta
    // triggers 2 store mutations + full StreamingMessage re-render.
    let chunkBuffer: Record<string, string> = {}
    let chunkRafId: number | null = null

    function flushChunkBuffer() {
      chunkRafId = null
      for (const [sid, buffered] of Object.entries(chunkBuffer)) {
        appendStreamingContent(sid, buffered)
        addTextBlock(sid, buffered)
      }
      chunkBuffer = {}
    }

    const unlistenChunk = listen<ChunkEvent>('chat:chunk', event => {
      const { session_id, content } = event.payload
      // Ensure session is marked as sending (recovers state after reconnect/refresh)
      addSendingSession(session_id)
      // Accumulate into buffer
      chunkBuffer[session_id] = (chunkBuffer[session_id] ?? '') + content
      // Schedule flush on next animation frame (coalesces all chunks in this frame)
      if (chunkRafId === null) {
        chunkRafId = requestAnimationFrame(flushChunkBuffer)
      }
    })

    const unlistenToolUse = listen<ToolUseEvent>('chat:tool_use', event => {
      const { session_id, worktree_id, id, name, input, parent_tool_use_id } =
        event.payload
      addToolCall(session_id, { id, name, input, parent_tool_use_id })

      // Auto-switch Jean's mode when Claude enters plan mode
      if (name === 'EnterPlanMode') {
        useChatStore.getState().setExecutionMode(session_id, 'plan')
      }

      // Codex/OpenCode request_user_input turns can pause mid-run without
      // emitting chat:done. Surface unread/waiting state immediately when the
      // app-server maps them into AskUserQuestion with an rpcId.
      if (
        name === 'AskUserQuestion' &&
        typeof input === 'object' &&
        input !== null &&
        'rpcId' in input
      ) {
        const isCurrentlyViewing = isSessionCurrentlyViewing(
          session_id,
          worktree_id
        )
        const { removeSendingSession, setWaitingForInput } =
          useChatStore.getState()
        const wasAlreadyWaiting =
          useChatStore.getState().waitingForInputSessionIds[session_id] ?? false

        removeSendingSession(session_id)
        setWaitingForInput(session_id, true)

        let attentionUpdatedAt: number | undefined
        let lastOpenedAt: number | undefined
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(session_id),
          old => {
            if (!old) return old
            attentionUpdatedAt = getOptimisticAttentionTimestamp(old.updated_at)
            if (isCurrentlyViewing) {
              lastOpenedAt = attentionUpdatedAt
            }
            return {
              ...old,
              updated_at: attentionUpdatedAt,
              ...(lastOpenedAt !== undefined
                ? { last_opened_at: lastOpenedAt }
                : {}),
              waiting_for_input: true,
              waiting_for_input_type: 'question',
              is_reviewing: false,
            }
          }
        )
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktree_id),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(session =>
                session.id === session_id
                  ? {
                      ...session,
                      updated_at:
                        attentionUpdatedAt ??
                        getOptimisticAttentionTimestamp(session.updated_at),
                      ...(isCurrentlyViewing
                        ? {
                            last_opened_at:
                              lastOpenedAt ??
                              attentionUpdatedAt ??
                              getOptimisticAttentionTimestamp(
                                session.updated_at
                              ),
                          }
                        : {}),
                      waiting_for_input: true,
                      waiting_for_input_type: 'question',
                      is_reviewing: false,
                    }
                  : session
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktree_id, session =>
          session.id === session_id
            ? {
                ...session,
                updated_at:
                  attentionUpdatedAt ??
                  getOptimisticAttentionTimestamp(session.updated_at),
                ...(isCurrentlyViewing
                  ? {
                      last_opened_at:
                        lastOpenedAt ??
                        attentionUpdatedAt ??
                        getOptimisticAttentionTimestamp(session.updated_at),
                    }
                  : {}),
                waiting_for_input: true,
                waiting_for_input_type: 'question',
                is_reviewing: false,
              }
            : session
        )

        resolveWorktreePath(worktree_id)
          .then(worktreePath => {
            if (!worktreePath) return
            return invoke('update_session_state', {
              worktreeId: worktree_id,
              worktreePath,
              sessionId: session_id,
              waitingForInput: true,
              waitingForInputType: 'question',
              isReviewing: false,
            })
          })
          .catch(err => {
            logger.error(
              '[useStreamingEvents] Failed to persist request_user_input state:',
              err
            )
          })

        if (
          shouldPlayWaitingStateTransitionSound({
            wasWaitingForInput: wasAlreadyWaiting,
          })
        ) {
          playNotificationSound(getWaitingSoundPreference(queryClient))
        }
      }
    })

    const unlistenToolBlock = listen<ToolBlockEvent>(
      'chat:tool_block',
      event => {
        const { session_id, tool_call_id } = event.payload
        addToolBlock(session_id, tool_call_id)
      }
    )

    // Handle thinking content blocks (extended thinking)
    const unlistenThinking = listen<ThinkingEvent>('chat:thinking', event => {
      const { session_id, content } = event.payload
      appendThinkingBlock(session_id, content)
    })

    // Handle tool result events (tool execution output)
    const unlistenToolResult = listen<ToolResultEvent>(
      'chat:tool_result',
      event => {
        const { session_id, tool_use_id, output } = event.payload

        // Check if this tool was in pending denials - if so, it ran anyway
        // (e.g., yolo mode, or tool was pre-approved via allowedTools)
        const { pendingPermissionDenials, setPendingDenials, activeToolCalls } =
          useChatStore.getState()
        const denials = pendingPermissionDenials[session_id]
        if (denials?.some(d => d.tool_use_id === tool_use_id)) {
          // Remove this tool from pending denials since it already ran
          const remainingDenials = denials.filter(
            d => d.tool_use_id !== tool_use_id
          )
          setPendingDenials(session_id, remainingDenials)
        }

        // Look up the tool call to get its name
        const toolCalls = activeToolCalls[session_id] ?? []
        const toolCall = toolCalls.find(tc => tc.id === tool_use_id)

        // For question tools, don't overwrite — we store JSON-encoded answer data
        // in the output at answer time (see useMessageHandlers handleQuestionAnswer)
        if (toolCall?.name === 'question' && toolCall?.output) return

        // For Monitor, notifications stream through chat:tool_event into
        // `events`. Writing .output here would render the same text again
        // in both the "Final output" block and the outer raw-output panel.
        if (toolCall?.name === 'Monitor') return
        // For Read tools, store empty placeholder instead of full content (can be large)
        updateToolCallOutput(
          session_id,
          tool_use_id,
          toolCall?.name === 'Read' ? '' : output
        )
      }
    )

    // Handle live tool events (Monitor notifications, status changes, etc.)
    const unlistenToolEvent = listen<ToolEventEvent>(
      'chat:tool_event',
      event => {
        const { session_id, tool_use_id, kind, payload, ts_ms } = event.payload
        appendToolEvent(session_id, tool_use_id, {
          kind,
          payload,
          ts_ms,
        })
      }
    )

    // Handle permission denied events (tools that require approval)
    const unlistenPermissionDenied = listen<PermissionDeniedEvent>(
      'chat:permission_denied',
      event => {
        const { session_id, worktree_id, denials } = event.payload
        const isCurrentlyViewing = isSessionCurrentlyViewing(
          session_id,
          worktree_id
        )
        const {
          pendingPermissionDenials,
          setPendingDenials,
          lastSentMessages,
          setDeniedMessageContext,
          executionModes,
          thinkingLevels,
          selectedModels,
          removeSendingSession,
          setWaitingForInput,
        } = useChatStore.getState()
        const currentDenials = pendingPermissionDenials[session_id]
        const isCodexApproval = denials.some(denial => denial.rpc_id != null)
        const currentExecutionMode = executionModes[session_id] ?? 'plan'

        // If the session is already in yolo, keep the current turn flowing by
        // auto-accepting Codex approval callbacks instead of surfacing UI again.
        if (isCodexApproval && currentExecutionMode === 'yolo') {
          for (const denial of denials) {
            if (denial.rpc_id != null) {
              invoke('approve_codex_command', {
                sessionId: session_id,
                rpcId: denial.rpc_id,
                decision: 'accept',
              }).catch(err => {
                logger.error(
                  '[useStreamingEvents] Failed to auto-approve Codex command in yolo mode:',
                  err
                )
              })
            }
          }
          setPendingDenials(session_id, [])
          return
        }

        const mergedDenials = mergePermissionDenials(currentDenials, denials)

        // Store the denials for the approval UI
        setPendingDenials(session_id, mergedDenials)

        if (
          shouldPlayPermissionApprovalSound(currentDenials, denials) &&
          shouldPlayWaitingStateTransitionSound({
            previousPermissionDenialCount: currentDenials?.length ?? 0,
            nextPermissionDenialCount: mergedDenials.length,
            previousCodexMcpElicitationCount:
              useChatStore.getState().pendingCodexMcpElicitations[session_id]
                ?.length ?? 0,
          })
        ) {
          playNotificationSound(getWaitingSoundPreference(queryClient))
        }

        // Codex keeps the turn open while waiting for approval, so surface the
        // approval UI by pausing the local "sending" state until the user acts.
        if (isCodexApproval) {
          removeSendingSession(session_id)
          setWaitingForInput(session_id, true)
        }

        // Store the message context for re-send
        const originalMessage = lastSentMessages[session_id]
        const persistedDeniedMessageContext = originalMessage
          ? {
              message: originalMessage,
              model: selectedModels[session_id],
              thinking_level: thinkingLevels[session_id] ?? 'off',
            }
          : null
        if (originalMessage) {
          setDeniedMessageContext(session_id, {
            message: originalMessage,
            model: selectedModels[session_id],
            executionMode: executionModes[session_id] ?? 'plan',
            thinkingLevel: thinkingLevels[session_id] ?? 'off',
          })
        }

        let attentionUpdatedAt: number | undefined
        let lastOpenedAt: number | undefined
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(session_id),
          old => {
            if (!old) return old
            attentionUpdatedAt = getOptimisticAttentionTimestamp(old.updated_at)
            if (isCurrentlyViewing) {
              lastOpenedAt = attentionUpdatedAt
            }
            return applyPermissionWaitingState(old, mergedDenials, {
              updatedAt: attentionUpdatedAt,
              lastOpenedAt,
            })
          }
        )
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktree_id),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(session =>
                session.id === session_id
                  ? applyPermissionWaitingState(session, mergedDenials, {
                      updatedAt:
                        attentionUpdatedAt ??
                        getOptimisticAttentionTimestamp(session.updated_at),
                      lastOpenedAt: isCurrentlyViewing
                        ? (attentionUpdatedAt ??
                          getOptimisticAttentionTimestamp(session.updated_at))
                        : undefined,
                    })
                  : session
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktree_id, session =>
          session.id === session_id
            ? applyPermissionWaitingState(session, mergedDenials, {
                updatedAt:
                  attentionUpdatedAt ??
                  getOptimisticAttentionTimestamp(session.updated_at),
                lastOpenedAt: isCurrentlyViewing
                  ? (attentionUpdatedAt ??
                    getOptimisticAttentionTimestamp(session.updated_at))
                  : undefined,
              })
            : session
        )

        if (isCurrentlyViewing) {
          invoke('set_session_last_opened', { sessionId: session_id })
            .then(() => window.dispatchEvent(new CustomEvent('session-opened')))
            .catch(() => undefined)
        }

        resolveWorktreePath(worktree_id)
          .then(worktreePath => {
            if (!worktreePath) return
            return invoke('update_session_state', {
              worktreeId: worktree_id,
              worktreePath,
              sessionId: session_id,
              pendingPermissionDenials: mergedDenials,
              deniedMessageContext: persistedDeniedMessageContext,
              waitingForInput: true,
              waitingForInputType: null,
              isReviewing: false,
            })
          })
          .catch(err => {
            logger.error(
              '[useStreamingEvents] Failed to persist permission state:',
              err
            )
          })
      }
    )

    const unlistenCodexMcpElicitation = listen<CodexMcpElicitationEvent>(
      'chat:codex_mcp_elicitation_request',
      event => {
        const { session_id, worktree_id, elicitation } = event.payload
        const isCurrentlyViewing = isSessionCurrentlyViewing(
          session_id,
          worktree_id
        )
        const {
          pendingCodexMcpElicitations,
          setPendingCodexMcpElicitations,
          removeSendingSession,
          setWaitingForInput,
        } = useChatStore.getState()

        const mergedElicitations = mergeCodexMcpElicitations(
          pendingCodexMcpElicitations[session_id],
          [elicitation]
        )
        const currentElicitations = pendingCodexMcpElicitations[session_id]

        setPendingCodexMcpElicitations(session_id, mergedElicitations)
        removeSendingSession(session_id)
        setWaitingForInput(session_id, true)

        if (
          shouldPlayCodexMcpElicitationSound(currentElicitations, [elicitation])
        ) {
          playNotificationSound(getWaitingSoundPreference(queryClient))
        }

        let attentionUpdatedAt: number | undefined
        let lastOpenedAt: number | undefined
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(session_id),
          old => {
            if (!old) return old
            attentionUpdatedAt = getOptimisticAttentionTimestamp(old.updated_at)
            if (isCurrentlyViewing) {
              lastOpenedAt = attentionUpdatedAt
            }
            return applyCodexMcpElicitationWaitingState(
              old,
              mergedElicitations,
              {
                updatedAt: attentionUpdatedAt,
                lastOpenedAt,
              }
            )
          }
        )
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktree_id),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(session =>
                session.id === session_id
                  ? applyCodexMcpElicitationWaitingState(
                      session,
                      mergedElicitations,
                      {
                        updatedAt:
                          attentionUpdatedAt ??
                          getOptimisticAttentionTimestamp(session.updated_at),
                        lastOpenedAt: isCurrentlyViewing
                          ? (attentionUpdatedAt ??
                            getOptimisticAttentionTimestamp(session.updated_at))
                          : undefined,
                      }
                    )
                  : session
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktree_id, session =>
          session.id === session_id
            ? applyCodexMcpElicitationWaitingState(
                session,
                mergedElicitations,
                {
                  updatedAt:
                    attentionUpdatedAt ??
                    getOptimisticAttentionTimestamp(session.updated_at),
                  lastOpenedAt: isCurrentlyViewing
                    ? (attentionUpdatedAt ??
                      getOptimisticAttentionTimestamp(session.updated_at))
                    : undefined,
                }
              )
            : session
        )

        if (isCurrentlyViewing) {
          invoke('set_session_last_opened', { sessionId: session_id })
            .then(() => window.dispatchEvent(new CustomEvent('session-opened')))
            .catch(() => undefined)
        }

        resolveWorktreePath(worktree_id)
          .then(worktreePath => {
            if (!worktreePath) return
            return invoke('update_session_state', {
              worktreeId: worktree_id,
              worktreePath,
              sessionId: session_id,
              pendingCodexMcpElicitations: mergedElicitations,
              waitingForInput: true,
              waitingForInputType: null,
              isReviewing: false,
            })
          })
          .catch(err => {
            logger.error(
              '[useStreamingEvents] Failed to persist Codex MCP elicitation state:',
              err
            )
          })
      }
    )

    const unlistenDone = listen<DoneEvent>('chat:done', event => {
      const sessionId = event.payload.session_id
      const worktreeId = event.payload.worktree_id

      // Flush any buffered chunks so streamingContents is up to date
      if (chunkRafId !== null) {
        cancelAnimationFrame(chunkRafId)
        flushChunkBuffer()
      }

      const {
        streamingContents,
        activeToolCalls,
        streamingContentBlocks,
        pendingPermissionDenials,
        pendingCodexMcpElicitations,
        waitingForInputSessionIds,
        setError,
        clearLastSentMessage,
        isQuestionAnswered,
        completeSession,
        pauseSession,
        markSessionNeedsDigest,
      } = useChatStore.getState()

      // Check if this session is currently being viewed
      // Only skip digest if BOTH the worktree AND session are active (user is looking at it)
      const isCurrentlyViewing = isSessionCurrentlyViewing(
        sessionId,
        worktreeId
      )

      // If user is currently viewing this session, bump last_opened_at so it
      // doesn't appear as "unread" (updated_at will be newer after the run ends).
      // Also auto-mark user-initiated sessions (e.g. Clear Context & YOLO) as opened.
      const { userInitiatedSessionIds, removeUserInitiatedSession } =
        useChatStore.getState()
      const isUserInitiated = !!userInitiatedSessionIds[sessionId]
      if (isCurrentlyViewing || isUserInitiated) {
        if (isUserInitiated) removeUserInitiatedSession(sessionId)
        invoke('set_session_last_opened', { sessionId })
          .then(() => window.dispatchEvent(new CustomEvent('session-opened')))
          .catch(() => undefined)
      }

      // Check if session recap is enabled in preferences
      const preferences = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const sessionRecapEnabled = preferences?.session_recap_enabled ?? false

      // Only generate digest if status is CHANGING to review (not already reviewing)
      // This prevents generating digests for all restored sessions on app startup
      const wasAlreadyReviewing =
        useChatStore.getState().reviewingSessions[sessionId] ?? false

      if (
        !isCurrentlyViewing &&
        !isUserInitiated &&
        sessionRecapEnabled &&
        !wasAlreadyReviewing
      ) {
        // Mark for digest and generate it in the background immediately
        markSessionNeedsDigest(sessionId)

        // Generate digest in background (fire and forget)
        invoke<SessionDigest>('generate_session_digest', { sessionId })
          .then(digest => {
            useChatStore.getState().setSessionDigest(sessionId, digest)
            // Persist digest to disk so it survives app reload
            invoke('update_session_digest', { sessionId, digest }).catch(
              err => {
                logger.error(
                  '[useStreamingEvents] Failed to persist digest:',
                  err
                )
              }
            )
          })
          .catch(err => {
            logger.error('[useStreamingEvents] Failed to generate digest:', err)
          })
      }

      // Capture streaming state to local variables BEFORE clearing
      // This ensures we have the data for the optimistic message
      const content = streamingContents[sessionId]
      const toolCalls = activeToolCalls[sessionId]
      const contentBlocks = streamingContentBlocks[sessionId]

      if (!content && !toolCalls?.length) {
        console.warn(
          `[chat:done] No streaming content for session=${sessionId}. ` +
            `Optimistic message will be empty; messages will load from JSONL on refetch.`
        )
      }

      // Codex has no native plan approval flow — skip synthetic ExitPlanMode injection.
      // Codex plan completions fall through to the "no blocking tools" path → status = "review".
      const effectiveToolCalls = toolCalls
      const effectiveContentBlocks = contentBlocks

      // Check for unanswered blocking tools BEFORE clearing state
      // This determines whether to show "waiting" status in the UI
      const hasUnansweredBlockingTool = effectiveToolCalls?.some(
        tc =>
          (isAskUserQuestion(tc) || isExitPlanMode(tc)) &&
          !isQuestionAnswered(sessionId, tc.id)
      )
      const persistedPermissionDenials =
        pendingPermissionDenials[sessionId] ?? []
      const hasPendingPermissionDenials = persistedPermissionDenials.length > 0
      const persistedCodexMcpElicitations =
        pendingCodexMcpElicitations[sessionId] ?? []
      const hasPendingCodexMcpElicitations =
        persistedCodexMcpElicitations.length > 0
      const wasAlreadyWaiting = waitingForInputSessionIds[sessionId] ?? false

      // Clear compacting state (safety net in case chat:compacted was missed)
      useChatStore.getState().setCompacting(sessionId, false)

      // CRITICAL: Clear streaming/sending state BEFORE adding optimistic message
      // This prevents double-render where both StreamingMessage and persisted message show
      // React Query's setQueryData triggers subscribers immediately, so isSending must be
      // false before the new message appears in the cache
      setError(sessionId, null)
      clearLastSentMessage(sessionId)
      useChatStore.getState().clearLastSentAttachments(sessionId)

      // Track disk persistence promise so invalidateQueries waits for it.
      // Without this, stale data is refetched before the write completes,
      // causing waiting↔review oscillation via useSessionStatePersistence.
      let persistencePromise: Promise<unknown> | null = null

      if (hasUnansweredBlockingTool) {
        // Check if there are queued messages AND only ExitPlanMode is blocking (not AskUserQuestion)
        const { messageQueues } = useChatStore.getState()
        const hasQueuedMessages = (messageQueues[sessionId]?.length ?? 0) > 0
        const isOnlyExitPlanMode =
          effectiveToolCalls?.every(
            tc => !isAskUserQuestion(tc) || isQuestionAnswered(sessionId, tc.id)
          ) &&
          effectiveToolCalls?.some(
            tc => isExitPlanMode(tc) && !isQuestionAnswered(sessionId, tc.id)
          )

        // Add optimistic assistant message BEFORE clearing streaming state.
        // This ensures the plan/question is visible in MessageList
        // before StreamingMessage unmounts (isSending becomes false).
        if (content || (effectiveToolCalls && effectiveToolCalls.length > 0)) {
          const pendingIdKey = `__pendingMessageId_${sessionId}`
          const preGeneratedId = (window as unknown as Record<string, string>)[
            pendingIdKey
          ]
          const messageId = preGeneratedId ?? generateId()
          if (preGeneratedId) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete (window as unknown as Record<string, string>)[pendingIdKey]
          }
          // Store the ID for downstream use (plan message persistence)
          ;(window as unknown as Record<string, string>)[pendingIdKey] =
            messageId

          queryClient.setQueryData<Session>(
            chatQueryKeys.session(sessionId),
            old => {
              if (!old) return old
              return {
                ...old,
                messages: upsertAssistantMessage(old.messages, {
                  id: messageId,
                  session_id: sessionId,
                  role: 'assistant' as const,
                  content: content ?? '',
                  timestamp: Math.floor(Date.now() / 1000),
                  tool_calls: effectiveToolCalls ?? [],
                  content_blocks: effectiveContentBlocks ?? [],
                }),
              }
            }
          )
        }

        if (hasQueuedMessages && isOnlyExitPlanMode) {
          // Queued message takes priority over plan approval
          // Clear tool calls so approval UI doesn't show, let queue processor handle the queued message
          // Don't set waitingForInput(true) - this allows queue processor to send the queued message
          // Use completeSession to batch-clear (reviewing=true is fine, queue processor will override)
          completeSession(sessionId)
        } else {
          // Original behavior: show blocking tool UI and wait for user input
          // Keep tool calls and content blocks so UI shows question/plan
          // Batch-clear text content, executing mode, sending — set waiting state
          pauseSession(sessionId)

          // Determine waiting type: question or plan
          const hasUnansweredQuestion = effectiveToolCalls?.some(
            tc => isAskUserQuestion(tc) && !isQuestionAnswered(sessionId, tc.id)
          )
          const hasUnansweredPlan = effectiveToolCalls?.some(
            tc => isExitPlanMode(tc) && !isQuestionAnswered(sessionId, tc.id)
          )
          // Questions take priority over plans for the type indicator
          const waitingType: 'question' | 'plan' | null = hasUnansweredQuestion
            ? 'question'
            : hasUnansweredPlan
              ? 'plan'
              : null
          let pendingBlockingPlanMessageId: string | null = null

          // Persist plan file path and pending message ID for ExitPlanMode
          if (effectiveToolCalls) {
            const planPath = findPlanFilePath(effectiveToolCalls)
            if (planPath) {
              useChatStore.getState().setPlanFilePath(sessionId, planPath)
            }

            // Check if there's an ExitPlanMode tool call - if so, use the message ID
            // from the optimistic message (already added above) and persist it
            const hasExitPlanModeCall = effectiveToolCalls.some(tc =>
              isExitPlanMode(tc)
            )
            if (hasExitPlanModeCall) {
              const pendingIdKey = `__pendingMessageId_${sessionId}`
              const pendingMessageId =
                (window as unknown as Record<string, string>)[pendingIdKey] ??
                generateId()
              pendingBlockingPlanMessageId = pendingMessageId
              useChatStore
                .getState()
                .setPendingPlanMessageId(sessionId, pendingMessageId)

              // Persist to disk BEFORE invalidateQueries (prevent stale refetch)
              const { worktreePaths } = useChatStore.getState()
              const wtPath = worktreePaths[worktreeId]
              if (wtPath) {
                persistencePromise = invoke('update_session_state', {
                  worktreeId,
                  worktreePath: wtPath,
                  sessionId,
                  planFilePath: planPath ?? undefined,
                  pendingPlanMessageId: pendingMessageId,
                  waitingForInput: true,
                  waitingForInputType: waitingType,
                }).catch(err => {
                  logger.error(
                    '[useStreamingEvents] Failed to persist plan state:',
                    err
                  )
                })
              }
            } else if (waitingType === 'question') {
              // Persist to disk BEFORE invalidateQueries (prevent stale refetch)
              const { worktreePaths } = useChatStore.getState()
              const wtPath = worktreePaths[worktreeId]
              if (wtPath) {
                persistencePromise = invoke('update_session_state', {
                  worktreeId,
                  worktreePath: wtPath,
                  sessionId,
                  waitingForInput: true,
                  waitingForInputType: waitingType,
                }).catch(err => {
                  logger.error(
                    '[useStreamingEvents] Failed to persist question state:',
                    err
                  )
                })
              }
            }
          }

          queryClient.setQueryData<Session>(
            chatQueryKeys.session(sessionId),
            old =>
              old
                ? {
                    ...old,
                    last_run_status: 'resumable',
                    waiting_for_input: true,
                    waiting_for_input_type: waitingType,
                    is_reviewing: false,
                    pending_plan_message_id:
                      waitingType === 'plan'
                        ? (pendingBlockingPlanMessageId ?? undefined)
                        : undefined,
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
                        last_run_status: 'resumable' as const,
                        waiting_for_input: true,
                        waiting_for_input_type: waitingType,
                        is_reviewing: false,
                        pending_plan_message_id:
                          waitingType === 'plan'
                            ? (pendingBlockingPlanMessageId ?? undefined)
                            : undefined,
                      }
                    : session
                ),
              }
            }
          )
          updateAllSessionsCache(queryClient, worktreeId, session =>
            session.id === sessionId
              ? {
                  ...session,
                  last_run_status: 'resumable' as const,
                  waiting_for_input: true,
                  waiting_for_input_type: waitingType,
                  is_reviewing: false,
                  pending_plan_message_id:
                    waitingType === 'plan'
                      ? (pendingBlockingPlanMessageId ?? undefined)
                      : undefined,
                }
              : session
          )

          if (
            shouldPlayWaitingStateTransitionSound({
              wasWaitingForInput: wasAlreadyWaiting,
            })
          ) {
            playNotificationSound(getWaitingSoundPreference(queryClient))
          }
        }
      } else if (hasPendingPermissionDenials) {
        pauseSession(sessionId)

        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old =>
            old
              ? {
                  ...applyPermissionWaitingState(
                    old,
                    persistedPermissionDenials
                  ),
                  last_run_status: 'resumable',
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
                      ...applyPermissionWaitingState(
                        session,
                        persistedPermissionDenials
                      ),
                      last_run_status: 'resumable' as const,
                    }
                  : session
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktreeId, session =>
          session.id === sessionId
            ? {
                ...applyPermissionWaitingState(
                  session,
                  persistedPermissionDenials
                ),
                last_run_status: 'resumable' as const,
              }
            : session
        )

        const { worktreePaths } = useChatStore.getState()
        const wtPath = worktreePaths[worktreeId]
        if (wtPath) {
          persistencePromise = invoke('update_session_state', {
            worktreeId,
            worktreePath: wtPath,
            sessionId,
            pendingPermissionDenials: persistedPermissionDenials,
            waitingForInput: true,
            waitingForInputType: null,
            isReviewing: false,
          }).catch(err =>
            logger.error(
              '[useStreamingEvents] Failed to persist permission waiting state:',
              err
            )
          )
        }
        if (
          shouldPlayWaitingStateTransitionSound({
            wasWaitingForInput: wasAlreadyWaiting,
            previousPermissionDenialCount: persistedPermissionDenials.length,
            nextPermissionDenialCount: persistedPermissionDenials.length,
            previousCodexMcpElicitationCount:
              persistedCodexMcpElicitations.length,
          })
        ) {
          playNotificationSound(getWaitingSoundPreference(queryClient))
        }
      } else if (hasPendingCodexMcpElicitations) {
        pauseSession(sessionId)

        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old =>
            old
              ? {
                  ...applyCodexMcpElicitationWaitingState(
                    old,
                    persistedCodexMcpElicitations
                  ),
                  last_run_status: 'resumable',
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
                      ...applyCodexMcpElicitationWaitingState(
                        session,
                        persistedCodexMcpElicitations
                      ),
                      last_run_status: 'resumable' as const,
                    }
                  : session
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktreeId, session =>
          session.id === sessionId
            ? {
                ...applyCodexMcpElicitationWaitingState(
                  session,
                  persistedCodexMcpElicitations
                ),
                last_run_status: 'resumable' as const,
              }
            : session
        )

        const { worktreePaths } = useChatStore.getState()
        const wtPath = worktreePaths[worktreeId]
        if (wtPath) {
          persistencePromise = invoke('update_session_state', {
            worktreeId,
            worktreePath: wtPath,
            sessionId,
            pendingCodexMcpElicitations: persistedCodexMcpElicitations,
            waitingForInput: true,
            waitingForInputType: null,
            isReviewing: false,
          }).catch(err =>
            logger.error(
              '[useStreamingEvents] Failed to persist Codex MCP elicitation waiting state:',
              err
            )
          )
        }
        if (
          shouldPlayWaitingStateTransitionSound({
            wasWaitingForInput: wasAlreadyWaiting,
            previousPermissionDenialCount: persistedPermissionDenials.length,
            previousCodexMcpElicitationCount:
              persistedCodexMcpElicitations.length,
            nextCodexMcpElicitationCount: persistedCodexMcpElicitations.length,
          })
        ) {
          playNotificationSound(getWaitingSoundPreference(queryClient))
        }
      } else if (event.payload.waiting_for_plan && !isCurrentlyViewing) {
        // Codex/Opencode plan-mode run completed with content — enter plan-waiting state.
        // The backend signals this via the waiting_for_plan field in chat:done.
        // Skip if user is currently viewing this session — go straight to review instead.

        // 1. Add optimistic assistant message to cache
        let planMessageId: string | undefined
        if (content || (effectiveToolCalls && effectiveToolCalls.length > 0)) {
          const pendingIdKey = `__pendingMessageId_${sessionId}`
          const preGeneratedId = (window as unknown as Record<string, string>)[
            pendingIdKey
          ]
          planMessageId = preGeneratedId ?? generateId()
          if (preGeneratedId) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete (window as unknown as Record<string, string>)[pendingIdKey]
          }

          queryClient.setQueryData<Session>(
            chatQueryKeys.session(sessionId),
            old => {
              if (!old) return old
              return {
                ...old,
                messages: upsertAssistantMessage(old.messages, {
                  id: planMessageId as string,
                  session_id: sessionId,
                  role: 'assistant' as const,
                  content: content ?? '',
                  timestamp: Math.floor(Date.now() / 1000),
                  tool_calls: effectiveToolCalls ?? [],
                  content_blocks: effectiveContentBlocks ?? [],
                }),
              }
            }
          )
        }

        // 2. Update caches with plan-waiting state
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old =>
            old
              ? {
                  ...old,
                  last_run_status: 'completed',
                  waiting_for_input: true,
                  waiting_for_input_type: 'plan' as const,
                  is_reviewing: false,
                  pending_plan_message_id: planMessageId,
                }
              : old
        )
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktreeId),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(s =>
                s.id === sessionId
                  ? {
                      ...s,
                      last_run_status: 'completed' as const,
                      waiting_for_input: true,
                      waiting_for_input_type: 'plan' as const,
                      is_reviewing: false,
                      pending_plan_message_id: planMessageId,
                    }
                  : s
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktreeId, session =>
          session.id === sessionId
            ? {
                ...session,
                last_run_status: 'completed' as const,
                waiting_for_input: true,
                waiting_for_input_type: 'plan' as const,
                is_reviewing: false,
                pending_plan_message_id: planMessageId,
              }
            : session
        )

        // 3. Transition to waiting state in Zustand
        pauseSession(sessionId)
        if (planMessageId) {
          useChatStore
            .getState()
            .setPendingPlanMessageId(sessionId, planMessageId)
        }

        // 4. Persist to disk BEFORE invalidating queries
        const { worktreePaths: wtPaths2 } = useChatStore.getState()
        const wtPath2 = wtPaths2[worktreeId]
        if (wtPath2) {
          persistencePromise = invoke('update_session_state', {
            worktreeId,
            worktreePath: wtPath2,
            sessionId,
            isReviewing: false,
            waitingForInput: true,
            waitingForInputType: 'plan',
            pendingPlanMessageId: planMessageId ?? null,
          }).catch(err =>
            logger.error(
              '[useStreamingEvents] Failed to persist plan-waiting state:',
              err
            )
          )
        }

        if (
          shouldPlayWaitingStateTransitionSound({
            wasWaitingForInput: wasAlreadyWaiting,
          })
        ) {
          playNotificationSound(getWaitingSoundPreference(queryClient))
        }
      } else {
        // No blocking tools — add optimistic message FIRST, then batch-clear state.
        // This eliminates the flicker gap where neither streaming nor persisted content is visible.
        // The optimistic message lands in TanStack Query cache BEFORE isSending flips to false,
        // so MessageList already has the message when StreamingMessage unmounts.

        // 1. Add optimistic assistant message to cache
        if (content || (effectiveToolCalls && effectiveToolCalls.length > 0)) {
          const pendingIdKey = `__pendingMessageId_${sessionId}`
          const preGeneratedId = (window as unknown as Record<string, string>)[
            pendingIdKey
          ]
          const messageId = preGeneratedId ?? generateId()
          if (preGeneratedId) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete (window as unknown as Record<string, string>)[pendingIdKey]
          }

          queryClient.setQueryData<Session>(
            chatQueryKeys.session(sessionId),
            old => {
              if (!old) {
                console.warn(
                  `[chat:done] Session ${sessionId} not in cache — optimistic assistant message skipped. Will recover from JSONL on next fetch.`
                )
                return old
              }
              return {
                ...old,
                messages: upsertAssistantMessage(old.messages, {
                  id: messageId,
                  session_id: sessionId,
                  role: 'assistant' as const,
                  content: content ?? '',
                  timestamp: Math.floor(Date.now() / 1000),
                  tool_calls: effectiveToolCalls ?? [],
                  content_blocks: effectiveContentBlocks ?? [],
                }),
              }
            }
          )
        }

        // 2. Update last_run_status + session state in caches so UI reflects immediately.
        // CRITICAL: Include waiting_for_input/is_reviewing so useSessionStatePersistence's
        // load effect doesn't overwrite Zustand with stale cache values.
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old =>
            old
              ? {
                  ...old,
                  last_run_status: 'completed',
                  waiting_for_input: false,
                  waiting_for_input_type: null,
                  is_reviewing: true,
                  pending_plan_message_id: undefined,
                }
              : old
        )
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktreeId),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(s =>
                s.id === sessionId
                  ? {
                      ...s,
                      last_run_status: 'completed' as const,
                      waiting_for_input: false,
                      waiting_for_input_type: null,
                      is_reviewing: true,
                      pending_plan_message_id: undefined,
                    }
                  : s
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktreeId, session =>
          session.id === sessionId
            ? {
                ...session,
                last_run_status: 'completed' as const,
                waiting_for_input: false,
                waiting_for_input_type: null,
                is_reviewing: true,
                pending_plan_message_id: undefined,
              }
            : session
        )

        // 3. Batch-clear all streaming state in a single Zustand set() — one notification to subscribers
        completeSession(sessionId)

        // Persist reviewing state to disk BEFORE invalidating queries.
        // Without this, invalidateQueries can refetch stale is_reviewing: false
        // and useSessionStatePersistence overwrites Zustand, causing idle↔review oscillation.
        const { worktreePaths: wtPaths } = useChatStore.getState()
        const wtPath = wtPaths[worktreeId]
        if (wtPath) {
          persistencePromise = invoke('update_session_state', {
            worktreeId,
            worktreePath: wtPath,
            sessionId,
            isReviewing: true,
            waitingForInput: false,
          }).catch(err =>
            logger.error(
              '[useStreamingEvents] Failed to persist reviewing state:',
              err
            )
          )
        }

        playNotificationSound(getReviewSoundPreference(queryClient))
      }

      // Update last_run_status + waiting state for sessions with blocking tools.
      // CRITICAL: Include waiting_for_input so useSessionStatePersistence's load effect
      // doesn't overwrite Zustand with stale cache values when setQueryData triggers re-render.
      if (hasUnansweredBlockingTool) {
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old =>
            old
              ? {
                  ...old,
                  last_run_status: 'resumable',
                  waiting_for_input: true,
                }
              : old
        )
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktreeId),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(s =>
                s.id === sessionId
                  ? {
                      ...s,
                      last_run_status: 'resumable' as const,
                      waiting_for_input: true,
                    }
                  : s
              ),
            }
          }
        )
        updateAllSessionsCache(queryClient, worktreeId, session =>
          session.id === sessionId
            ? {
                ...session,
                last_run_status: 'resumable' as const,
                waiting_for_input: true,
              }
            : session
        )
      }

      // Detect PR_CREATED marker and save PR info (async, after main flow)
      // Format: PR_CREATED: #<number> <url>
      if (content) {
        const prMatch = content.match(
          /PR_CREATED:\s*#(\d+)\s+(https?:\/\/\S+)/i
        )
        const prNumberStr = prMatch?.[1]
        const prUrl = prMatch?.[2]
        if (prNumberStr && prUrl) {
          const prNumber = parseInt(prNumberStr, 10)
          // Save PR info to worktree (async, fire and forget)
          saveWorktreePr(worktreeId, prNumber, prUrl)
            .then(() => {
              // Invalidate worktree query to refresh PR link in UI
              queryClient.invalidateQueries({
                queryKey: [...projectsQueryKeys.all, 'worktree', worktreeId],
              })
            })
            .catch(err => {
              logger.error('[ChatWindow] Failed to save PR info:', err)
            })
        }
      }

      // Trigger git status poll after prompt completes (Claude may have made changes)
      triggerImmediateGitPoll().catch(err =>
        logger.error('[ChatWindow] Failed to trigger git poll:', err)
      )

      // Invalidate sessions list to update metadata.
      // Wait for disk persistence (if any) to complete first — otherwise
      // invalidateQueries refetches stale data and useSessionStatePersistence
      // overwrites Zustand, causing waiting↔review oscillation.
      const invalidateSessions = () => {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })
        queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
        invalidateUnreadQueries(queryClient)
        // Invalidate individual session so cross-client viewers get the
        // complete conversation (user message + assistant response).
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.session(sessionId),
        })
      }

      if (persistencePromise) {
        persistencePromise.finally(invalidateSessions)
      } else {
        invalidateSessions()
      }
    })

    // Handle errors from Claude CLI
    const unlistenError = listen<ErrorEvent>('chat:error', event => {
      const { session_id, error } = event.payload

      // Store error for inline display and restore input
      const {
        lastSentMessages,
        setInputDraft,
        clearLastSentMessage,
        setError,
        activeWorktreeId,
        activeSessionIds,
        markSessionNeedsDigest,
      } = useChatStore.getState()

      // Check if this session is currently being viewed
      // Look up the worktree from sessionWorktreeMap since ErrorEvent may not have it
      const sessionWorktreeId =
        useChatStore.getState().sessionWorktreeMap[session_id]
      const isActiveWorktree = sessionWorktreeId === activeWorktreeId
      const isActiveSession = sessionWorktreeId
        ? activeSessionIds[sessionWorktreeId] === session_id
        : false
      const isViewingInFullView = isActiveWorktree && isActiveSession

      // Also check if viewing in modal (modal doesn't change activeWorktreeId)
      const { sessionChatModalOpen, sessionChatModalWorktreeId } =
        useUIStore.getState()
      const isViewingInModal =
        sessionChatModalOpen &&
        sessionChatModalWorktreeId === sessionWorktreeId &&
        isActiveSession

      const isCurrentlyViewing = isViewingInFullView || isViewingInModal

      // If user is currently viewing this session, bump last_opened_at so it
      // doesn't appear as "unread" (updated_at will be newer after the run ends).
      // Also auto-mark user-initiated sessions (e.g. Clear Context & YOLO) as opened.
      const {
        userInitiatedSessionIds: uisErr,
        removeUserInitiatedSession: rusErr,
      } = useChatStore.getState()
      const isUserInitiatedErr = !!uisErr[session_id]
      if (isCurrentlyViewing || isUserInitiatedErr) {
        if (isUserInitiatedErr) rusErr(session_id)
        invoke('set_session_last_opened', { sessionId: session_id })
          .then(() => window.dispatchEvent(new CustomEvent('session-opened')))
          .catch(() => undefined)
      }

      // Check if session recap is enabled in preferences
      const preferences = queryClient.getQueryData<AppPreferences>(
        preferencesQueryKeys.preferences()
      )
      const sessionRecapEnabled = preferences?.session_recap_enabled ?? false

      // Only generate digest if status is CHANGING to review (not already reviewing)
      const wasAlreadyReviewing =
        useChatStore.getState().reviewingSessions[session_id] ?? false

      if (
        !isCurrentlyViewing &&
        !isUserInitiatedErr &&
        sessionRecapEnabled &&
        !wasAlreadyReviewing
      ) {
        // Mark for digest and generate it in the background immediately
        markSessionNeedsDigest(session_id)

        invoke<SessionDigest>('generate_session_digest', {
          sessionId: session_id,
        })
          .then(digest => {
            useChatStore.getState().setSessionDigest(session_id, digest)
            // Persist digest to disk so it survives app reload
            invoke('update_session_digest', {
              sessionId: session_id,
              digest,
            }).catch(err => {
              logger.error(
                '[useStreamingEvents] Failed to persist digest:',
                err
              )
            })
          })
          .catch(err => {
            logger.error('[useStreamingEvents] Failed to generate digest:', err)
          })
      }

      // Set error state for inline display
      setError(session_id, error)

      // Restore the input that failed so user can retry
      const lastMessage = lastSentMessages[session_id]
      if (lastMessage) {
        setInputDraft(session_id, lastMessage)
        clearLastSentMessage(session_id)

        // Remove the optimistic user message from query cache
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(session_id),
          old => {
            if (!old?.messages?.length) return old
            // Find last user message matching the failed content
            let lastUserIdx = -1
            for (let i = old.messages.length - 1; i >= 0; i--) {
              if (
                old.messages[i]?.role === 'user' &&
                old.messages[i]?.content === lastMessage
              ) {
                lastUserIdx = i
                break
              }
            }
            if (lastUserIdx === -1) return old
            const newMessages = [...old.messages]
            newMessages.splice(lastUserIdx, 1)
            return { ...old, messages: newMessages }
          }
        )
      }

      // Restore attachments that were cleared on send
      useChatStore.getState().restoreAttachments(session_id)

      // Optimistically update last_run_status BEFORE clearing state (same pattern as chat:done)
      queryClient.setQueryData<Session>(
        chatQueryKeys.session(session_id),
        old => (old ? { ...old, last_run_status: 'crashed' as const } : old)
      )
      if (sessionWorktreeId) {
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(sessionWorktreeId),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.map(s =>
                s.id === session_id
                  ? { ...s, last_run_status: 'crashed' as const }
                  : s
              ),
            }
          }
        )
      }

      // Batch-clear all streaming state in a single Zustand set()
      useChatStore.getState().failSession(session_id)

      playNotificationSound(getWaitingSoundPreference(queryClient))

      // Invalidate sessions list to update last_run_status in tab bar
      if (sessionWorktreeId) {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(sessionWorktreeId),
        })
      }
      queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
      invalidateUnreadQueries(queryClient)
    })

    // Handle cancellation (user pressed Cmd+Option+Backspace / Ctrl+Alt+Backspace)
    // Preserves partial streaming content as an optimistic message (like chat:done)
    // Backend will also persist the partial response; mutation completion will update cache
    const unlistenCancelled = listen<CancelledEvent>(
      'chat:cancelled',
      event => {
        const {
          session_id,
          worktree_id: eventWorktreeId,
          undo_send,
          emitted_at_ms,
        } = event.payload

        // Flush any buffered chunks so streamingContents is up to date
        if (chunkRafId !== null) {
          cancelAnimationFrame(chunkRafId)
          flushChunkBuffer()
        }

        // Capture streaming state BEFORE clearing (like chat:done does)
        const {
          sendStartedAt,
          streamingContents,
          streamingThinkingContent,
          activeToolCalls,
          streamingContentBlocks,
          activeWorktreeId,
          activeSessionIds,
          markSessionNeedsDigest,
        } = useChatStore.getState()
        const sendStarted = sendStartedAt[session_id] ?? 0
        if (sendStarted > emitted_at_ms) {
          console.warn(
            `[Cancelled] Ignoring stale cancel event for session=${session_id} emitted_at_ms=${emitted_at_ms} send_started_at=${sendStarted}`
          )
          return
        }
        const content = streamingContents[session_id]
        const toolCalls = activeToolCalls[session_id]
        const contentBlocks = streamingContentBlocks[session_id]

        // Check if this session is currently being viewed
        const sessionWorktreeId =
          useChatStore.getState().sessionWorktreeMap[session_id]
        const isActiveWorktree = sessionWorktreeId === activeWorktreeId
        const isActiveSession = sessionWorktreeId
          ? activeSessionIds[sessionWorktreeId] === session_id
          : false
        const isViewingInFullView = isActiveWorktree && isActiveSession

        // Also check if viewing in modal (modal doesn't change activeWorktreeId)
        const { sessionChatModalOpen, sessionChatModalWorktreeId } =
          useUIStore.getState()
        const isViewingInModal =
          sessionChatModalOpen &&
          sessionChatModalWorktreeId === sessionWorktreeId &&
          isActiveSession

        const isCurrentlyViewing = isViewingInFullView || isViewingInModal

        // If user is currently viewing this session, bump last_opened_at so it
        // doesn't appear as "unread" (updated_at will be newer after the run ends).
        // Also auto-mark user-initiated sessions (e.g. Clear Context & YOLO) as opened.
        const {
          userInitiatedSessionIds: uisCan,
          removeUserInitiatedSession: rusCan,
        } = useChatStore.getState()
        const isUserInitiatedCan = !!uisCan[session_id]
        if (isCurrentlyViewing || isUserInitiatedCan) {
          if (isUserInitiatedCan) rusCan(session_id)
          invoke('set_session_last_opened', { sessionId: session_id })
            .then(() => window.dispatchEvent(new CustomEvent('session-opened')))
            .catch(() => undefined)
        }

        // Check if session recap is enabled in preferences
        const preferences = queryClient.getQueryData<AppPreferences>(
          preferencesQueryKeys.preferences()
        )
        const sessionRecapEnabled = preferences?.session_recap_enabled ?? false

        // Only generate digest if status is CHANGING to review (not already reviewing)
        const wasAlreadyReviewing =
          useChatStore.getState().reviewingSessions[session_id] ?? false

        if (
          !isCurrentlyViewing &&
          !isUserInitiatedCan &&
          sessionRecapEnabled &&
          !wasAlreadyReviewing
        ) {
          // Mark for digest and generate it in the background immediately
          markSessionNeedsDigest(session_id)

          invoke<SessionDigest>('generate_session_digest', {
            sessionId: session_id,
          })
            .then(digest => {
              useChatStore.getState().setSessionDigest(session_id, digest)
              // Persist digest to disk so it survives app reload
              invoke('update_session_digest', {
                sessionId: session_id,
                digest,
              }).catch(err => {
                logger.error(
                  '[useStreamingEvents] Failed to persist digest:',
                  err
                )
              })
            })
            .catch(err => {
              logger.error(
                '[useStreamingEvents] Failed to generate digest:',
                err
              )
            })
        }

        // Clear compacting state (safety net)
        useChatStore.getState().setCompacting(session_id, false)

        // Determine if we should restore message to input:
        // - undo_send from backend, OR
        // - No content streamed yet (cancelled before any response)
        // BUT: Don't restore if there are queued messages (user chose "Skip to Next")
        // Any assistant output (text, tool call, thinking, content block) counts
        // as a started response — if present, preserve it and leave input empty.
        const hasToolCalls = toolCalls && toolCalls.length > 0
        const hasText = !!content && content.trim().length > 0
        const hasThinking = !!streamingThinkingContent[session_id]
        const hasContentBlocks = !!contentBlocks && contentBlocks.length > 0
        const hasContent =
          hasToolCalls || hasText || hasThinking || hasContentBlocks
        const hasQueuedMessages =
          (useChatStore.getState().messageQueues[session_id] ?? []).length > 0
        const shouldRestoreMessage =
          !hasQueuedMessages && (undo_send || !hasContent)

        // Update TanStack Query cache FIRST (before clearing Zustand streaming state)
        // This ensures the persisted message exists before StreamingMessage unmounts

        // Optimistically update last_run_status so "restored session" indicator hides
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(session_id),
          old => (old ? { ...old, last_run_status: 'cancelled' } : old)
        )
        if (sessionWorktreeId) {
          queryClient.setQueryData<WorktreeSessions>(
            chatQueryKeys.sessions(sessionWorktreeId),
            old => {
              if (!old) return old
              return {
                ...old,
                sessions: old.sessions.map(s =>
                  s.id === session_id
                    ? { ...s, last_run_status: 'cancelled' as const }
                    : s
                ),
              }
            }
          )
        }

        if (shouldRestoreMessage) {
          // Restore message to input and optimistically undo the sent message.
          // This keeps cancel UX immediate while backend state catches up.
          const {
            lastSentMessages,
            inputDrafts,
            setInputDraft,
            clearLastSentMessage,
          } = useChatStore.getState()
          const lastMessage = lastSentMessages[session_id]
          const currentDraft = inputDrafts[session_id] ?? ''

          if (lastMessage) {
            // Only restore if input is empty (user hasn't typed new content)
            if (!currentDraft.trim()) {
              setInputDraft(session_id, lastMessage)
              // Restore any attachments that were sent with the message
              useChatStore.getState().restoreAttachments(session_id)
              toast.info('Message restored to input')
            } else {
              toast.info('Request cancelled')
              useChatStore.getState().clearLastSentAttachments(session_id)
            }
            clearLastSentMessage(session_id)

            queryClient.setQueryData<Session>(
              chatQueryKeys.session(session_id),
              old => {
                if (!old) return old
                const messages = [...old.messages]
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i]?.role === 'user') {
                    messages.splice(i, 1)
                    break
                  }
                }
                return { ...old, messages }
              }
            )
          } else {
            toast.info('Request cancelled')
            useChatStore.getState().clearLastSentAttachments(session_id)
          }
        } else {
          // Partial response exists — attachments were consumed, don't restore
          useChatStore.getState().clearLastSentAttachments(session_id)
          // Preserve partial response as optimistic message BEFORE clearing streaming state
          queryClient.setQueryData<Session>(
            chatQueryKeys.session(session_id),
            old => {
              if (!old) return old
              return {
                ...old,
                messages: upsertAssistantMessage(old.messages, {
                  id: generateId(),
                  session_id,
                  role: 'assistant' as const,
                  content: content ?? '',
                  timestamp: Math.floor(Date.now() / 1000),
                  tool_calls: toolCalls ?? [],
                  content_blocks: contentBlocks ?? [],
                  cancelled: true,
                }),
              }
            }
          )
          // Persist partial content to JSONL so it survives app reload.
          // The backend command handler may not have finished writing yet
          // (e.g., OpenCode POST still in-flight).
          invoke('save_cancelled_message', {
            sessionId: session_id,
            worktreeId: sessionWorktreeId ?? eventWorktreeId,
            worktreePath: '',
            content: content ?? '',
            toolCalls: toolCalls ?? [],
            contentBlocks: contentBlocks ?? [],
          }).catch(err =>
            logger.debug(
              '[useStreamingEvents] Failed to persist partial cancelled content:',
              err
            )
          )
          toast.info('Request cancelled')
        }

        // NOW batch-clear all streaming state in a single Zustand set()
        // This happens AFTER optimistic messages are in the cache, preventing flicker
        useChatStore.getState().cancelSession(session_id)

        playNotificationSound(getWaitingSoundPreference(queryClient))

        // For restore path: override reviewing state based on whether messages remain
        if (shouldRestoreMessage) {
          const updatedSession = queryClient.getQueryData<Session>(
            chatQueryKeys.session(session_id)
          )
          if (!updatedSession || updatedSession.messages.length === 0) {
            useChatStore.getState().setSessionReviewing(session_id, false)
          }
        }

        // Persist cancel state to disk BEFORE invalidating queries
        // This prevents a race where invalidation refetches stale waiting_for_input: true from disk
        const resolvedWorktreeId = sessionWorktreeId || eventWorktreeId
        const { worktreePaths } = useChatStore.getState()
        const wtPath = resolvedWorktreeId
          ? worktreePaths[resolvedWorktreeId]
          : null

        const invalidateSessions = () => {
          if (resolvedWorktreeId) {
            queryClient.invalidateQueries({
              queryKey: chatQueryKeys.sessions(resolvedWorktreeId),
            })
          }
          queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
          invalidateUnreadQueries(queryClient)
        }

        if (resolvedWorktreeId && wtPath) {
          // Determine final reviewing state from the branch that just ran
          const isNowReviewing = shouldRestoreMessage
            ? (queryClient.getQueryData<Session>(
                chatQueryKeys.session(session_id)
              )?.messages.length ?? 0) > 0
            : true

          invoke('update_session_state', {
            worktreeId: resolvedWorktreeId,
            worktreePath: wtPath,
            sessionId: session_id,
            waitingForInput: false,
            waitingForInputType: null,
            isReviewing: isNowReviewing,
          })
            .catch(err =>
              logger.debug(
                '[useStreamingEvents] Failed to persist cancel state:',
                err
              )
            )
            .finally(invalidateSessions)
        } else {
          invalidateSessions()
        }
      }
    )

    // Handle context compaction events
    const unlistenCompacting = listen<CompactingEvent>(
      'chat:compacting',
      event => {
        const { session_id, worktree_id } = event.payload
        const { setCompacting } = useChatStore.getState()
        setCompacting(session_id, true)
        const label = lookupSessionLabel(queryClient, session_id, worktree_id)
        toast.info(
          label ? `Compacting context: ${label}...` : 'Compacting context...'
        )
      }
    )

    const unlistenCompacted = listen<CompactedEvent>(
      'chat:compacted',
      event => {
        const { session_id, worktree_id, metadata } = event.payload
        const { setLastCompaction, setCompacting } = useChatStore.getState()
        setCompacting(session_id, false)
        setLastCompaction(session_id, metadata.trigger)

        const label = lookupSessionLabel(queryClient, session_id, worktree_id)
        const prefix = `Context ${metadata.trigger === 'auto' ? 'auto-' : ''}compacted`
        toast.info(label ? `${prefix}: ${label}` : prefix)
      }
    )

    // Handle ScheduleWakeup lifecycle events (pending/fired/cancelled) so the
    // ToolCallInline indicator can render a live countdown + status change.
    const unlistenWakeupScheduled = listen<WakeupScheduledEvent>(
      'chat:wakeup_scheduled',
      event => {
        const { wakeup } = event.payload
        useChatStore.getState().setScheduledWakeup(wakeup.tool_call_id, {
          ...wakeup,
          status: 'pending',
        })
      }
    )

    const unlistenWakeupCancelled = listen<WakeupCancelledEvent>(
      'chat:wakeup_cancelled',
      event => {
        const { tool_call_id } = event.payload
        if (!tool_call_id) return
        useChatStore
          .getState()
          .markScheduledWakeupStatus(tool_call_id, 'cancelled')
      }
    )

    // Handle ScheduleWakeup fires — the Rust scheduler emits this when a
    // persisted wakeup's fire_at_unix <= now. Enqueue the stored prompt so
    // the existing queue processor drives it through send_chat_message with
    // the session's current model/backend/execution-mode settings.
    const unlistenWakeupFired = listen<WakeupFiredEvent>(
      'chat:wakeup_fired',
      event => {
        const { session_id, worktree_id, worktree_path, prompt, tool_call_id } =
          event.payload
        const store = useChatStore.getState()
        store.markScheduledWakeupStatus(tool_call_id, 'fired')
        const model = store.selectedModels[session_id] ?? 'sonnet'
        const executionMode = store.executionModes[session_id] ?? 'yolo'
        const thinkingLevel = store.thinkingLevels[session_id] ?? 'off'
        const backend = store.selectedBackends[session_id]
        const provider = store.selectedProviders?.[session_id] ?? null
        const queuedMessage: QueuedMessage = {
          id: generateId(),
          message: prompt,
          skills: [],
          pendingImages: [],
          pendingFiles: [],
          pendingSkills: [],
          pendingTextFiles: [],
          model,
          provider,
          executionMode,
          thinkingLevel,
          backend,
          queuedAt: Date.now(),
        }
        // Ensure the queue processor can resolve worktree → path and
        // session → worktree when firing this message.
        if (worktree_id && worktree_path) {
          store.registerWorktreePath(worktree_id, worktree_path)
        }
        useChatStore.setState(s => ({
          sessionWorktreeMap: {
            ...s.sessionWorktreeMap,
            [session_id]: worktree_id,
          },
        }))
        store.enqueueMessage(session_id, queuedMessage)
        persistEnqueue(worktree_id, worktree_path, session_id, queuedMessage)
      }
    )

    // Handle session setting changes (backend, model, thinking level, execution mode)
    // Broadcast by other clients via broadcast_session_setting command
    const unlistenSettingChanged = listen<{
      session_id: string
      key: string
      value: string
    }>('session:setting-changed', event => {
      const { session_id, key, value } = event.payload
      const store = useChatStore.getState()
      switch (key as SessionSettingKey) {
        case 'backend':
          store.setSelectedBackend(
            session_id,
            value as 'claude' | 'codex' | 'opencode'
          )
          break
        case 'model':
          store.setSelectedModel(session_id, value)
          break
        case 'thinkingLevel':
          store.setThinkingLevel(
            session_id,
            value as 'off' | 'think' | 'megathink' | 'ultrathink'
          )
          break
        case 'effortLevel':
          store.setEffortLevel(
            session_id,
            value as 'low' | 'medium' | 'high' | 'max'
          )
          break
        case 'executionMode':
          store.setExecutionMode(session_id, value as 'plan' | 'build' | 'yolo')
          break
        case 'waitingForInput':
          if (value === 'false') {
            store.setWaitingForInput(session_id, false)
            store.setPendingPlanMessageId(session_id, null)
          }
          break
      }

      queryClient.setQueryData<Session>(
        chatQueryKeys.session(session_id),
        old =>
          old
            ? applySessionSettingToSession(old, key as SessionSettingKey, value)
            : old
      )
      queryClient.invalidateQueries({
        queryKey: [...chatQueryKeys.all, 'sessions'],
      })
      queryClient.invalidateQueries({
        queryKey: ['all-sessions'],
      })
      invalidateUnreadQueries(queryClient)
    })

    const unlistenThreadTokenUsage = listen<ThreadTokenUsageEvent>(
      'chat:thread_token_usage',
      event => {
        const { session_id, thread_token_usage } = event.payload
        useChatStore
          .getState()
          .setThreadTokenUsage(session_id, thread_token_usage)
      }
    )

    return () => {
      // Flush any buffered chunks before tearing down
      if (chunkRafId !== null) {
        cancelAnimationFrame(chunkRafId)
        flushChunkBuffer()
      }
      unlistenSending.then(f => f())
      unlistenChunk.then(f => f())
      unlistenToolUse.then(f => f())
      unlistenToolBlock.then(f => f())
      unlistenThinking.then(f => f())
      unlistenToolResult.then(f => f())
      unlistenToolEvent.then(f => f())
      unlistenPermissionDenied.then(f => f())
      unlistenCodexMcpElicitation.then(f => f())
      unlistenDone.then(f => f())
      unlistenError.then(f => f())
      unlistenCancelled.then(f => f())
      unlistenCompacting.then(f => f())
      unlistenCompacted.then(f => f())
      unlistenWakeupScheduled.then(f => f())
      unlistenWakeupCancelled.then(f => f())
      unlistenWakeupFired.then(f => f())
      unlistenSettingChanged.then(f => f())
      unlistenThreadTokenUsage.then(f => f())
    }
  }, [queryClient, wsConnected])
}
