import { useCallback, type RefObject } from 'react'
import { toast } from 'sonner'
import { invoke, listen } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { buildMcpConfigJson } from '@/services/mcp'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { resolveParallelExecutionPromptForSession } from '@/lib/parallel-execution-prompt'
import { useChatStore } from '@/store/chat-store'
import type { QueryClient } from '@tanstack/react-query'
import type {
  Backend,
  EffortLevel,
  ExecutionMode,
  McpServerInfo,
  Session,
  ThinkingLevel,
  WorktreeSessions,
} from '@/types/chat'
import type {
  Worktree,
  WorktreeCreatedEvent,
  WorktreeCreateErrorEvent,
} from '@/types/projects'
import type { AppPreferences } from '@/types/preferences'
import {
  buildMessageWithPendingRefs,
  type PendingInputSnapshot,
} from '@/components/chat/pending-input'

const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8[1m]'
const DEFAULT_CODEX_MODEL = 'gpt-5.5'
const DEFAULT_OPENCODE_MODEL = 'opencode/gpt-5.3-codex'

type InvokeFn = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>
type ListenFn = <T>(
  event: string,
  handler: (event: { payload: T }) => void
) => Promise<() => void>

interface FanoutPreferences {
  selected_model?: string
  selected_codex_model?: string
  selected_opencode_model?: string
  parallel_execution_prompt_enabled?: boolean
  magic_prompts?: { parallel_execution?: string | null }
  chrome_enabled?: boolean
  ai_language?: string
}

export function getDefaultModelForBackend(
  backend: Backend,
  preferences: FanoutPreferences | undefined,
  currentModel: string
): string {
  if (backend === 'codex') {
    return preferences?.selected_codex_model ?? DEFAULT_CODEX_MODEL
  }
  if (backend === 'opencode') {
    return preferences?.selected_opencode_model ?? DEFAULT_OPENCODE_MODEL
  }

  if (preferences?.selected_model) {
    return preferences.selected_model
  }

  return currentModel.trim() ? currentModel : DEFAULT_CLAUDE_MODEL
}

function uniqueBackends(backends: Backend[]): Backend[] {
  return [...new Set(backends)]
}

async function waitForWorktreeReady({
  pendingWorktree,
  listen,
  timeoutMs,
}: {
  pendingWorktree: Worktree
  listen: ListenFn
  timeoutMs: number
}): Promise<Worktree> {
  if (pendingWorktree.status === 'ready') {
    return pendingWorktree
  }

  return await new Promise<Worktree>((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      void unlistenCreated.then(fn => fn())
      void unlistenError.then(fn => fn())
      reject(new Error('Worktree creation timed out'))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      void unlistenCreated.then(fn => fn())
      void unlistenError.then(fn => fn())
    }

    const unlistenCreated = listen<WorktreeCreatedEvent>(
      'worktree:created',
      event => {
        if (event.payload.worktree.id !== pendingWorktree.id || settled) return
        settled = true
        cleanup()
        resolve(event.payload.worktree)
      }
    )

    const unlistenError = listen<WorktreeCreateErrorEvent>(
      'worktree:error',
      event => {
        if (event.payload.id !== pendingWorktree.id || settled) return
        settled = true
        cleanup()
        reject(new Error(event.payload.error))
      }
    )
  })
}

async function getOrCreateInitialSession({
  invoke,
  worktree,
  backend,
}: {
  invoke: InvokeFn
  worktree: Worktree
  backend: Backend
}): Promise<Session> {
  const sessionsData = await invoke<WorktreeSessions>('get_sessions', {
    worktreeId: worktree.id,
    worktreePath: worktree.path,
  })
  if (sessionsData.sessions[0]) {
    return sessionsData.sessions[0]
  }
  return await invoke<Session>('create_session', {
    worktreeId: worktree.id,
    worktreePath: worktree.path,
    backend,
  })
}

export interface ExecuteAgentHarnessFanoutParams {
  projectId: string
  sourceBaseBranch?: string
  targetBackends: Backend[]
  snapshot: PendingInputSnapshot
  executionMode: ExecutionMode
  selectedThinkingLevel: ThinkingLevel
  selectedEffortLevel: EffortLevel
  selectedProvider: string | null
  currentModel: string
  preferences?: FanoutPreferences
  sourceHasUncommittedChanges: boolean
  invoke: InvokeFn
  listen: ListenFn
  sendMessage: (args: FanoutSendMessageArgs) => void
  clearSnapshot: (snapshot: PendingInputSnapshot) => void
  onDirtyWarning: () => void
  onWorktreeReady: (worktree: Worktree) => void
  onSessionPrepared: (args: {
    worktree: Worktree
    session: Session
    backend: Backend
    model: string
    provider: string | null
    executionMode: ExecutionMode
  }) => void
  resolveCustomProfile: (
    model: string,
    provider: string | null
  ) => { model: string; customProfileName?: string }
  getMcpConfig: (backend: Backend) => string | undefined
  resolveParallelExecutionPrompt: (sessionId: string) => string | undefined
  timeoutMs?: number
}

