import { coalesceContentBlocks } from '@/components/chat/tool-call-utils'
import { useChatStore } from '@/store/chat-store'
import type { ChatMessage } from '@/types/chat'

let replayBlocks: Record<string, ChatMessage['content_blocks']> = {}

function clearReplayBlocks(sessionId: string) {
  const { [sessionId]: _, ...rest } = replayBlocks
  replayBlocks = rest
}

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
  message: ChatMessage,
  options: { allowWhileSending?: boolean; dedupeReplayedOutput?: boolean } = {}
): boolean {
  const store = useChatStore.getState()
  if (!options.allowWhileSending && store.sendingSessionIds[sessionId]) {
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
  if (options.dedupeReplayedOutput) {
    replayBlocks[sessionId] = normalizedBlocks
  }
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

function consumeReplayBlock(
  sessionId: string,
  type: 'text' | 'thinking',
  content: string
): string {
  const blocks = replayBlocks[sessionId]
  const first = blocks?.[0]
  if (!first || first.type !== type)
    return type === 'thinking' && first ? '' : content

  const snapshot = first.type === 'text' ? first.text : first.thinking
  if (snapshot.startsWith(content)) {
    const remaining = snapshot.slice(content.length)
    replayBlocks[sessionId] = remaining
      ? [{ ...first, [type]: remaining }, ...blocks.slice(1)]
      : blocks.slice(1)
    return ''
  }
  if (content.startsWith(snapshot)) {
    replayBlocks[sessionId] = blocks.slice(1)
    return content.slice(snapshot.length)
  }
  clearReplayBlocks(sessionId)
  return content
}

export function consumeReplayedText(
  sessionId: string,
  content: string
): string {
  return consumeReplayBlock(sessionId, 'text', content)
}

export function consumeReplayedThinking(
  sessionId: string,
  content: string
): string {
  return consumeReplayBlock(sessionId, 'thinking', content)
}

export function consumeReplayedToolBlock(
  sessionId: string,
  toolCallId: string
): boolean {
  const blocks = replayBlocks[sessionId]
  if (
    blocks?.[0]?.type !== 'tool_use' ||
    blocks[0].tool_call_id !== toolCallId
  ) {
    clearReplayBlocks(sessionId)
    return false
  }
  replayBlocks[sessionId] = blocks.slice(1)
  return true
}
