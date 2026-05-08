import { describe, expect, it, vi } from 'vitest'
import {
  executeAgentHarnessFanout,
  getDefaultModelForBackend,
  type ExecuteAgentHarnessFanoutParams,
} from './useAgentHarnessFanout'
import type { Session, WorktreeSessions } from '@/types/chat'
import type { Worktree } from '@/types/projects'

function makeWorktree(id: string, stableSlotId?: string): Worktree {
  return {
    id,
    project_id: 'project-1',
    name: id,
    path: `/repo/${id}`,
    stable_slot_id: stableSlotId,
    branch: id,
    created_at: 1,
    order: 0,
    status: 'ready',
  }
}

function makeSession(id: string): Session {
  return {
    id,
    name: id,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
  }
}

describe('agent harness fan-out', () => {
  it('resolves backend default models from preferences', () => {
    const preferences = {
      selected_model: 'opus',
      selected_codex_model: 'gpt-5.4',
      selected_opencode_model: 'opencode/custom',
    }

    expect(getDefaultModelForBackend('claude', preferences, 'sonnet')).toBe(
      'opus'
    )
    expect(getDefaultModelForBackend('codex', preferences, 'sonnet')).toBe(
      'gpt-5.4'
    )
    expect(getDefaultModelForBackend('opencode', preferences, 'sonnet')).toBe(
      'opencode/custom'
    )
  })

  it('falls back to the current Claude default model id when needed', () => {
    expect(getDefaultModelForBackend('claude', undefined, '')).toBe(
      'claude-opus-4-7'
    )
  })

  it('uses the Claude default model when fan-out preferences contain an empty model', async () => {
    const invoke = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === 'create_worktree') {
          return makeWorktree('claude-wt', 'slot-claude')
        }
        if (command === 'get_sessions') {
          return {
            worktree_id: String(args?.worktreeId ?? ''),
            active_session_id: 'claude-session',
            sessions: [makeSession('claude-session')],
            version: 2,
          } satisfies WorktreeSessions
        }
        return null
      }
    )
    const sendMessage = vi.fn()

    await executeAgentHarnessFanout({
      projectId: 'project-1',
      targetBackends: ['claude'],
      snapshot: {
        sourceSessionId: 'source-session',
        message: 'claude prompt',
        images: [],
        files: [],
        skills: [],
        textFiles: [],
      },
      executionMode: 'build',
      selectedThinkingLevel: 'think',
      selectedEffortLevel: 'high',
      selectedProvider: null,
      currentModel: '',
      preferences: {
        selected_model: '',
      },
      sourceHasUncommittedChanges: false,
      invoke: invoke as unknown as ExecuteAgentHarnessFanoutParams['invoke'],
      listen: vi.fn(),
      sendMessage,
      clearSnapshot: vi.fn(),
      onDirtyWarning: vi.fn(),
      onWorktreeReady: vi.fn(),
      onSessionPrepared: vi.fn(),
      resolveCustomProfile: model => ({ model }),
      getMcpConfig: backend => `mcp:${backend}`,
      resolveParallelExecutionPrompt: sessionId => `parallel:${sessionId}`,
    })

    expect(invoke).toHaveBeenCalledWith('set_session_model', {
      worktreeId: 'claude-wt',
      worktreePath: '/repo/claude-wt',
      sessionId: 'claude-session',
      model: 'claude-opus-4-7',
    })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'claude-session',
        worktreeId: 'claude-wt',
        model: 'claude-opus-4-7',
        thinkingLevel: 'think',
        mcpConfig: 'mcp:claude',
        parallelExecutionPrompt: 'parallel:claude-session',
        backend: 'claude',
      })
    )
  })

  it('creates one worktree per harness and sends the same prompt to each', async () => {
    const createdWorktrees = [
      makeWorktree('codex-wt', 'slot-codex'),
      makeWorktree('open-wt', 'slot-open'),
    ]
    const sessions = [makeSession('codex-session'), makeSession('open-session')]
    const invoke = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === 'create_worktree') {
          return createdWorktrees.shift()
        }
        if (command === 'get_sessions') {
          const session = sessions.shift()
          return {
            worktree_id: String(args?.worktreeId ?? ''),
            active_session_id: session?.id ?? null,
            sessions: session ? [session] : [],
            version: 2,
          } satisfies WorktreeSessions
        }
        return null
      }
    )
    const sendMessage = vi.fn()
    const clearSnapshot = vi.fn()
    const onDirtyWarning = vi.fn()
    const onWorktreeReady = vi.fn()

    await executeAgentHarnessFanout({
      projectId: 'project-1',
      sourceBaseBranch: 'feature/base',
      targetBackends: ['codex', 'opencode'],
      snapshot: {
        sourceSessionId: 'source-session',
        message: 'same prompt',
        images: [],
        files: [],
        skills: [],
        textFiles: [],
      },
      executionMode: 'build',
      selectedThinkingLevel: 'think',
      selectedEffortLevel: 'high',
      selectedProvider: null,
      currentModel: 'sonnet',
      preferences: {
        selected_codex_model: 'gpt-5.4',
        selected_opencode_model: 'opencode/gpt-5.3-codex',
      },
      sourceHasUncommittedChanges: true,
      invoke: invoke as unknown as ExecuteAgentHarnessFanoutParams['invoke'],
      listen: vi.fn(),
      sendMessage,
      clearSnapshot,
      onDirtyWarning,
      onWorktreeReady,
      onSessionPrepared: vi.fn(),
      resolveCustomProfile: model => ({ model }),
      getMcpConfig: backend => `mcp:${backend}`,
      resolveParallelExecutionPrompt: sessionId => `parallel:${sessionId}`,
    })

    expect(clearSnapshot).toHaveBeenCalledOnce()
    expect(onDirtyWarning).toHaveBeenCalledOnce()
    expect(onWorktreeReady).toHaveBeenCalledTimes(2)
    expect(
      new Set(
        onWorktreeReady.mock.calls.map(
          call => (call[0] as Worktree).stable_slot_id
        )
      )
    ).toEqual(new Set(['slot-codex', 'slot-open']))
    expect(invoke).toHaveBeenCalledWith('create_worktree', {
      projectId: 'project-1',
      baseBranch: 'feature/base',
    })
    expect(invoke).toHaveBeenCalledWith('set_session_backend', {
      worktreeId: 'codex-wt',
      worktreePath: '/repo/codex-wt',
      sessionId: 'codex-session',
      backend: 'codex',
    })
    expect(invoke).toHaveBeenCalledWith('set_session_backend', {
      worktreeId: 'open-wt',
      worktreePath: '/repo/open-wt',
      sessionId: 'open-session',
      backend: 'opencode',
    })
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: 'codex-session',
        worktreeId: 'codex-wt',
        message: 'same prompt',
        model: 'gpt-5.4',
        executionMode: 'build',
        thinkingLevel: 'off',
        effortLevel: 'high',
        mcpConfig: 'mcp:codex',
        parallelExecutionPrompt: 'parallel:codex-session',
        backend: 'codex',
      })
    )
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: 'open-session',
        worktreeId: 'open-wt',
        message: 'same prompt',
        model: 'opencode/gpt-5.3-codex',
        executionMode: 'build',
        thinkingLevel: 'think',
        mcpConfig: 'mcp:opencode',
        parallelExecutionPrompt: 'parallel:open-session',
        backend: 'opencode',
      })
    )
  })
})
