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

function appendWithoutOverlap(existing: string, incoming: string): string {
  if (!existing || !incoming) return existing + incoming
  if (existing.endsWith(incoming)) return existing

  const maxOverlap = Math.min(existing.length, incoming.length)
  for (let length = maxOverlap; length > 0; length--) {
    if (existing.endsWith(incoming.slice(0, length))) {
      return existing + incoming.slice(length)
    }
  }
  return existing + incoming
}

function mergeSnapshotBlocks(
  snapshotBlocks: NonNullable<ChatMessage['content_blocks']>,
  liveBlocks: NonNullable<ChatMessage['content_blocks']>
): NonNullable<ChatMessage['content_blocks']> {
  const merged = [...snapshotBlocks]

  for (const block of liveBlocks) {
    const last = merged.at(-1)
    if (block.type === 'tool_use') {
      if (
        merged.some(
          existing =>
            existing.type === 'tool_use' &&
            existing.tool_call_id === block.tool_call_id
        )
      ) {
        continue
      }
      merged.push(block)
    } else if (block.type === 'text' && last?.type === 'text') {
      last.text = appendWithoutOverlap(last.text, block.text)
    } else if (block.type === 'thinking' && last?.type === 'thinking') {
      last.thinking = appendWithoutOverlap(last.thinking, block.thinking)
    } else {
      merged.push(block)
    }
  }

  return coalesceContentBlocks(merged)
}

/**
 * Rebuild the in-memory streaming state from a persisted running assistant
 * snapshot. When live chunks arrive before the session query, merge the
 * persisted prefix ahead of the in-memory state instead of losing either.
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

  const snapshotText = extractSnapshotText(message)
  const normalizedBlocks = coalesceContentBlocks(message.content_blocks ?? [])
  const liveBlocks = store.streamingContentBlocks[sessionId] ?? []
  const mergedBlocks = mergeSnapshotBlocks(normalizedBlocks, liveBlocks)
  const liveText = store.streamingContents[sessionId] ?? ''
  const mergedText = appendWithoutOverlap(snapshotText, liveText)
  const snapshotTools = message.tool_calls ?? []
  const liveTools = store.activeToolCalls[sessionId] ?? []
  const mergedTools = [...snapshotTools]
  for (const liveTool of liveTools) {
    const index = mergedTools.findIndex(tool => tool.id === liveTool.id)
    if (index === -1) mergedTools.push(liveTool)
    else mergedTools[index] = { ...mergedTools[index], ...liveTool }
  }

  useChatStore.setState(state => ({
    streamingContents: {
      ...state.streamingContents,
      [sessionId]: mergedText,
    },
    streamingContentBlocks: {
      ...state.streamingContentBlocks,
      [sessionId]: mergedBlocks,
    },
    activeToolCalls: {
      ...state.activeToolCalls,
      [sessionId]: mergedTools,
    },
  }))

  if (options.dedupeReplayedOutput) {
    replayBlocks[sessionId] = normalizedBlocks
  }

  return Boolean(
    snapshotText || normalizedBlocks.length || snapshotTools.length
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
