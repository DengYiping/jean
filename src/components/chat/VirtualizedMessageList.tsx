import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  memo,
  useMemo,
  useCallback,
} from 'react'
import { useMessageVirtualizer } from './hooks/useMessageVirtualizer'
import type {
  ChatMessage,
  Question,
  QuestionAnswer,
  ReviewFinding,
} from '@/types/chat'
import { MessageItem } from './MessageItem'
import { getProviderChangeBeforeMessage } from './message-settings-labels'
import { ProviderChangeSeparator } from './ProviderChangeSeparator'
import { getAssistantDurationMs } from './time-utils'

export interface VirtualizedMessageListHandle {
  /** Scroll to a specific message by index */
  scrollToIndex: (
    index: number,
    options?: { align?: 'start' | 'center' | 'end' }
  ) => void
  /** Check if a message index is currently in the visible range */
  isIndexInView: (index: number) => boolean
  /** Get the current visible range */
  getVisibleRange: () => { start: number; end: number } | null
}

interface VirtualizedMessageListProps {
  hasOlderOnDisk?: boolean
  isLoadingOlder?: boolean
  onLoadOlderRuns?: () => void
  loadedRunStartIndex?: number
  /** Messages to render */
  messages: ChatMessage[]
  /** Ref to the scroll container (ScrollArea viewport) */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  /** Total number of messages */
  totalMessages: number
  /** Message ID of the currently pending plan awaiting approval */
  pendingPlanMessageId?: string | null
  /** Current session ID */
  sessionId: string
  /** Worktree path for resolving file mentions */
  worktreePath: string
  /** Keyboard shortcut for approve button */
  approveShortcut: string
  /** Keyboard shortcut for approve yolo button */
  approveShortcutYolo?: string
  /** Keyboard shortcut to display on clear context button */
  approveShortcutClearContext?: string
  /** Keyboard shortcut to display on clear context build button */
  approveShortcutClearContextBuild?: string
  /** Ref for approve button visibility tracking */
  approveButtonRef?: React.RefObject<HTMLButtonElement | null>
  /** Persisted approved plan IDs for this session */
  approvedPlanMessageIds?: ReadonlySet<string>
  /** Whether Claude is currently streaming */
  isSending: boolean
  /** Callback when user approves a plan */
  onPlanApproval: (messageId: string) => void
  /** Callback when user wants to add a custom prompt before build approval */
  onCustomBuildPrompt?: (messageId: string) => void
  /** Callback when user approves a plan with yolo mode */
  onPlanApprovalYolo?: (messageId: string) => void
  /** Callback for clear context approval (new session with plan in yolo mode) */
  onClearContextApproval?: (messageId: string) => void
  /** Callback for clear context approval (new session with plan in build mode) */
  onClearContextApprovalBuild?: (messageId: string) => void
  /** Callback for creating new worktree session with build mode */
  onWorktreeBuildApproval?: (messageId: string) => void
  /** Callback for creating new worktree session with yolo mode */
  onWorktreeYoloApproval?: (messageId: string) => void
  /** Callback when user answers a question */
  onQuestionAnswer: (
    toolCallId: string,
    answers: QuestionAnswer[],
    questions: Question[]
  ) => void
  /** Callback when user skips a question */
  onQuestionSkip: (toolCallId: string) => void
  /** Callback when user clicks a file path */
  onFileClick: (path: string) => void
  /** Callback when user fixes a finding */
  onFixFinding: (finding: ReviewFinding, suggestion?: string) => Promise<void>
  /** Callback when user fixes all findings */
  onFixAllFindings: (
    findings: { finding: ReviewFinding; suggestion?: string }[]
  ) => Promise<void>
  /** Check if a question has been answered */
  isQuestionAnswered: (sessionId: string, toolCallId: string) => boolean
  /** Get submitted answers for a question */
  getSubmittedAnswers: (
    sessionId: string,
    toolCallId: string
  ) => QuestionAnswer[] | undefined
  /** Check if questions are being skipped for this session */
  areQuestionsSkipped: (sessionId: string) => boolean
  /** Check if a finding has been fixed */
  isFindingFixed: (sessionId: string, key: string) => boolean
  /** Callback to copy a user message back to the input field */
  onCopyToInput?: (message: ChatMessage) => void
  /** Hide approve buttons (e.g. for Codex which has no native approval flow) */
  hideApproveButtons?: boolean
  /** Whether we should scroll to bottom (new message arrived while at bottom) */
  shouldScrollToBottom?: boolean
  /** Callback when scroll-to-bottom is handled */
  onScrollToBottomHandled?: () => void
  /** Duration of last completed run (ms) — shown on last assistant message */
  completedDurationMs?: number | null
}

