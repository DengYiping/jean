import { useMemo } from 'react'
import { isAskUserQuestion, isExitPlanMode } from '@/types/chat'
import type { ToolCall, Session } from '@/types/chat'
import { findPlanFilePath, findPlanContent } from '../tool-call-utils'

interface UsePlanStateParams {
  session: Session | null | undefined
  currentToolCalls: ToolCall[]
  isSending: boolean
  activeSessionId: string | null | undefined
  isStreamingPlanApproved: (sessionId: string) => boolean
  isQuestionAnswered: (sessionId: string, toolCallId: string) => boolean
}

/**
 * Computes all plan-related derived state from session messages and streaming tool calls.
 */
export function usePlanState({
  session,
  currentToolCalls,
  isSending,
  activeSessionId,
  isStreamingPlanApproved,
  isQuestionAnswered,
}: UsePlanStateParams) {
  // Returns the message that has an unapproved plan awaiting action, if any
  const pendingPlanMessage = useMemo(() => {
    const messages = session?.messages ?? []
    const approvedPlanMessageIds = new Set(
      session?.approved_plan_message_ids ?? []
    )

    const hasResolvedQuestions = (toolCalls: ToolCall[] | undefined) => {
      if (!activeSessionId || !toolCalls) return false
      const questionCalls = toolCalls.filter(isAskUserQuestion)
      return (
        questionCalls.length > 0 &&
        questionCalls.every(tc => isQuestionAnswered(activeSessionId, tc.id))
      )
    }

    const isPendingPlanCandidate = (
      message: Session['messages'][number] | undefined,
      allowRecoveryWithoutWaitingType = false
    ) => {
      if (
        message?.role !== 'assistant' ||
        !message.tool_calls?.some(tc => isExitPlanMode(tc))
      ) {
        return false
      }

      const isApproved =
        (message.plan_approved ?? false) ||
        approvedPlanMessageIds.has(message.id)
      if (isApproved) {
        return false
      }

      const hasQuestionCalls = message.tool_calls.some(isAskUserQuestion)
      const canShowPendingPlan =
        session?.waiting_for_input_type === 'plan' ||
        hasResolvedQuestions(message.tool_calls) ||
        (allowRecoveryWithoutWaitingType && !hasQuestionCalls)
      return canShowPendingPlan
    }

    const pendingPlanMessageId = session?.pending_plan_message_id ?? null
    let hasExplicitPendingPlanId = false
    if (session?.waiting_for_input === true && pendingPlanMessageId) {
      const pendingMessage = messages.find(
        msg => msg?.id === pendingPlanMessageId
      )
      if (isPendingPlanCandidate(pendingMessage)) {
        const pendingIndex = messages.findIndex(
          msg => msg?.id === pendingPlanMessageId
        )
        if (pendingIndex === messages.length - 1) {
          return pendingMessage
        }
      }
      hasExplicitPendingPlanId = true
    }

    if (session?.waiting_for_input === true) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m && m.role === 'assistant' && m.tool_calls?.some(isExitPlanMode)) {
          if (i !== messages.length - 1) {
            return null
          }
          return isPendingPlanCandidate(m) ? m : null
        }
      }
      if (hasExplicitPendingPlanId) {
        return null
      }
      return null
    }

    const canRecoverCompletedPlanWithoutWaiting =
      session?.is_reviewing !== true &&
      session?.last_run_status === 'completed' &&
      (session?.last_run_execution_mode === 'plan' ||
        (session?.last_run_execution_mode == null &&
          session?.selected_execution_mode === 'plan'))

    if (!canRecoverCompletedPlanWithoutWaiting) {
      return null
    }

    const lastMessage = messages[messages.length - 1]
    if (!isPendingPlanCandidate(lastMessage, true)) {
      return null
    }

    return lastMessage
  }, [
    session?.messages,
    session?.approved_plan_message_ids,
    session?.waiting_for_input,
    session?.waiting_for_input_type,
    session?.pending_plan_message_id,
    session?.is_reviewing,
    session?.last_run_status,
    session?.last_run_execution_mode,
    session?.selected_execution_mode,
    activeSessionId,
    isQuestionAnswered,
  ])

  // Check if there's a streaming plan awaiting approval
  const hasStreamingPlan = useMemo(() => {
    if (!isSending || !activeSessionId) return false
    const hasExitPlanModeTool = currentToolCalls.some(isExitPlanMode)
    return hasExitPlanModeTool && !isStreamingPlanApproved(activeSessionId)
  }, [isSending, activeSessionId, currentToolCalls, isStreamingPlanApproved])

  // Find latest plan content from ExitPlanMode tool calls (primary source)
  const latestPlanContent = useMemo(() => {
    const streamingPlan = findPlanContent(currentToolCalls)
    if (streamingPlan) return streamingPlan
    const msgs = session?.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m?.tool_calls) {
        const content = findPlanContent(m.tool_calls)
        if (content) return content
      }
    }
    return null
  }, [session?.messages, currentToolCalls])

  // Find latest plan file path (fallback for old-style file-based plans)
  const latestPlanFilePath = useMemo(() => {
    const msgs = session?.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m?.tool_calls) {
        const path = findPlanFilePath(m.tool_calls)
        if (path) return path
      }
    }
    return null
  }, [session?.messages])

  return {
    pendingPlanMessage,
    hasStreamingPlan,
    latestPlanContent,
    latestPlanFilePath,
  }
}
