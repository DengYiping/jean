import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  invoke,
  useWsConnectionStatus,
  useWsDataReady,
  setWsDataReady,
  useWsAuthError,
  preloadInitialData,
  refetchInitialData,
  consumeReconnectData,
  setAppDataDir,
  hasPreloadedData,
  type InitialData,
} from '@/lib/transport'
import { isNativeApp } from '@/lib/environment'
import { projectsQueryKeys } from '@/services/projects'
import { chatQueryKeys } from '@/services/chat'
import type {
  ChatMessage,
  EffortLevel,
  Session,
  ThinkingLevel,
  WorktreeSessions,
} from '@/types/chat'
import { initializeCommandSystem } from './lib/commands'
import { logger } from './lib/logger'
import { toast } from 'sonner'
import { cleanupOldFiles } from './lib/recovery'
import './App.css'
import MainWindow from './components/layout/MainWindow'
import { ThemeProvider } from './components/ThemeProvider'
import ErrorBoundary from './components/ErrorBoundary'
import { useClaudeCliStatus, useClaudeCliAuth } from './services/claude-cli'
import { useCodexCliStatus, useCodexCliAuth } from './services/codex-cli'
import {
  useGhCliStatus,
  useGhCliAuth,
  useGhCliAccounts,
} from './services/gh-cli'
import {
  useOpencodeCliStatus,
  useOpencodeCliAuth,
} from './services/opencode-cli'
import { useUIStore } from './store/ui-store'
import type { AppPreferences } from './types/preferences'
import { useChatStore } from './store/chat-store'
import { useProjectsStore } from './store/projects-store'
import { useFontSettings } from './hooks/use-font-settings'
import { useZoom } from './hooks/use-zoom'
import { useImmediateSessionStateSave } from './hooks/useImmediateSessionStateSave'
import { useCliVersionCheck } from './hooks/useCliVersionCheck'
import { useQueueProcessor } from './hooks/useQueueProcessor'
import { useBackgroundInvestigation } from './hooks/useBackgroundInvestigation'
import { useAutoArchiveOnMerge } from './hooks/useAutoArchiveOnMerge'
import { useMagicPromptAutoDefaults } from './hooks/useMagicPromptAutoDefaults'
import useStreamingEvents from './components/chat/hooks/useStreamingEvents'
import { hydrateRunningSnapshot } from './lib/hydrate-running-snapshot'
import { preloadAllSounds } from './lib/sounds'
import { applyCliImportNavigation } from './lib/cli-import'
import {
  applyCliYoloNavigation,
  resolveCliYoloExecutionConfig,
} from './lib/cli-yolo'
import {
  beginSessionStateHydration,
  endSessionStateHydration,
} from './lib/session-state-hydration'
import { scheduleIdleWork } from './lib/idle'
import { checkWebClientVersion } from './lib/web-client-version'
import type {
  CliImportedProjectResult,
  CliYoloSessionResult,
  PendingCliImportRequest,
  PendingCliYoloRequest,
} from './types/projects'
import { defaultPreferences } from './types/preferences'

/** Loading screen shown while preloading initial data (browser mode only). */
function WebLoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  )
}

/** Full-screen auth error overlay for web access mode. */
function WsAuthErrorOverlay() {
  const authError = useWsAuthError()

  if (!authError) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-lg border border-destructive/50 bg-background p-6 shadow-lg">
        <div className="flex items-center gap-2 text-destructive">
          <svg
            className="size-5 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <h2 className="text-sm font-semibold">Connection Failed</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{authError}</p>
      </div>
    </div>
  )
}

function WsReconnectingOverlay() {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <div className="text-sm font-medium">Reconnecting...</div>
        <div className="text-xs text-muted-foreground">
          Reloading session state
        </div>
      </div>
    </div>
  )
}

function getRunningAssistantMessage(
  session: Session | undefined
): ChatMessage | null {
  const lastMessage = session?.messages.at(-1)
  if (
    lastMessage?.role === 'assistant' &&
    lastMessage.id.startsWith('running-')
  ) {
    return lastMessage
  }
  return null
}