interface FanoutSendMessageArgs {
  sessionId: string
  worktreeId: string
  worktreePath: string
  message: string
  model: string
  executionMode: ExecutionMode
  thinkingLevel: ThinkingLevel
  effortLevel?: EffortLevel
  parallelExecutionPrompt?: string
  aiLanguage?: string
  mcpConfig?: string
  chromeEnabled: boolean
  customProfileName?: string
  backend: Backend
}

export async function executeAgentHarnessFanout({
  projectId,
  sourceBaseBranch,
  targetBackends,
  snapshot,
  executionMode,
  selectedThinkingLevel,
  selectedEffortLevel,
  selectedProvider,
  currentModel,
  preferences,
  sourceHasUncommittedChanges,
  invoke,
  listen,
  sendMessage,
  clearSnapshot,
  onDirtyWarning,
  onWorktreeReady,
  onSessionPrepared,
  resolveCustomProfile,
  getMcpConfig,
  resolveParallelExecutionPrompt,
  timeoutMs = 120_000,
}: ExecuteAgentHarnessFanoutParams): Promise<void> {
  const backends = uniqueBackends(targetBackends)
  if (backends.length === 0) return

  if (sourceHasUncommittedChanges) {
    onDirtyWarning()
  }

  const message = buildMessageWithPendingRefs(snapshot)
  clearSnapshot(snapshot)

  await Promise.all(
    backends.map(async backend => {
      const pendingWorktree = await invoke<Worktree>('create_worktree', {
        projectId,
        ...(sourceBaseBranch ? { baseBranch: sourceBaseBranch } : {}),
      })
      const worktree = await waitForWorktreeReady({
        pendingWorktree,
        listen,
        timeoutMs,
      })
      onWorktreeReady(worktree)

      const session = await getOrCreateInitialSession({
        invoke,
        worktree,
        backend,
      })
      const model = getDefaultModelForBackend(
        backend,
        preferences,
        currentModel
      )
      const provider =
        selectedProvider && selectedProvider !== '__anthropic__'
          ? selectedProvider
          : null
      const resolved = resolveCustomProfile(model, provider)
      const thinkingLevel: ThinkingLevel =
        backend === 'codex' ? 'off' : selectedThinkingLevel
      const effortLevel: EffortLevel | undefined =
        backend === 'codex' ? selectedEffortLevel : undefined

      await invoke('update_session_state', {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        sessionId: session.id,
        selectedExecutionMode: executionMode,
      })
      await invoke('set_session_backend', {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        sessionId: session.id,
        backend,
      })
      await invoke('set_session_model', {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        sessionId: session.id,
        model: resolved.model,
      })
      await invoke('set_session_provider', {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        sessionId: session.id,
        provider,
      })

      onSessionPrepared({
        worktree,
        session,
        backend,
        model: resolved.model,
        provider,
        executionMode,
      })

      sendMessage({
        sessionId: session.id,
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        message,
        model: resolved.model,
        executionMode,
        thinkingLevel,
        effortLevel,
        parallelExecutionPrompt: resolveParallelExecutionPrompt(session.id),
        aiLanguage: preferences?.ai_language,
        mcpConfig: getMcpConfig(backend),
        chromeEnabled: preferences?.chrome_enabled ?? false,
        customProfileName: resolved.customProfileName,
        backend,
      })
    })
  )
}

interface UseAgentHarnessFanoutParams {
  projectId: string | undefined
  sourceBaseBranch: string | undefined
  sourceHasUncommittedChanges: boolean
  getPendingInputSnapshot: () => PendingInputSnapshot | null
  clearPendingInputSnapshot: (snapshot: PendingInputSnapshot) => void
  executionModeRef: RefObject<ExecutionMode>
  selectedThinkingLevelRef: RefObject<ThinkingLevel>
  selectedEffortLevelRef: RefObject<EffortLevel>
  selectedProviderRef: RefObject<string | null>
  selectedModelRef: RefObject<string>
  mcpServersDataRef: RefObject<McpServerInfo[] | undefined>
  enabledMcpServersRef: RefObject<string[]>
  preferences: AppPreferences | undefined
  queryClient: QueryClient
  sendMessage: { mutate: (args: FanoutSendMessageArgs) => void }
  resolveCustomProfile: (
    model: string,
    provider: string | null
  ) => { model: string; customProfileName?: string }
}

