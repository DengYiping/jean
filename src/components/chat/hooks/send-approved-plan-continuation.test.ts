import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chatQueryKeys } from '@/services/chat'
import { invoke } from '@/lib/transport'
import { sendApprovedPlanContinuation } from './send-approved-plan-continuation'
import type { ApprovedPlanContinuation } from './approved-plan-continuation'
import type { Session } from '@/types/chat'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

const store = vi.hoisted(() => ({
  setExecutionMode: vi.fn(),
  setLastSentMessage: vi.fn(),
  setError: vi.fn(),
  addSendingSession: vi.fn(),
  setSelectedModel: vi.fn(),
  setExecutingMode: vi.fn(),
  setSelectedBackend: vi.fn(),
}))

vi.mock('@/store/chat-store', () => ({
  useChatStore: {
    getState: () => store,
  },
}))

describe('sendApprovedPlanContinuation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(null)
  })

  it('updates local session state, persists model/backend, then sends the continuation', async () => {
    const queryClient = new QueryClient()
    const sendMessage = { mutate: vi.fn() }
    const continuation: ApprovedPlanContinuation = {
      backend: 'codex',
      model: 'gpt-5.4',
      modeLabel: 'Yolo',
      modeOverride: 'codex / gpt-5.4',
      message: 'Execute this plan.',
      thinkingLevel: 'off',
      effortLevel: 'high',
    }

    queryClient.setQueryData<Session>(chatQueryKeys.session('session-2'), {
      id: 'session-2',
      name: 'Session 2',
      created_at: 0,
      updated_at: 0,
      messages: [],
      worktree_id: 'worktree-2',
      order: 0,
      status: 'idle',
      backend: 'claude',
      selected_model: 'claude-opus-4-8[1m]',
    } as Session)

    await sendApprovedPlanContinuation({
      queryClient,
      sendMessage,
      target: {
        sessionId: 'session-2',
        worktreeId: 'worktree-2',
        worktreePath: '/tmp/worktree-2',
      },
      mode: 'yolo',
      continuation,
      logContext: 'test',
      mcpConfig: '{"servers":[]}',
      customProfileName: 'profile-a',
    })

    expect(store.setExecutionMode).toHaveBeenCalledWith('session-2', 'yolo')
    expect(store.setLastSentMessage).toHaveBeenCalledWith(
      'session-2',
      continuation.message
    )
    expect(store.setSelectedModel).toHaveBeenCalledWith('session-2', 'gpt-5.4')
    expect(store.setSelectedBackend).toHaveBeenCalledWith('session-2', 'codex')

    expect(
      queryClient.getQueryData<Session>(chatQueryKeys.session('session-2'))
    ).toMatchObject({
      backend: 'codex',
      selected_model: 'gpt-5.4',
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'set_session_model', {
      worktreeId: 'worktree-2',
      worktreePath: '/tmp/worktree-2',
      sessionId: 'session-2',
      model: 'gpt-5.4',
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_session_backend', {
      worktreeId: 'worktree-2',
      worktreePath: '/tmp/worktree-2',
      sessionId: 'session-2',
      backend: 'codex',
    })

    expect(sendMessage.mutate).toHaveBeenCalledWith({
      sessionId: 'session-2',
      worktreeId: 'worktree-2',
      worktreePath: '/tmp/worktree-2',
      message: 'Execute this plan.',
      model: 'gpt-5.4',
      executionMode: 'yolo',
      thinkingLevel: 'off',
      effortLevel: 'high',
      mcpConfig: '{"servers":[]}',
      customProfileName: 'profile-a',
      backend: 'codex',
    })
  })

  it('does not persist or send a backend override when the continuation has none', async () => {
    const queryClient = new QueryClient()
    const sendMessage = { mutate: vi.fn() }

    await sendApprovedPlanContinuation({
      queryClient,
      sendMessage,
      target: {
        sessionId: 'session-3',
        worktreeId: 'worktree-3',
        worktreePath: '/tmp/worktree-3',
      },
      mode: 'build',
      continuation: {
        model: 'claude-opus-4-8[1m]',
        modeLabel: 'Build',
        modeOverride: '',
        message: 'Execute this plan.',
        thinkingLevel: 'think',
      },
      logContext: 'test',
    })

    expect(store.setSelectedBackend).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: undefined,
        executionMode: 'build',
      })
    )
  })
})
