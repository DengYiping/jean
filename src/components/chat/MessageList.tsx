import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
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

interface MessageListProps {
  messages: ChatMessage[]
  totalMessages: number
  pendingPlanMessageId?: string | null
  sessionId: string
  worktreePath: string
  approveShortcut: string
  approveShortcutYolo?: string
  approveShortcutClearContext?: string
  approveShortcutClearContextBuild?: string
  approveButtonRef?: React.RefObject<HTMLButtonElement | null>
  approvedPlanMessageIds?: ReadonlySet<string>
  isSending: boolean
  onPlanApproval: (messageId: string) => void
  onCustomBuildPrompt?: (messageId: string) => void
  onPlanApprovalYolo?: (messageId: string) => void
  onClearContextApproval?: (messageId: string) => void
  onClearContextApprovalBuild?: (messageId: string) => void
  onWorktreeBuildApproval?: (messageId: string) => void
  onWorktreeYoloApproval?: (messageId: string) => void
  onQuestionAnswer: (
    toolCallId: string,
    answers: QuestionAnswer[],
    questions: Question[]
  ) => void
  onQuestionSkip: (toolCallId: string) => void
  onFileClick: (path: string) => void
  onFixFinding: (finding: ReviewFinding, suggestion?: string) => Promise<void>
  onFixAllFindings: (
    findings: { finding: ReviewFinding; suggestion?: string }[]
  ) => Promise<void>
  isQuestionAnswered: (sessionId: string, toolCallId: string) => boolean
  getSubmittedAnswers: (
    sessionId: string,
    toolCallId: string
  ) => QuestionAnswer[] | undefined
  areQuestionsSkipped: (sessionId: string) => boolean
  isFindingFixed: (sessionId: string, key: string) => boolean
  onCopyToInput?: (message: ChatMessage) => void
  hideApproveButtons?: boolean
  completedDurationMs?: number | null
}

/**
 * Simple message list that renders all messages.
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
export const MessageList = memo(function MessageList({
  messages,
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
  completedDurationMs,
}: MessageListProps) {
  // Stable accessor for the full message list. Kept in a ref so the identity
  // handed to memoized rows never changes — "subsequent edits" stays lazy
  // without busting per-row memoization.
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  const getMessages = useCallback(() => messagesRef.current, [])

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

  if (messages.length === 0) return null

  return (
    <div className="flex flex-col w-full">
      {messages.map((message, index) => {
        const hasFollowUpMessage =
          message.role === 'assistant' && (hasFollowUpMap.get(index) ?? false)
        const durationMs = getAssistantDurationMs(
          messages,
          index,
          completedDurationMs
        )
        const providerChange = providerChangeMap.get(index)

        return (
          <div key={message.id}>
            {providerChange && (
              <ProviderChangeSeparator change={providerChange} />
            )}
            <MessageItem
              message={message}
              getMessages={getMessages}
              messageIndex={index}
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
  )
})
