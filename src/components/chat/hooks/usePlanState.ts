import { useMemo } from 'react'
import { isExitPlanMode } from '@/types/chat'
import type { ToolCall, Session } from '@/types/chat'
import { findPlanFilePath, findPlanContent } from '../tool-call-utils'

interface UsePlanStateParams {
  session: Session | null | undefined
  currentToolCalls: ToolCall[]
  isSending: boolean
  activeSessionId: string | null | undefined
  isStreamingPlanApproved: (sessionId: string) => boolean
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
}: UsePlanStateParams) {
  // Returns the message that has an unapproved plan awaiting action, if any
  const pendingPlanMessage = useMemo(() => {
    const messages = session?.messages ?? []
    const approvedPlanMessageIds = new Set(
      session?.approved_plan_message_ids ?? []
    )
    const isWaitingForPlan =
      session?.waiting_for_input === true &&
      session.waiting_for_input_type === 'plan'

    if (!isWaitingForPlan) {
      return null
    }

    const pendingPlanMessageId = session?.pending_plan_message_id ?? null
    if (pendingPlanMessageId) {
      const pendingMessage = messages.find(
        msg => msg?.id === pendingPlanMessageId
      )
      if (
        pendingMessage?.role !== 'assistant' ||
        !pendingMessage.tool_calls?.some(tc => isExitPlanMode(tc))
      ) {
        return null
      }

      const isApproved =
        (pendingMessage.plan_approved ?? false) ||
        approvedPlanMessageIds.has(pendingMessage.id)
      if (isApproved) {
        return null
      }

      const pendingIndex = messages.findIndex(
        msg => msg?.id === pendingPlanMessageId
      )
      for (let i = pendingIndex + 1; i < messages.length; i++) {
        if (messages[i]?.role === 'user') {
          return null
        }
      }

      return pendingMessage
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (
        m &&
        m.role === 'assistant' &&
        m.tool_calls?.some(tc => isExitPlanMode(tc))
      ) {
        let hasFollowUp = false
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j]?.role === 'user') {
            hasFollowUp = true
            break
          }
        }
        const isApproved =
          (m.plan_approved ?? false) || approvedPlanMessageIds.has(m.id)
        if (!isApproved && !hasFollowUp) {
          return m
        }
        break
      }
    }
    return null
  }, [
    session?.messages,
    session?.approved_plan_message_ids,
    session?.waiting_for_input,
    session?.waiting_for_input_type,
    session?.pending_plan_message_id,
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
