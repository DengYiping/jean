import { useEffect, useMemo, useState } from 'react'
import { getTodosFromToolCall, isCollabToolCall } from '@/types/chat'
import type { ToolCall, ChatMessage, CodexAgent } from '@/types/chat'

interface UseActiveTodosAndAgentsParams {
  activeSessionId: string | null | undefined
  isSending: boolean
  currentToolCalls: ToolCall[]
  lastAssistantMessage: ChatMessage | undefined
}

interface CollabAgentState {
  status?: string | null
  message?: string | null
  agent_nickname?: string | null
  agentNickname?: string | null
}

interface CollabToolCallInput {
  prompt?: string
  status?: string | null
  receiver_thread_ids?: unknown
  receiverThreadIds?: unknown
  agents_states?: unknown
  agentsStates?: unknown
  new_agent_nickname?: string | null
  newAgentNickname?: string | null
  receiver_agent_nickname?: string | null
  receiverAgentNickname?: string | null
}

function truncateAgentPrompt(prompt?: string): string {
  const trimmed = prompt?.trim()
  if (!trimmed) return 'Sub-agent'
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed
}

function normalizeAgentStatus(status?: string | null): {
  status: CodexAgent['status']
  label: string
} {
  switch (status) {
    case 'completed':
      return { status: 'completed', label: 'Completed' }
    case 'shutdown':
      return { status: 'completed', label: 'Closed' }
    case 'errored':
      return { status: 'errored', label: 'Errored' }
    case 'notFound':
    case 'not_found':
      return { status: 'errored', label: 'Not found' }
    case 'pendingInit':
    case 'pending_init':
      return { status: 'in_progress', label: 'Starting' }
    case 'running':
    default:
      return { status: 'in_progress', label: 'Running' }
  }
}

function normalizeToolStatus(
  status?: string | null
): CodexAgent['status'] | null {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'errored'
    case 'inProgress':
    case 'in_progress':
      return 'in_progress'
    default:
      return null
  }
}

function effectiveAgentStatus(
  toolName: ToolCall['name'],
  stateStatus?: string | null,
  toolStatus?: CodexAgent['status'] | null
): { status: CodexAgent['status']; label: string } {
  if (
    (toolName === 'CloseAgent' || toolName === 'closeAgent') &&
    toolStatus === 'completed'
  ) {
    return { status: 'completed', label: 'Closed' }
  }

  if (
    (toolName === 'WaitForAgents' || toolName === 'wait') &&
    !stateStatus &&
    toolStatus === 'completed'
  ) {
    return { status: 'in_progress', label: 'Running' }
  }

  return normalizeAgentStatus(stateStatus)
}

function getCollabReceiverIds(input: CollabToolCallInput): string[] {
  const receiverIds = Array.isArray(input.receiver_thread_ids)
    ? input.receiver_thread_ids
    : Array.isArray(input.receiverThreadIds)
      ? input.receiverThreadIds
      : []
  return receiverIds.filter(
    (receiverId): receiverId is string => typeof receiverId === 'string'
  )
}

function getCollabAgentStates(
  input: CollabToolCallInput
): Record<string, CollabAgentState> {
  const states = input.agents_states ?? input.agentsStates
  if (!states || typeof states !== 'object' || Array.isArray(states)) {
    return {}
  }
  return states as Record<string, CollabAgentState>
}

function getFallbackProgressMessage(
  toolName: ToolCall['name'],
  toolStatus: CodexAgent['status'] | null,
  output?: string
): string | undefined {
  const firstLine = output
    ?.split('\n')
    .map(line => line.trim())
    .find(Boolean)

  if (toolStatus === 'errored') {
    return firstLine ? `Errored: ${firstLine}` : 'Errored'
  }

  switch (toolName) {
    case 'SpawnAgent':
    case 'spawnAgent':
      return toolStatus === 'completed' ? 'Started' : 'Starting'
    case 'SendInput':
    case 'sendInput':
      return toolStatus === 'completed' ? 'Input sent' : 'Sending input'
    case 'WaitForAgents':
    case 'wait':
      return toolStatus === 'completed' ? 'Wait finished' : 'Waiting'
    case 'CloseAgent':
    case 'closeAgent':
      return toolStatus === 'completed' ? 'Closed' : 'Closing'
    case 'ResumeAgent':
    case 'resumeAgent':
      return toolStatus === 'completed' ? 'Resumed' : 'Resuming'
    default:
      return firstLine
  }
}