function App() {
  // Track preloading state for web view
  const [isPreloading, setIsPreloading] = useState(!isNativeApp())
  const queryClient = useQueryClient()

  // Holds the update object so the title bar indicator can trigger install later
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingUpdateRef = useRef<any>(null)

  const installAppUpdate = useCallback(
    async (update: {
      version: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      downloadAndInstall: (cb: (event: any) => void) => Promise<void>
    }) => {
      let totalBytes = 0
      let downloadedBytes = 0
      const toastId = toast.loading(`Downloading update ${update.version}...`)

      // Clear the pending indicator since we're installing now
      useUIStore.getState().setPendingUpdateVersion(null)
      pendingUpdateRef.current = null

      try {
        await update.downloadAndInstall(event => {
          switch (event.event) {
            case 'Started':
              totalBytes = event.data.contentLength ?? 0
              logger.info(`Downloading ${totalBytes} bytes`)
              break
            case 'Progress':
              downloadedBytes += event.data.chunkLength
              if (totalBytes > 0) {
                const percent = Math.round((downloadedBytes / totalBytes) * 100)
                toast.loading(`Downloading update... ${percent}%`, {
                  id: toastId,
                })
              }
              break
            case 'Finished':
              logger.info('Download complete, installing...')
              toast.loading('Installing update...', { id: toastId })
              break
          }
        })

        toast.success(`Update ${update.version} installed!`, {
          id: toastId,
          duration: Infinity,
          action: {
            label: 'Restart',
            onClick: async () => {
              const { relaunch } = await import('@tauri-apps/plugin-process')
              await relaunch()
            },
          },
        })
      } catch (updateError) {
        const errorStr = String(updateError)
        logger.error(`Update installation failed: ${errorStr}`)
        if (errorStr.includes('invalid updater binary format')) {
          toast.error(
            `Auto-update not supported for this installation type. Please update manually.`,
            { id: toastId, duration: 8000 }
          )
        } else {
          toast.error(`Update failed: ${errorStr}`, {
            id: toastId,
            duration: 8000,
          })
        }
      }
    },
    []
  )

  // Seed TanStack Query cache and Zustand state from bulk initial data.
  // Used on both initial preload and WebSocket reconnect.
  const seedCache = useCallback(
    (data: InitialData) => {
      const runningSessionIds = new Set(data.runningSessions ?? [])
      const runningSnapshotMessages: {
        sessionId: string
        message: Session['messages'][number]
      }[] = []

      // Seed projects into TanStack Query cache
      if (data.projects) {
        queryClient.setQueryData(projectsQueryKeys.list(), data.projects)
      }
      // Seed worktrees for each project
      if (data.worktreesByProject) {
        for (const [projectId, worktrees] of Object.entries(
          data.worktreesByProject
        )) {
          queryClient.setQueryData(
            projectsQueryKeys.worktrees(projectId),
            worktrees
          )
        }
      }
      // Seed sessions for each worktree (WorktreeSessions struct)
      // Also restore Zustand state for reviewing/waiting status
      if (data.sessionsByWorktree) {
        const reviewingUpdates: Record<string, boolean> = {}
        const waitingUpdates: Record<string, boolean> = {}
        const parallelExecutionPromptUpdates: Record<string, boolean> = {}
        const sessionMappings: Record<string, string> = {}
        const worktreePaths: Record<string, string> = {}

        for (const [worktreeId, sessionsData] of Object.entries(
          data.sessionsByWorktree
        )) {
          queryClient.setQueryData(
            chatQueryKeys.sessions(worktreeId),
            sessionsData
          )

          // Extract session state for Zustand store
          const wts = sessionsData as WorktreeSessions
          for (const session of wts.sessions) {
            sessionMappings[session.id] = worktreeId
            if (session.is_reviewing) {
              reviewingUpdates[session.id] = true
            }
            if (session.waiting_for_input) {
              waitingUpdates[session.id] = true
            }
            if (session.parallel_execution_prompt_enabled !== undefined) {
              parallelExecutionPromptUpdates[session.id] =
                session.parallel_execution_prompt_enabled
            }
          }
        }

        // Get worktree paths from worktreesByProject
        if (data.worktreesByProject) {
          for (const worktrees of Object.values(data.worktreesByProject)) {
            for (const wt of worktrees as { id: string; path: string }[]) {
              if (wt.id && wt.path) {
                worktreePaths[wt.id] = wt.path
              }
            }
          }
        }

        // Update Zustand store with session state
        const currentState = useChatStore.getState()
        const storeUpdates: Partial<ReturnType<typeof useChatStore.getState>> =
          {}

        if (Object.keys(sessionMappings).length > 0) {
          storeUpdates.sessionWorktreeMap = {
            ...currentState.sessionWorktreeMap,
            ...sessionMappings,
          }
        }
        if (Object.keys(worktreePaths).length > 0) {
          storeUpdates.worktreePaths = {
            ...currentState.worktreePaths,
            ...worktreePaths,
          }
        }
        if (runningSessionIds.size > 0) {
          storeUpdates.reviewingSessions = Object.fromEntries(
            Object.entries(reviewingUpdates).filter(
              ([sessionId]) => !runningSessionIds.has(sessionId)
            )
          )
          storeUpdates.waitingForInputSessionIds = Object.fromEntries(
            Object.entries(waitingUpdates).filter(
              ([sessionId]) => !runningSessionIds.has(sessionId)
            )
          )
        } else {
          storeUpdates.reviewingSessions = reviewingUpdates
          storeUpdates.waitingForInputSessionIds = waitingUpdates
        }
        // Replace (not merge) reviewing/waiting state — server is source of truth.
        // Merging would keep stale entries from sessions that changed while disconnected.
        if (Object.keys(parallelExecutionPromptUpdates).length > 0) {
          storeUpdates.parallelExecutionPromptEnabledBySession = {
            ...currentState.parallelExecutionPromptEnabledBySession,
            ...parallelExecutionPromptUpdates,
          }
        }
        if (Object.keys(storeUpdates).length > 0) {
          beginSessionStateHydration()
          try {
            useChatStore.setState(storeUpdates)
          } finally {
            endSessionStateHydration()
          }
        }
      }
      // Seed active sessions with the server-provided init snapshot.
      // /api/init may return a bounded window for fast reconnect/first paint,
      // so truncated sessions are immediately marked stale for a background
      // full-history refetch when the session view mounts.
      // Use function updater to avoid overwriting cache that has MORE messages
      // (e.g., from chat:done upsert that arrived before this reconnect seed).
      if (data.activeSessions) {
        const truncatedSessionIds: string[] = []
        for (const [sessionId, initSession] of Object.entries(
          data.activeSessions
        )) {
          const init = initSession as Session
          queryClient.setQueryData<Session>(
            chatQueryKeys.session(sessionId),
            old => {
              if (!old) return init
              if (old.messages.length > init.messages.length) {
                logger.warn('[seedCache] preserving cached messages', {
                  sessionId,
                  cachedCount: old.messages.length,
                  initCount: init.messages.length,
                })
                return { ...init, messages: old.messages }
              }
              return init
            }
          )

          if (runningSessionIds.has(sessionId)) {
            const sessionSnapshot = queryClient.getQueryData<Session>(
              chatQueryKeys.session(sessionId)
            )
            const runningMessage = getRunningAssistantMessage(sessionSnapshot)

            if (runningMessage) {
              runningSnapshotMessages.push({
                sessionId,
                message: runningMessage,
              })
            }
          }

          if ((init.loaded_run_start_index ?? 0) > 0) {
            truncatedSessionIds.push(sessionId)
          }
        }

        for (const sessionId of truncatedSessionIds) {
          void queryClient.invalidateQueries({
            queryKey: chatQueryKeys.session(sessionId),
            refetchType: 'active',
          })
        }
      }
      // Replace sendingSessionIds with exactly the server's running sessions.
      // This clears sessions that finished while disconnected and restores
      // sessions that are still running — server is source of truth.
      const runningSendingIds: Record<string, boolean> = {}
      if (data.runningSessions?.length) {
        for (const sessionId of data.runningSessions) {
          runningSendingIds[sessionId] = true
        }
      }
      useChatStore.setState(state => {
        const current = state.sendingSessionIds
        // Check if anything actually changed to avoid unnecessary re-renders
        const currentKeys = Object.keys(current)
        const newKeys = Object.keys(runningSendingIds)
        if (
          currentKeys.length === newKeys.length &&
          newKeys.every(k => current[k])
        ) {
          return state
        }
        return { sendingSessionIds: runningSendingIds }
      })
      for (const { sessionId, message } of runningSnapshotMessages) {
        hydrateRunningSnapshot(sessionId, message, {
          allowWhileSending: true,
        })
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(sessionId),
          old =>
            old
              ? {
                  ...old,
                  messages: old.messages.filter(
                    existingMessage => existingMessage.id !== message.id
                  ),
                }
              : old
        )
      }
      // Note: Git status is included in worktree cached_* fields, no separate cache needed
      // Seed preferences into cache
      if (data.preferences) {
        queryClient.setQueryData(['preferences'], data.preferences)
      }
      // Seed UI state into cache
      if (data.uiState) {
        queryClient.setQueryData(['ui-state'], data.uiState)
      }
      // Cache app data dir for browser-mode file URL conversion
      if (data.appDataDir) {
        setAppDataDir(data.appDataDir)
      }
    },
    [queryClient]
  )

  // Preload initial data via HTTP for web view (faster than waiting for WebSocket)
  useEffect(() => {
    if (isNativeApp()) return

    const initialSelectedProjectId =
      useProjectsStore.getState().selectedProjectId
    preloadInitialData(initialSelectedProjectId)
      .then(data => {
        if (data) {
          logger.info('Preloaded initial data via HTTP', {
            projects: Array.isArray(data.projects) ? data.projects.length : 0,
          })
          checkWebClientVersion(data)
          seedCache(data)
          setWsDataReady(true)
        }
      })
      .catch(err => {
        logger.warn('Failed to preload initial data', { error: err })
      })
      .finally(() => {
        setIsPreloading(false)
      })
  }, [queryClient, seedCache])

  // Global safety net for uncaught async errors / promise rejections.
  // Without this, a thrown invoke() (e.g. auth/network failure) can leave the
  // app in a half-broken state until the next ErrorBoundary catches it.
  useEffect(() => {
    const truncate = (s: string, n: number) =>
      s.length > n ? `${s.slice(0, n)}…` : s

    const isAlreadySurfacedAuthError = (msg: string): boolean => {
      const lower = msg.toLowerCase()
      return (
        lower.includes('not authenticated') ||
        lower.includes('unauthorized') ||
        lower.includes('connection failed')
      )
    }

    const isTransientTransportError = (msg: string): boolean => {
      return msg.includes('WebSocket disconnected')
    }

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Unknown error'
      logger.error('Unhandled promise rejection', {
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
      })
      if (
        !isAlreadySurfacedAuthError(message) &&
        !isTransientTransportError(message)
      ) {
        toast.error(`Unexpected error: ${truncate(message, 200)}`)
      }
      event.preventDefault()
    }

    const handleError = (event: ErrorEvent) => {
      const message = event.error?.message ?? event.message ?? 'Unknown error'
      logger.error('Uncaught window error', {
        message,
        stack: event.error?.stack,
        filename: event.filename,
      })
      if (
        !isAlreadySurfacedAuthError(message) &&
        !isTransientTransportError(message)
      ) {
        toast.error(`Unexpected error: ${truncate(message, 200)}`)
      }
    }

    window.addEventListener('unhandledrejection', handleRejection)
    window.addEventListener('error', handleError)
    return () => {
      window.removeEventListener('unhandledrejection', handleRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])

  // Apply font settings from preferences
  useFontSettings()

  // Apply zoom level from preferences + keyboard shortcuts
  useZoom()

  // Save reviewing/waiting state immediately (no debounce) to ensure persistence on reload
  useImmediateSessionStateSave()

  // Check for CLI updates on startup (shows toast notification if updates available)
  useCliVersionCheck()

  // Global streaming event listeners - must be at App level so they stay active
  // even when ChatWindow is unmounted (e.g., when viewing a different worktree)
  useStreamingEvents({ queryClient })

  // Global queue processor - must be at App level so queued messages execute
  // even when the worktree is not focused (ChatWindow unmounted)
  useQueueProcessor()

  // Headless background investigation - starts investigations on background
  // worktrees (CMD+Click) without opening the session modal
  useBackgroundInvestigation()

  // Auto-archive worktrees when their PR is merged (if enabled in preferences)
  useAutoArchiveOnMerge()

  // One-time: detect installed backends and set magic prompt defaults accordingly
  useMagicPromptAutoDefaults()

  // When WebSocket connects (browser mode), reload state.
  // On first connect: invalidate non-preloaded queries.
  // On reconnect: re-fetch bulk data via HTTP to restore everything fast.
  const wsConnected = useWsConnectionStatus()
  const wsDataReady = useWsDataReady()
  const wsAuthError = useWsAuthError()
  const hadWsConnectionRef = useRef(false)
  useEffect(() => {
    if (isNativeApp() || !wsConnected) return

    const reconnected = hadWsConnectionRef.current
    hadWsConnectionRef.current = true

    if (reconnected) {
      // Try to use the prefetch that was started during the backoff wait.
      // Falls back to a fresh fetch with the browser's active session IDs
      // so the server loads the correct sessions even when ui_state.json
      // on disk is stale (debounced save hasn't flushed yet).
      const activeSessionIds = useChatStore.getState().activeSessionIds
      const prefetch = consumeReconnectData()
      const selectedProjectId = useProjectsStore.getState().selectedProjectId
      const dataPromise =
        prefetch ?? refetchInitialData(activeSessionIds, selectedProjectId)
      logger.info('WebSocket reconnected, re-fetching initial data via HTTP', {
        prefetched: !!prefetch,
      })
      dataPromise
        .then(data => {
          if (data) {
            checkWebClientVersion(data)
            seedCache(data)
            logger.info('Reconnect: re-seeded cache from HTTP')
            setWsDataReady(true)
            // Invalidate non-preloaded queries after a frame so the seeded
            // cache renders first (prevents flash of stale → fresh data).
            requestAnimationFrame(() => {
              queryClient.invalidateQueries({
                predicate: query => {
                  const key = query.queryKey[0]
                  return (
                    key !== 'projects' &&
                    key !== 'preferences' &&
                    key !== 'ui-state' &&
                    key !== 'chat'
                  )
                },
              })
            })
          } else {
            // HTTP fetch returned null (server not ready yet) — invalidate
            // everything so TanStack Query refetches via WebSocket.
            logger.warn(
              'Reconnect: HTTP re-fetch returned no data, invalidating all queries'
            )
            setWsDataReady(true)
            queryClient.invalidateQueries()
          }
        })
        .catch(err => {
          logger.warn(
            'Reconnect: HTTP re-fetch failed, falling back to query invalidation',
            { error: err }
          )
          setWsDataReady(true)
          // Fallback: invalidate everything so TanStack Query refetches via WebSocket
          queryClient.invalidateQueries()
        })
    } else {
      // First connect: mark data ready (preload already seeded the cache)
      // and invalidate non-preloaded queries only.
      setWsDataReady(true)
      logger.info('WebSocket connected, invalidating dynamic queries')
      queryClient.invalidateQueries({
        predicate: query => {
          const key = query.queryKey[0]
          return (
            key !== 'projects' &&
            key !== 'preferences' &&
            key !== 'ui-state' &&
            key !== 'chat'
          )
        },
      })
    }
  }, [wsConnected, queryClient, seedCache])

  // Add native-app class to body for desktop-only CSS (cursor, user-select, etc.)
  useEffect(() => {
    if (isNativeApp()) {
      document.body.classList.add('native-app')
    }
  }, [])

  useEffect(() => {
    if (!isNativeApp()) return

    let cancelled = false
    let inflight = false

    const processPendingImports = async () => {
      if (cancelled || inflight) return
      inflight = true

      try {
        const pendingRequests = await invoke<PendingCliImportRequest[]>(
          'consume_pending_cli_import_requests'
        )
        if (cancelled) return

        if (pendingRequests.length > 0) {
          for (const request of pendingRequests) {
            const result = await invoke<CliImportedProjectResult>(
              'import_project_from_cli_path',
              {
                path: request.path,
              }
            )
            if (cancelled) return

            applyCliImportNavigation(queryClient, result)
            toast.success(
              result.created
                ? `Imported project: ${result.project.name}`
                : `Opened project: ${result.project.name}`
            )
          }
        }

        const pendingYoloRequests = await invoke<PendingCliYoloRequest[]>(
          'consume_pending_cli_yolo_requests'
        )
        if (cancelled) return

        for (const request of pendingYoloRequests) {
          const result = await invoke<CliYoloSessionResult>(
            'prepare_cli_yolo_from_pending_request',
            {
              prompt: request.prompt,
            }
          )
          if (cancelled) return

          applyCliYoloNavigation(queryClient, result)

          const preferences =
            queryClient.getQueryData<AppPreferences>(['preferences']) ??
            defaultPreferences
          const { backend, model, provider, thinkingLevel, effortLevel } =
            resolveCliYoloExecutionConfig({
              sessionBackend: (result.session.backend ??
                preferences.default_backend) as 'claude' | 'codex' | 'opencode',
              preferences,
              projectDefaultProvider: result.project.default_provider,
            })

          const store = useChatStore.getState()
          store.setExecutionMode(result.session.id, 'yolo')
          store.setLastSentMessage(result.session.id, result.prompt)
          store.setError(result.session.id, null)
          store.addSendingSession(result.session.id)
          store.setSelectedModel(result.session.id, model)
          store.setSelectedBackend(result.session.id, backend)
          store.setSelectedProvider(result.session.id, provider)
          store.setThinkingLevel(
            result.session.id,
            thinkingLevel as ThinkingLevel
          )
          if (effortLevel) {
            store.setEffortLevel(result.session.id, effortLevel as EffortLevel)
          }
          store.setExecutingMode(result.session.id, 'yolo')

          queryClient.setQueryData<Session>(
            chatQueryKeys.session(result.session.id),
            old =>
              old
                ? {
                    ...old,
                    backend,
                    selected_execution_mode: 'yolo',
                    selected_model: model,
                    selected_provider: provider ?? undefined,
                    selected_thinking_level: thinkingLevel,
                    selected_effort_level: effortLevel,
                  }
                : {
                    ...result.session,
                    backend,
                    selected_execution_mode: 'yolo',
                    selected_model: model,
                    selected_provider: provider ?? undefined,
                    selected_thinking_level: thinkingLevel,
                    selected_effort_level: effortLevel,
                  }
          )

          await invoke('update_session_state', {
            worktreeId: result.worktree.id,
            worktreePath: result.worktree.path,
            sessionId: result.session.id,
            selectedExecutionMode: 'yolo',
          })

          await invoke('set_session_model', {
            worktreeId: result.worktree.id,
            worktreePath: result.worktree.path,
            sessionId: result.session.id,
            model,
          })

          await invoke('set_session_backend', {
            worktreeId: result.worktree.id,
            worktreePath: result.worktree.path,
            sessionId: result.session.id,
            backend,
          })

          await invoke('set_session_provider', {
            worktreeId: result.worktree.id,
            worktreePath: result.worktree.path,
            sessionId: result.session.id,
            provider,
          })

          if (backend !== 'codex') {
            await invoke('set_session_thinking_level', {
              worktreeId: result.worktree.id,
              worktreePath: result.worktree.path,
              sessionId: result.session.id,
              thinkingLevel,
            })
          }

          if (effortLevel) {
            await invoke('set_session_effort_level', {
              worktreeId: result.worktree.id,
              worktreePath: result.worktree.path,
              sessionId: result.session.id,
              effortLevel,
            })
          }

          await invoke('send_chat_message', {
            sessionId: result.session.id,
            worktreeId: result.worktree.id,
            worktreePath: result.worktree.path,
            message: result.prompt,
            model,
            executionMode: 'yolo',
            thinkingLevel,
            effortLevel,
            parallelExecutionPrompt: undefined,
            aiLanguage: preferences.ai_language,
            mcpConfig: undefined,
            chromeEnabled: preferences.chrome_enabled,
            customProfileName: provider ?? undefined,
            backend,
          })

          toast.success(`Started yolo in ${result.project.name}`)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          logger.error('Failed to process desktop CLI request', { error })
          toast.error('Failed to process desktop CLI request', {
            description: message,
          })
        }
      } finally {
        inflight = false
      }
    }

    void processPendingImports()
    const intervalId = window.setInterval(() => {
      void processPendingImports()
    }, 750)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [queryClient])

  const [cliCheckReady, setCliCheckReady] = useState(false)
  useEffect(() => {
    if (!isNativeApp()) return
    return scheduleIdleWork(() => setCliCheckReady(true), 2000)
  }, [])

  // Check CLI installation status after the first paint.
  const { data: claudeStatus, isLoading: isClaudeStatusLoading } =
    useClaudeCliStatus({ enabled: cliCheckReady && isNativeApp() })
  const { data: codexStatus, isLoading: isCodexStatusLoading } =
    useCodexCliStatus({ enabled: cliCheckReady && isNativeApp() })
  const { data: opencodeStatus, isLoading: isOpencodeStatusLoading } =
    useOpencodeCliStatus({ enabled: cliCheckReady && isNativeApp() })
  const { data: ghStatus, isLoading: isGhStatusLoading } = useGhCliStatus({
    enabled: cliCheckReady && isNativeApp(),
  })

  // Check CLI authentication status (only when installed)
  const { data: claudeAuth, isLoading: isClaudeAuthLoading } = useClaudeCliAuth(
    { enabled: cliCheckReady && !!claudeStatus?.installed && isNativeApp() }
  )
  const { data: codexAuth, isLoading: isCodexAuthLoading } = useCodexCliAuth({
    enabled: cliCheckReady && !!codexStatus?.installed && isNativeApp(),
  })
  const { data: opencodeAuth, isLoading: isOpencodeAuthLoading } =
    useOpencodeCliAuth({
      enabled: cliCheckReady && !!opencodeStatus?.installed && isNativeApp(),
    })
  const { data: ghAuth, isLoading: isGhAuthLoading } = useGhCliAuth({
    enabled: cliCheckReady && !!ghStatus?.installed && isNativeApp(),
  })
  useGhCliAccounts({
    enabled: cliCheckReady && !!ghStatus?.installed && isNativeApp(),
  })

  // Show onboarding if GitHub CLI is not ready, or no AI backend is ready.
  // Only in native app - web view uses the desktop's CLIs via WebSocket
  useEffect(() => {
    if (!isNativeApp()) return
    if (!cliCheckReady) return

    // Wait until the status queries have actually resolved before deciding.
    if (!claudeStatus || !codexStatus || !opencodeStatus || !ghStatus) return

    const isLoading =
      isClaudeStatusLoading ||
      isCodexStatusLoading ||
      isOpencodeStatusLoading ||
      isGhStatusLoading ||
      (claudeStatus?.installed && isClaudeAuthLoading) ||
      (codexStatus?.installed && isCodexAuthLoading) ||
      (opencodeStatus?.installed && isOpencodeAuthLoading) ||
      (ghStatus?.installed && isGhAuthLoading)
    if (isLoading) return

    const ghReady = !!ghStatus?.installed && !!ghAuth?.authenticated
    const claudeReady = !!claudeStatus?.installed && !!claudeAuth?.authenticated
    const codexReady = !!codexStatus?.installed && !!codexAuth?.authenticated
    const opencodeReady =
      !!opencodeStatus?.installed && !!opencodeAuth?.authenticated
    const hasAiBackendReady = claudeReady || codexReady || opencodeReady

    if (useUIStore.getState().onboardingDismissed) return

    if (!ghReady || !hasAiBackendReady) {
      logger.info('CLI setup needed, showing onboarding', {
        claudeInstalled: claudeStatus?.installed,
        codexInstalled: codexStatus?.installed,
        opencodeInstalled: opencodeStatus?.installed,
        ghInstalled: ghStatus?.installed,
        claudeAuth: claudeAuth?.authenticated,
        codexAuth: codexAuth?.authenticated,
        opencodeAuth: opencodeAuth?.authenticated,
        ghAuth: ghAuth?.authenticated,
      })
      useUIStore.getState().setOnboardingOpen(true)
    } else {
      // CLIs already set up — show feature tour if not yet seen
      const prefs = queryClient.getQueryData<AppPreferences>(['preferences'])
      if (prefs && !prefs.has_seen_feature_tour) {
        useUIStore.getState().setFeatureTourOpen(true)
      }
    }
  }, [
    claudeStatus,
    codexStatus,
    opencodeStatus,
    ghStatus,
    claudeAuth,
    codexAuth,
    opencodeAuth,
    ghAuth,
    isClaudeStatusLoading,
    isCodexStatusLoading,
    isOpencodeStatusLoading,
    isGhStatusLoading,
    isClaudeAuthLoading,
    isCodexAuthLoading,
    isOpencodeAuthLoading,
    isGhAuthLoading,
    cliCheckReady,
    queryClient,
  ])

  // Show feature tour after CLI onboarding completes (first launch or manual trigger)
  useEffect(() => {
    let wasOpen = useUIStore.getState().onboardingOpen
    const unsub = useUIStore.subscribe(state => {
      const isOpen = state.onboardingOpen
      const prevWasOpen = wasOpen
      wasOpen = isOpen // Update FIRST to prevent re-entrant loops from synchronous setState
      if (prevWasOpen && !isOpen) {
        const store = useUIStore.getState()
        // Don't show feature tour if user dismissed onboarding without completing setup
        if (store.onboardingDismissed) {
          store.setOnboardingManuallyTriggered(false)
        } else {
          const manuallyTriggered = store.onboardingManuallyTriggered
          const prefs = queryClient.getQueryData<AppPreferences>([
            'preferences',
          ])
          if (manuallyTriggered || (prefs && !prefs.has_seen_feature_tour)) {
            store.setOnboardingManuallyTriggered(false)
            setTimeout(() => {
              useUIStore.getState().setFeatureTourOpen(true)
            }, 300)
          }
        }
      }
    })
    return unsub
  }, [queryClient])

  // Kill all terminals on page refresh/close (backup for Rust-side cleanup)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Best-effort sync cleanup for refresh scenarios
      // Note: async operations may not complete, but Rust-side RunEvent::Exit
      // will handle proper cleanup on app quit
      invoke('kill_all_terminals').catch(() => {
        /* noop */
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Initialize command system and cleanup on app startup
  useEffect(() => {
    logger.info('🚀 Frontend application starting up')
    initializeCommandSystem()
    logger.debug('Command system initialized')

    // Example of logging with context
    logger.info('App environment', {
      isDev: import.meta.env.DEV,
      mode: import.meta.env.MODE,
    })

    // Auto-updater logic - check for updates 5 seconds after app loads
    const checkForUpdates = async () => {
      if (!isNativeApp()) return
      // Don't re-show modal if user already dismissed an update
      if (useUIStore.getState().pendingUpdateVersion) return

      try {
        const { check } = await import('@tauri-apps/plugin-updater')

        const update = await check()
        if (update) {
          logger.info(`Update available: ${update.version}`)
          pendingUpdateRef.current = update
          useUIStore.getState().setUpdateModalVersion(update.version)
        }
      } catch (checkError) {
        logger.error(`Update check failed: ${String(checkError)}`)
        // Silent fail for update checks - don't bother user with network issues
      }
    }

    // Listen for install trigger from title bar indicator
    const handleInstallPending = () => {
      if (pendingUpdateRef.current) {
        installAppUpdate(pendingUpdateRef.current)
      }
    }
    window.addEventListener('install-pending-update', handleInstallPending)

    // Listen for update object from manual "Check for Updates" menu
    const handleUpdateAvailable = (e: Event) => {
      pendingUpdateRef.current = (e as CustomEvent).detail
    }
    window.addEventListener('update-available', handleUpdateAvailable)

    interface ResumableSession {
      session_id: string
      worktree_id: string
      run_id: string
      user_message: string
      resumable: boolean
      execution_mode: string | null
      started_at: number
    }

    const cancelIdleStartupWork = scheduleIdleWork(() => {
      // Preload notification sounds after the shell is interactive.
      preloadAllSounds()

      // Kill any orphaned terminals from previous session/reload.
      invoke<number>('kill_all_terminals')
        .then(killed => {
          if (killed > 0) {
            logger.info(
              `Cleaned up ${killed} orphaned terminal(s) from previous session`
            )
          }
        })
        .catch(error => {
          logger.warn('Failed to cleanup orphaned terminals', { error })
        })

      // Clean up old recovery files on startup.
      cleanupOldFiles().catch(error => {
        logger.warn('Failed to cleanup old recovery files', { error })
      })

      // Check for and resume any detached sessions that are still running.
      invoke<ResumableSession[]>('check_resumable_sessions')
        .then(async resumable => {
          if (!hasPreloadedData()) {
            queryClient.invalidateQueries({ queryKey: chatQueryKeys.all })
          }

          const { sendingSessionIds, removeSendingSession } =
            useChatStore.getState()
          const resumableIds = new Set(resumable.map(r => r.session_id))
          for (const sessionId of Object.keys(sendingSessionIds)) {
            if (!resumableIds.has(sessionId)) {
              removeSendingSession(sessionId)
            }
          }

          if (resumable.length === 0) return

          logger.info('Found resumable sessions', { count: resumable.length })

          for (const session of resumable) {
            logger.info('Resuming session', {
              session_id: session.session_id,
              worktree_id: session.worktree_id,
            })
            const store = useChatStore.getState()
            store.addSendingSession(
              session.session_id,
              session.started_at * 1000
            )

            let sessionSnapshot = queryClient.getQueryData<Session>(
              chatQueryKeys.session(session.session_id)
            )
            let worktreePath = store.getWorktreePath(session.worktree_id)
            if (!worktreePath) {
              try {
                const worktree = await invoke<{ path: string }>(
                  'get_worktree',
                  {
                    worktreeId: session.worktree_id,
                  }
                )
                if (worktree.path) {
                  worktreePath = worktree.path
                  store.registerWorktreePath(session.worktree_id, worktree.path)
                }
              } catch (error) {
                logger.warn(
                  'Failed to resolve worktree path for resumable run',
                  {
                    session_id: session.session_id,
                    worktree_id: session.worktree_id,
                    error,
                  }
                )
              }
            }
            if (worktreePath) {
              try {
                sessionSnapshot = await invoke<Session>('get_session', {
                  sessionId: session.session_id,
                  worktreeId: session.worktree_id,
                  worktreePath,
                })
                queryClient.setQueryData(
                  chatQueryKeys.session(session.session_id),
                  sessionSnapshot
                )
              } catch (error) {
                logger.warn(
                  'Failed to load session snapshot for resumable run',
                  {
                    session_id: session.session_id,
                    error,
                  }
                )
              }
            }

            const runningMessage = getRunningAssistantMessage(sessionSnapshot)
            if (runningMessage) {
              hydrateRunningSnapshot(session.session_id, runningMessage, {
                allowWhileSending: true,
              })
              queryClient.setQueryData<Session>(
                chatQueryKeys.session(session.session_id),
                old =>
                  old
                    ? {
                        ...old,
                        messages: old.messages.filter(
                          message => message.id !== runningMessage.id
                        ),
                      }
                    : old
              )
            }

            if (session.execution_mode) {
              store.setExecutingMode(
                session.session_id,
                session.execution_mode as 'plan' | 'build' | 'yolo'
              )
            }
            invoke('resume_session', {
              sessionId: session.session_id,
              worktreeId: session.worktree_id,
            }).catch(error => {
              logger.error('Failed to resume session', {
                session_id: session.session_id,
                error,
              })
              useChatStore.getState().removeSendingSession(session.session_id)
            })
          }
        })
        .catch(error => {
          logger.error('Failed to check resumable sessions', { error })
        })
    }, 2500)

    // Check for updates 5 seconds after app loads, then every 30 minutes
    const updateTimer = setTimeout(checkForUpdates, 5000)
    const updateInterval = setInterval(checkForUpdates, 30 * 60 * 1000)
    return () => {
      cancelIdleStartupWork()
      clearTimeout(updateTimer)
      clearInterval(updateInterval)
      window.removeEventListener('install-pending-update', handleInstallPending)
      window.removeEventListener('update-available', handleUpdateAvailable)
    }
  }, [installAppUpdate])

  // Show loading screen while preloading initial data (web view only)
  if (isPreloading) {
    return <WebLoadingScreen />
  }

  const showReconnectOverlay =
    !isNativeApp() && hadWsConnectionRef.current && !wsDataReady && !wsAuthError

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <MainWindow />
        {showReconnectOverlay && <WsReconnectingOverlay />}
        {!isNativeApp() && <WsAuthErrorOverlay />}
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
