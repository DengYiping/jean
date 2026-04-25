import { coalesceContentBlocks } from '@/components/chat/tool-call-utils'
import { useChatStore } from '@/store/chat-store'
import type { ChatMessage } from '@/types/chat'

function extractSnapshotText(message: ChatMessage): string {
  if (message.content) {
    return message.content
  }

  const normalizedBlocks = coalesceContentBlocks(message.content_blocks ?? [])
  const textParts: string[] = []
  for (const block of normalizedBlocks) {
    if (block.type === 'text') {
      textParts.push(block.text)
    }
  }

  return textParts.join('')
}

/**
 * Rebuild the in-memory streaming state from a persisted running assistant
 * snapshot. Skip when this client already has live streaming state so reconnect
 * or resume flows do not inject duplicate transient UI.
 */
export function hydrateRunningSnapshot(
  sessionId: string,
  message: ChatMessage
): boolean {
  const store = useChatStore.getState()
  if (store.sendingSessionIds[sessionId]) {
    return false
  }

  const hasLiveStreamingState =
    (store.streamingContentBlocks[sessionId]?.length ?? 0) > 0 ||
    (store.activeToolCalls[sessionId]?.length ?? 0) > 0

  if (hasLiveStreamingState) {
    return false
  }

  const snapshotText = extractSnapshotText(message)
  if (snapshotText) {
    store.setStreamingContent(sessionId, snapshotText)
  }

  const normalizedBlocks = coalesceContentBlocks(message.content_blocks ?? [])
  for (const block of normalizedBlocks) {
    if (block.type === 'text') {
      store.addTextBlock(sessionId, block.text)
    } else if (block.type === 'tool_use') {
      store.addToolBlock(sessionId, block.tool_call_id)
    } else if (block.type === 'thinking') {
      store.addThinkingBlock(sessionId, block.thinking)
    }
  }

  for (const toolCall of message.tool_calls ?? []) {
    store.addToolCall(sessionId, toolCall)
  }

  return Boolean(
    snapshotText || normalizedBlocks.length || (message.tool_calls?.length ?? 0)
  )
}