function getAgentNickname(
  input: CollabToolCallInput,
  agentState?: CollabAgentState
): string | undefined {
  const candidates = [
    agentState?.agent_nickname,
    agentState?.agentNickname,
    input.new_agent_nickname,
    input.newAgentNickname,
    input.receiver_agent_nickname,
    input.receiverAgentNickname,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return undefined
}

function buildFallbackAgentName(agentId: string, index: number): string {
  const compactId = agentId.trim()
  if (compactId) {
    return `Agent ${compactId.slice(0, 8)}`
  }
  return `Agent ${index + 1}`
}

function upsertAgent(
  agents: Map<string, CodexAgent>,
  agentId: string,
  patch: Partial<CodexAgent>
): void {
  const existing = agents.get(agentId)
  const fallbackName = buildFallbackAgentName(agentId, agents.size)
  agents.set(agentId, {
    id: agentId,
    name: patch.name ?? existing?.name ?? fallbackName,
    prompt: patch.prompt ?? existing?.prompt ?? 'Sub-agent',
    status: patch.status ?? existing?.status ?? 'in_progress',
    message: patch.message ?? existing?.message,
  })
}

/**
 * Extracts active todos and agents from streaming tool calls or last assistant message.
 * Includes dismissal state management for both.
 */
export function useActiveTodosAndAgents({
  activeSessionId,
  isSending,
  currentToolCalls,
  lastAssistantMessage,
}: UseActiveTodosAndAgentsParams) {
  // Track which message's todos were dismissed
  const [dismissedTodoMessageId, setDismissedTodoMessageId] = useState<
    string | null
  >(null)

  // Get active todos from streaming tool calls OR last assistant message
  const {
    todos: activeTodos,
    sourceMessageId: todoSourceMessageId,
    isFromStreaming: todoIsFromStreaming,
  } = useMemo(() => {
    if (!activeSessionId)
      return { todos: [], sourceMessageId: null, isFromStreaming: false }

    if (isSending && currentToolCalls.length > 0) {
      for (let i = currentToolCalls.length - 1; i >= 0; i--) {
        const tc = currentToolCalls[i]
        const todos = tc ? getTodosFromToolCall(tc) : null
        if (todos) {
          return {
            todos,
            sourceMessageId: null,
            isFromStreaming: true,
          }
        }
      }
    }

    if (lastAssistantMessage?.tool_calls) {
      for (let i = lastAssistantMessage.tool_calls.length - 1; i >= 0; i--) {
        const tc = lastAssistantMessage.tool_calls[i]
        const todos = tc ? getTodosFromToolCall(tc) : null
        if (todos) {
          return {
            todos,
            sourceMessageId: lastAssistantMessage.id,
            isFromStreaming: false,
          }
        }
      }
    }

    return { todos: [], sourceMessageId: null, isFromStreaming: false }
  }, [activeSessionId, isSending, currentToolCalls, lastAssistantMessage])

  // Track which message's agents were dismissed
  const [dismissedAgentMessageId, setDismissedAgentMessageId] = useState<
    string | null
  >(null)

  // Build per-agent progress from Codex collab tool calls.
  const {
    agents: activeAgents,
    sourceMessageId: agentSourceMessageId,
    isFromStreaming: agentIsFromStreaming,
  } = useMemo(() => {
    if (!activeSessionId)
      return { agents: [], sourceMessageId: null, isFromStreaming: false }

    const toolCalls =
      isSending && currentToolCalls.length > 0
        ? currentToolCalls
        : (lastAssistantMessage?.tool_calls ?? [])

    const agents = new Map<string, CodexAgent>()

    for (const tc of toolCalls) {
      if (!isCollabToolCall(tc)) continue

      const input =
        tc.input && typeof tc.input === 'object'
          ? (tc.input as CollabToolCallInput)
          : {}
      const receiverIds = getCollabReceiverIds(input)
      const agentStates = getCollabAgentStates(input)
      const prompt = input.prompt?.trim()
        ? truncateAgentPrompt(input.prompt)
        : undefined
      const toolStatus = normalizeToolStatus(input.status)

      if (
        (tc.name === 'SpawnAgent' || tc.name === 'spawnAgent') &&
        receiverIds.length === 0
      ) {
        upsertAgent(agents, tc.id, {
          name: getAgentNickname(input),
          prompt: prompt ?? 'Sub-agent',
          status: toolStatus ?? 'in_progress',
          message: getFallbackProgressMessage(tc.name, toolStatus, tc.output),
        })
        continue
      }

      for (const receiverId of receiverIds) {
        const agentState = agentStates[receiverId]
        const normalizedState = effectiveAgentStatus(
          tc.name,
          agentState?.status,
          toolStatus
        )
        const detail = agentState?.message?.trim()
        upsertAgent(agents, receiverId, {
          name: getAgentNickname(input, agentState),
          prompt,
          status: normalizedState.status,
          message: detail
            ? `${normalizedState.label}: ${detail}`
            : normalizedState.label,
        })
      }

      if (receiverIds.length === 0 && tc.name !== 'SpawnAgent') {
        upsertAgent(agents, tc.id, {
          name: getAgentNickname(input),
          prompt: prompt ?? 'Sub-agent',
          status: toolStatus ?? 'in_progress',
          message: getFallbackProgressMessage(tc.name, toolStatus, tc.output),
        })
      }
    }

    const sourceId =
      isSending && currentToolCalls.length > 0
        ? null
        : (lastAssistantMessage?.id ?? null)
    return {
      agents: Array.from(agents.values()),
      sourceMessageId: sourceId,
      isFromStreaming: isSending && currentToolCalls.length > 0,
    }
  }, [activeSessionId, isSending, currentToolCalls, lastAssistantMessage])

  // Auto-clear todo dismissal on new streaming todos
  useEffect(() => {
    if (isSending && activeTodos.length > 0 && todoSourceMessageId === null) {
      if (dismissedTodoMessageId !== '__streaming__') {
        queueMicrotask(() => setDismissedTodoMessageId(null))
      }
    }
    if (
      !isSending &&
      todoSourceMessageId !== null &&
      dismissedTodoMessageId === '__streaming__'
    ) {
      queueMicrotask(() => setDismissedTodoMessageId(todoSourceMessageId))
    }
  }, [
    isSending,
    activeTodos.length,
    todoSourceMessageId,
    dismissedTodoMessageId,
  ])

  // Auto-clear agent dismissal on new streaming agents
  useEffect(() => {
    if (isSending && activeAgents.length > 0 && agentSourceMessageId === null) {
      if (dismissedAgentMessageId !== '__streaming__') {
        queueMicrotask(() => setDismissedAgentMessageId(null))
      }
    } else if (
      !isSending &&
      agentSourceMessageId !== null &&
      dismissedAgentMessageId === '__streaming__'
    ) {
      queueMicrotask(() => setDismissedAgentMessageId(agentSourceMessageId))
    }
  }, [
    isSending,
    activeAgents.length,
    agentSourceMessageId,
    dismissedAgentMessageId,
  ])

  return {
    activeTodos,
    todoSourceMessageId,
    todoIsFromStreaming,
    dismissedTodoMessageId,
    setDismissedTodoMessageId,
    activeAgents,
    agentSourceMessageId,
    agentIsFromStreaming,
    dismissedAgentMessageId,
    setDismissedAgentMessageId,
  }
}