/**
 * Measured viewport window: offscreen messages unmount in both scroll directions.
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
export const VirtualizedMessageList = memo(
  forwardRef<VirtualizedMessageListHandle, VirtualizedMessageListProps>(
    function VirtualizedMessageList(
      {
        messages,
        scrollContainerRef,
        totalMessages,
        pendingPlanMessageId,
        sessionId,
        worktreePath,
        approveShortcut,
        approveShortcutYolo,
        approveShortcutClearContext,
        approveShortcutClearContextBuild,
        approveButtonRef,
        approvedPlanMessageIds,
        isSending,
        onPlanApproval,
        onCustomBuildPrompt,
        onPlanApprovalYolo,
        onClearContextApproval,
        onClearContextApprovalBuild,
        onWorktreeBuildApproval,
        onWorktreeYoloApproval,
        onQuestionAnswer,
        onQuestionSkip,
        onFileClick,
        onFixFinding,
        onFixAllFindings,
        isQuestionAnswered,
        getSubmittedAnswers,
        areQuestionsSkipped,
        isFindingFixed,
        onCopyToInput,
        hideApproveButtons,
        shouldScrollToBottom,
        onScrollToBottomHandled,
        completedDurationMs,
        hasOlderOnDisk,
        isLoadingOlder,
        onLoadOlderRuns,
        loadedRunStartIndex,
      },
      ref
    ) {
      const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
      const messagesRef = useRef(messages)

      useEffect(() => {
        messagesRef.current = messages
      }, [messages])

      const getMessages = useCallback(() => messagesRef.current, [])

      const keys = useMemo(
        () => messages.map(message => message.id),
        [messages]
      )
      const { listRef, virtualizer, items, scrollMargin } =
        useMessageVirtualizer(keys, scrollContainerRef)

      // Pre-compute hasFollowUpMessage for all messages in O(n) instead of O(n²)
      const hasFollowUpMap = useMemo(() => {
        const map = new Map<number, boolean>()
        let foundUserMessage = false
        for (let i = messages.length - 1; i >= 0; i--) {
          map.set(i, foundUserMessage)
          if (messages[i]?.role === 'user') {
            foundUserMessage = true
          }
        }
        return map
      }, [messages])

      const providerChangeMap = useMemo(() => {
        const map = new Map<
          number,
          ReturnType<typeof getProviderChangeBeforeMessage>
        >()
        for (let i = 0; i < messages.length; i++) {
          const change = getProviderChangeBeforeMessage(messages, i)
          if (change) map.set(i, change)
        }
        return map
      }, [messages])

      // Expose methods to parent via ref
      useImperativeHandle(ref, () => ({
        scrollToIndex: (
          index: number,
          options?: { align?: 'start' | 'center' | 'end' }
        ) => {
          virtualizer.scrollToIndex(index, { align: options?.align ?? 'start' })
        },
        isIndexInView: (index: number) => {
          const el = messageRefs.current.get(index)
          const container = scrollContainerRef.current
          if (!el || !container) return false
          const rect = el.getBoundingClientRect()
          const containerRect = container.getBoundingClientRect()
          return (
            rect.top < containerRect.bottom && rect.bottom > containerRect.top
          )
        },
        getVisibleRange: () => ({
          start: items[0]?.index ?? 0,
          end: items.at(-1)?.index ?? -1,
        }),
      }))

      // Handle scroll-to-bottom when new messages arrive
      const prevMessageCountRef = useRef(messages.length)
      useEffect(() => {
        if (
          shouldScrollToBottom &&
          messages.length > prevMessageCountRef.current
        ) {
          virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
          onScrollToBottomHandled?.()
        }
        prevMessageCountRef.current = messages.length
      }, [
        messages.length,
        shouldScrollToBottom,
        onScrollToBottomHandled,
        virtualizer,
      ])

      if (messages.length === 0 && !hasOlderOnDisk) return null

      return (
        <div className="flex flex-col w-full">
          {hasOlderOnDisk && (
            <button
              type="button"
              onClick={onLoadOlderRuns}
              disabled={isLoadingOlder}
              className="w-full text-center text-muted-foreground text-xs py-2 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
            >
              {isLoadingOlder
                ? 'Loading older messages…'
                : `↑ Load older messages (${loadedRunStartIndex} older runs)`}
            </button>
          )}

          <div
            ref={listRef}
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              overflowAnchor: 'none',
            }}
          >
            {items.map(item => {
              const globalIndex = item.index
              const message = messages[globalIndex]
              if (!message) return null
              const hasFollowUpMessage =
                message.role === 'assistant' &&
                (hasFollowUpMap.get(globalIndex) ?? false)
              const durationMs = getAssistantDurationMs(
                messages,
                globalIndex,
                completedDurationMs
              )
              const providerChange = providerChangeMap.get(globalIndex)

              return (
                <div
                  key={message.id}
                  data-index={globalIndex}
                  data-message-anchor-id={message.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start - scrollMargin}px)`,
                  }}
                  ref={el => {
                    virtualizer.measureElement(el)
                    if (el) messageRefs.current.set(globalIndex, el)
                    else messageRefs.current.delete(globalIndex)
                  }}
                  className={
                    globalIndex === messages.length - 1 && isSending
                      ? ''
                      : 'pb-4'
                  }
                >
                  {providerChange && (
                    <ProviderChangeSeparator change={providerChange} />
                  )}
                  <MessageItem
                    message={message}
                    getMessages={getMessages}
                    messageIndex={globalIndex}
                    totalMessages={totalMessages}
                    pendingPlanMessageId={pendingPlanMessageId}
                    hasFollowUpMessage={hasFollowUpMessage}
                    sessionId={sessionId}
                    worktreePath={worktreePath}
                    approveShortcut={approveShortcut}
                    approveShortcutYolo={approveShortcutYolo}
                    approveShortcutClearContext={approveShortcutClearContext}
                    approveShortcutClearContextBuild={
                      approveShortcutClearContextBuild
                    }
                    approveButtonRef={
                      pendingPlanMessageId === message.id
                        ? approveButtonRef
                        : undefined
                    }
                    approvedPlanMessageIds={approvedPlanMessageIds}
                    isSending={isSending}
                    onPlanApproval={onPlanApproval}
                    onCustomBuildPrompt={onCustomBuildPrompt}
                    onPlanApprovalYolo={onPlanApprovalYolo}
                    onClearContextApproval={onClearContextApproval}
                    onClearContextApprovalBuild={onClearContextApprovalBuild}
                    onWorktreeBuildApproval={onWorktreeBuildApproval}
                    onWorktreeYoloApproval={onWorktreeYoloApproval}
                    onQuestionAnswer={onQuestionAnswer}
                    onQuestionSkip={onQuestionSkip}
                    onFileClick={onFileClick}
                    scrollViewportRef={scrollContainerRef}
                    onFixFinding={onFixFinding}
                    onFixAllFindings={onFixAllFindings}
                    isQuestionAnswered={isQuestionAnswered}
                    getSubmittedAnswers={getSubmittedAnswers}
                    areQuestionsSkipped={areQuestionsSkipped}
                    isFindingFixed={isFindingFixed}
                    onCopyToInput={onCopyToInput}
                    hideApproveButtons={hideApproveButtons}
                    durationMs={durationMs}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )
    }
  )
)