export function useAgentHarnessFanout({
  projectId,
  sourceBaseBranch,
  sourceHasUncommittedChanges,
  getPendingInputSnapshot,
  clearPendingInputSnapshot,
  executionModeRef,
  selectedThinkingLevelRef,
  selectedEffortLevelRef,
  selectedProviderRef,
  selectedModelRef,
  mcpServersDataRef,
  enabledMcpServersRef,
  preferences,
  queryClient,
  sendMessage,
  resolveCustomProfile,
}: UseAgentHarnessFanoutParams) {
  return useCallback(
    async (targetBackends: Backend[]) => {
      if (!projectId) return
      const snapshot = getPendingInputSnapshot()
      if (!snapshot) return

      const backends = uniqueBackends(targetBackends)
      if (backends.length === 0) return

      const toastId = toast.loading(
        `Creating ${backends.length} harness worktree${backends.length === 1 ? '' : 's'}...`
      )

      try {
        await executeAgentHarnessFanout({
          projectId,
          sourceBaseBranch,
          targetBackends: backends,
          snapshot,
          executionMode: executionModeRef.current,
          selectedThinkingLevel: selectedThinkingLevelRef.current,
          selectedEffortLevel: selectedEffortLevelRef.current,
          selectedProvider: selectedProviderRef.current,
          currentModel: selectedModelRef.current,
          preferences,
          sourceHasUncommittedChanges,
          invoke,
          listen,
          sendMessage: args => sendMessage.mutate(args),
          clearSnapshot: clearPendingInputSnapshot,
          onDirtyWarning: () => {
            toast.warning(
              'Fan-out worktrees start from committed branch state; uncommitted changes are not copied.'
            )
          },
          onWorktreeReady: worktree => {
            const store = useChatStore.getState()
            store.registerWorktreePath(worktree.id, worktree.path)
            queryClient.setQueryData<Worktree>(
              [...projectsQueryKeys.all, 'worktree', worktree.id],
              worktree
            )
          },
          onSessionPrepared: ({
            worktree,
            session,
            backend,
            model,
            provider,
            executionMode,
          }) => {
            const store = useChatStore.getState()
            store.setActiveSession(worktree.id, session.id, {
              markOpened: false,
            })
            store.addUserInitiatedSession(session.id)
            store.setExecutionMode(session.id, executionMode)
            store.setLastSentMessage(
              session.id,
              buildMessageWithPendingRefs(snapshot)
            )
            store.setError(session.id, null)
            store.setSelectedBackend(session.id, backend)
            store.setSelectedModel(session.id, model)
            store.setSelectedProvider(session.id, provider)
            store.setExecutingMode(session.id, executionMode)

            queryClient.setQueryData<Session>(
              chatQueryKeys.session(session.id),
              {
                ...session,
                backend,
                selected_model: model,
                selected_provider: provider ?? undefined,
                selected_execution_mode: executionMode,
              }
            )
            queryClient.setQueryData<WorktreeSessions>(
              chatQueryKeys.sessions(worktree.id),
              old =>
                old ?? {
                  worktree_id: worktree.id,
                  active_session_id: session.id,
                  sessions: [session],
                  version: 2,
                }
            )
          },
          resolveCustomProfile,
          getMcpConfig: backend =>
            buildMcpConfigJson(
              mcpServersDataRef.current ?? [],
              enabledMcpServersRef.current,
              backend
            ),
          resolveParallelExecutionPrompt: sessionId =>
            resolveParallelExecutionPromptForSession(sessionId, preferences),
        })

        toast.success(
          `Prompt sent to ${backends.length} harness worktree${backends.length === 1 ? '' : 's'}`,
          { id: toastId }
        )
      } catch (error) {
        logger.error('[agent-harness-fanout] failed', { error })
        toast.error(`Harness fan-out failed: ${error}`, { id: toastId })
      }
    },
    [
      projectId,
      sourceBaseBranch,
      sourceHasUncommittedChanges,
      getPendingInputSnapshot,
      clearPendingInputSnapshot,
      executionModeRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      selectedProviderRef,
      selectedModelRef,
      preferences,
      queryClient,
      sendMessage,
      resolveCustomProfile,
      mcpServersDataRef,
      enabledMcpServersRef,
    ]
  )
}
