import { useCallback, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { buildMcpConfigJson } from '@/services/mcp'
import { resolveBackend, supportsAdaptiveThinking } from '@/lib/model-utils'
import {
  CODEX_DEFAULT_MAGIC_PROMPT_MODELS,
  DEFAULT_MAGIC_PROMPT_MODELS,
  DEFAULT_INVESTIGATE_ISSUE_PROMPT,
  DEFAULT_INVESTIGATE_PR_PROMPT,
  DEFAULT_INVESTIGATE_SECURITY_ALERT_PROMPT,
  DEFAULT_INVESTIGATE_ADVISORY_PROMPT,
  DEFAULT_INVESTIGATE_WORKFLOW_RUN_PROMPT,
  DEFAULT_INVESTIGATE_LINEAR_ISSUE_PROMPT,
  isMagicPromptModelCompatibleWithBackend,
  OPENCODE_DEFAULT_MAGIC_PROMPT_MODELS,
  resolveMagicPromptBackend,
  resolveMagicPromptProvider,
} from '@/types/preferences'
import type { Project, Worktree } from '@/types/projects'
import type {
  ThinkingLevel,
  ExecutionMode,
  Session,
  McpServerInfo,
} from '@/types/chat'
import type { AppPreferences } from '@/types/preferences'
import { resolveParallelExecutionPromptForSession } from '@/lib/parallel-execution-prompt'

// Re-export for the caller
export interface WorkflowRunDetail {
  workflowName: string
  runUrl: string
  runId: string
  branch: string
  displayTitle: string
  projectPath?: string | null
}

interface SendMessageArgs {
  sessionId: string
  worktreeId: string
  worktreePath: string
  message: string
  model?: string
  executionMode?: ExecutionMode
  thinkingLevel?: ThinkingLevel
  effortLevel?: string
  mcpConfig?: string
  customProfileName?: string
  parallelExecutionPrompt?: string
  chromeEnabled?: boolean
  aiLanguage?: string
  backend?: string
}

interface UseInvestigateHandlersParams {
  activeSessionId: string | null | undefined
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  inputRef: RefObject<HTMLTextAreaElement | null>
  preferences: AppPreferences | undefined
  selectedModelRef: RefObject<string>
  selectedThinkingLevelRef: RefObject<ThinkingLevel>
  executionModeRef: RefObject<ExecutionMode>
  mcpServersDataRef: RefObject<McpServerInfo[] | undefined>
  enabledMcpServersRef: RefObject<string[]>
  activeWorktreeIdRef: RefObject<string | null | undefined>
  activeWorktreePathRef: RefObject<string | null | undefined>
  sendMessage: {
    mutate: (args: SendMessageArgs, opts?: { onSettled?: () => void }) => void
    mutateAsync?: (args: SendMessageArgs) => Promise<unknown>
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionProvider: { mutate: (args: any) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionBackend: { mutate: (args: any) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionModel: { mutate: (args: any) => void }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSessionEffortLevel: { mutate: (args: any) => void }
  createSession: {
    mutate: (
      args: { worktreeId: string; worktreePath: string },
      opts?: {
        onSuccess?: (session: { id: string }) => void
        onError?: (error: unknown) => void
      }
    ) => void
    mutateAsync?: (args: {
      worktreeId: string
      worktreePath: string
    }) => Promise<{ id: string }>
  }
  resolveCustomProfile: (
    model: string,
    provider: string | null
  ) => { model: string; customProfileName: string | undefined }
  cliVersion: string | null
  worktreeProjectId: string | null | undefined
}

/**
 * Handles investigate issue/PR and investigate workflow run operations.
 * These are large async callbacks that build prompts from loaded contexts
 * and send investigation messages.
 */
export function useInvestigateHandlers({
  activeSessionId,
  activeWorktreeId,
  activeWorktreePath,
  inputRef,
  preferences,
  selectedModelRef,
  selectedThinkingLevelRef,
  executionModeRef,
  mcpServersDataRef,
  enabledMcpServersRef,
  activeWorktreeIdRef,
  activeWorktreePathRef,
  sendMessage,
  setSessionProvider,
  setSessionBackend,
  setSessionModel,
  setSessionEffortLevel,
  createSession,
  resolveCustomProfile,
  cliVersion,
  worktreeProjectId,
}: UseInvestigateHandlersParams) {
  const queryClient = useQueryClient()

  const handleInvestigate = useCallback(
    async (
      type: 'issue' | 'pr' | 'security-alert' | 'advisory' | 'linear-issue'
    ) => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      const modelKey =
        type === 'issue'
          ? 'investigate_issue_model'
          : type === 'pr'
            ? 'investigate_pr_model'
            : type === 'security-alert'
              ? 'investigate_security_alert_model'
              : type === 'linear-issue'
                ? 'investigate_linear_issue_model'
                : ('investigate_advisory_model' as const)
      const providerKey =
        type === 'issue'
          ? 'investigate_issue_provider'
          : type === 'pr'
            ? 'investigate_pr_provider'
            : type === 'security-alert'
              ? 'investigate_security_alert_provider'
              : type === 'linear-issue'
                ? 'investigate_linear_issue_provider'
                : ('investigate_advisory_provider' as const)
      const effortKey =
        type === 'issue'
          ? 'investigate_issue_effort'
          : type === 'pr'
            ? 'investigate_pr_effort'
            : type === 'security-alert'
              ? 'investigate_security_alert_effort'
              : type === 'linear-issue'
                ? 'investigate_linear_issue_effort'
                : ('investigate_advisory_effort' as const)
      const investigateModel =
        preferences?.magic_prompt_models?.[modelKey] ?? selectedModelRef.current
      const investigateProvider = resolveMagicPromptProvider(
        preferences?.magic_prompt_providers,
        providerKey,
        preferences?.default_provider
      )
      const investigateEffort =
        preferences?.magic_prompt_efforts?.[effortKey] ?? null
      const investigateEffortLevel =
        investigateEffort === 'low' ||
        investigateEffort === 'medium' ||
        investigateEffort === 'high'
          ? investigateEffort
          : undefined
      const { customProfileName: resolvedInvestigateProfile } =
        resolveCustomProfile(investigateModel, investigateProvider)

      let prompt: string

      if (type === 'issue') {
        const contexts = await queryClient.fetchQuery({
          queryKey: ['investigate-contexts', 'issue', activeWorktreeId],
          queryFn: () =>
            invoke<{ number: number }[]>('list_loaded_issue_contexts', {
              sessionId: activeWorktreeId,
            }),
          staleTime: 0,
        })
        if ((contexts ?? []).length === 0) {
          toast.error('No issue context loaded for this worktree')
          return
        }
        const refs = (contexts ?? []).map(c => `#${c.number}`).join(', ')
        const word = (contexts ?? []).length === 1 ? 'issue' : 'issues'
        const customPrompt = preferences?.magic_prompts?.investigate_issue
        const template =
          customPrompt && customPrompt.trim()
            ? customPrompt
            : DEFAULT_INVESTIGATE_ISSUE_PROMPT
        prompt = template
          .replace(/\{issueWord\}/g, word)
          .replace(/\{issueRefs\}/g, refs)
      } else if (type === 'pr') {
        const contexts = await queryClient.fetchQuery({
          queryKey: ['investigate-contexts', 'pr', activeWorktreeId],
          queryFn: () =>
            invoke<{ number: number }[]>('list_loaded_pr_contexts', {
              sessionId: activeWorktreeId,
            }),
          staleTime: 0,
        })
        if ((contexts ?? []).length === 0) {
          toast.error('No PR context loaded for this worktree')
          return
        }
        const refs = (contexts ?? []).map(c => `#${c.number}`).join(', ')
        const word = (contexts ?? []).length === 1 ? 'PR' : 'PRs'
        const customPrompt = preferences?.magic_prompts?.investigate_pr
        const template =
          customPrompt && customPrompt.trim()
            ? customPrompt
            : DEFAULT_INVESTIGATE_PR_PROMPT
        prompt = template
          .replace(/\{prWord\}/g, word)
          .replace(/\{prRefs\}/g, refs)
      } else if (type === 'security-alert') {
        const contexts = await queryClient.fetchQuery({
          queryKey: [
            'investigate-contexts',
            'security-alert',
            activeWorktreeId,
          ],
          queryFn: () =>
            invoke<{ number: number; packageName: string; severity: string }[]>(
              'list_loaded_security_contexts',
              { sessionId: activeWorktreeId }
            ),
          staleTime: 0,
        })
        const refs = (contexts ?? [])
          .map(c => `#${c.number} ${c.packageName} (${c.severity})`)
          .join(', ')
        const word = (contexts ?? []).length === 1 ? 'alert' : 'alerts'
        const customPrompt =
          preferences?.magic_prompts?.investigate_security_alert
        const template =
          customPrompt && customPrompt.trim()
            ? customPrompt
            : DEFAULT_INVESTIGATE_SECURITY_ALERT_PROMPT
        prompt = template
          .replace(/\{alertWord\}/g, word)
          .replace(/\{alertRefs\}/g, refs)
      } else if (type === 'linear-issue') {
        const projectId = worktreeProjectId ?? ''
        const [contexts, contentItems] = await Promise.all([
          queryClient.fetchQuery({
            queryKey: [
              'investigate-contexts',
              'linear-issue',
              activeWorktreeId,
            ],
            queryFn: () =>
              invoke<
                {
                  identifier: string
                  title: string
                  commentCount: number
                  projectName: string
                }[]
              >('list_loaded_linear_issue_contexts', {
                sessionId: activeWorktreeId,
                worktreeId: activeWorktreeId,
                projectId,
              }),
            staleTime: 0,
          }),
          invoke<{ identifier: string; title: string; content: string }[]>(
            'get_linear_issue_context_contents',
            {
              sessionId: activeWorktreeId,
              worktreeId: activeWorktreeId,
              projectId,
            }
          ),
        ])
        const refs = (contexts ?? []).map(c => c.identifier).join(', ')
        const word = (contexts ?? []).length === 1 ? 'issue' : 'issues'
        const linearContext = (contentItems ?? [])
          .map(c => c.content)
          .join('\n\n---\n\n')
        const customPrompt =
          preferences?.magic_prompts?.investigate_linear_issue
        const template =
          customPrompt && customPrompt.trim()
            ? customPrompt
            : DEFAULT_INVESTIGATE_LINEAR_ISSUE_PROMPT
        prompt = template
          .replace(/\{linearWord\}/g, word)
          .replace(/\{linearRefs\}/g, refs)
          .replace(/\{linearContext\}/g, linearContext)
      } else {
        const contexts = await queryClient.fetchQuery({
          queryKey: ['investigate-contexts', 'advisory', activeWorktreeId],
          queryFn: () =>
            invoke<{ ghsaId: string; severity: string; summary: string }[]>(
              'list_loaded_advisory_contexts',
              { sessionId: activeWorktreeId }
            ),
          staleTime: 0,
        })
        const refs = (contexts ?? [])
          .map(c => `${c.ghsaId} (${c.severity})`)
          .join(', ')
        const word = (contexts ?? []).length === 1 ? 'advisory' : 'advisories'
        const customPrompt = preferences?.magic_prompts?.investigate_advisory
        const template =
          customPrompt && customPrompt.trim()
            ? customPrompt
            : DEFAULT_INVESTIGATE_ADVISORY_PROMPT
        prompt = template
          .replace(/\{advisoryWord\}/g, word)
          .replace(/\{advisoryRefs\}/g, refs)
      }

      const {
        addSendingSession,
        setLastSentMessage,
        setError,
        setSelectedModel,
        setEffortLevel,
        setSelectedProvider,
        setExecutingMode,
      } = useChatStore.getState()

      setLastSentMessage(activeSessionId, prompt)
      setError(activeSessionId, null)
      addSendingSession(activeSessionId)
      setSelectedModel(activeSessionId, investigateModel)
      if (investigateEffortLevel) {
        setEffortLevel(activeSessionId, investigateEffortLevel)
      }
      setSelectedProvider(activeSessionId, investigateProvider)
      setExecutingMode(activeSessionId, 'build')

      setSessionProvider.mutate({
        sessionId: activeSessionId,
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        provider: investigateProvider,
      })

      const investigateIsCustom = Boolean(
        investigateProvider && investigateProvider !== '__anthropic__'
      )
      const investigateUseAdaptive =
        !investigateIsCustom &&
        supportsAdaptiveThinking(investigateModel, cliVersion)

      const investigateBackend = resolveBackend(investigateModel)

      setSessionBackend.mutate({
        sessionId: activeSessionId,
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        backend: investigateBackend,
      })
      setSessionModel.mutate({
        sessionId: activeSessionId,
        worktreeId: activeWorktreeId,
        worktreePath: activeWorktreePath,
        model: investigateModel,
      })
      if (investigateEffortLevel) {
        setSessionEffortLevel.mutate({
          sessionId: activeSessionId,
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
          effortLevel: investigateEffortLevel,
        })
      }

      {
        const {
          setSelectedBackend: setZustandBackend,
          setSelectedModel: setZustandModel,
        } = useChatStore.getState()
        setZustandBackend(activeSessionId, investigateBackend)
        setZustandModel(activeSessionId, investigateModel)
      }
      queryClient.setQueryData(
        chatQueryKeys.session(activeSessionId),
        (old: Session | null | undefined) =>
          old
            ? {
                ...old,
                backend: investigateBackend,
                selected_model: investigateModel,
              }
            : old
      )

      sendMessage.mutate(
        {
          sessionId: activeSessionId,
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
          message: prompt,
          model: investigateModel,
          executionMode: 'build',
          thinkingLevel: selectedThinkingLevelRef.current,
          effortLevel: investigateUseAdaptive
            ? (investigateEffort ?? undefined)
            : undefined,
          mcpConfig: buildMcpConfigJson(
            mcpServersDataRef.current ?? [],
            enabledMcpServersRef.current,
            investigateBackend
          ),
          customProfileName: resolvedInvestigateProfile,
          parallelExecutionPrompt: resolveParallelExecutionPromptForSession(
            activeSessionId,
            preferences
          ),
          chromeEnabled: preferences?.chrome_enabled ?? false,
          aiLanguage: preferences?.ai_language,
          backend: investigateBackend,
        },
        { onSettled: () => inputRef.current?.focus() }
      )
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      sendMessage,
      queryClient,
      preferences?.magic_prompts?.investigate_issue,
      preferences?.magic_prompts?.investigate_pr,
      preferences?.magic_prompts?.investigate_security_alert,
      preferences?.magic_prompts?.investigate_advisory,
      preferences?.magic_prompts?.investigate_linear_issue,
      preferences?.default_provider,
      preferences?.parallel_execution_prompt_enabled,
      preferences?.magic_prompts?.parallel_execution,
      preferences?.magic_prompt_models,
      preferences?.magic_prompt_providers,
      preferences?.magic_prompt_efforts,
      preferences?.chrome_enabled,
      preferences?.ai_language,
      setSessionProvider,
      setSessionBackend,
      setSessionModel,
      setSessionEffortLevel,
      resolveCustomProfile,
      cliVersion,
      inputRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      executionModeRef,
      mcpServersDataRef,
      enabledMcpServersRef,
      worktreeProjectId,
    ]
  )

  const handleInvestigateWorkflowRun = useCallback(
    async (detail: WorkflowRunDetail) => {
      const customPrompt = preferences?.magic_prompts?.investigate_workflow_run
      const template =
        customPrompt && customPrompt.trim()
          ? customPrompt
          : DEFAULT_INVESTIGATE_WORKFLOW_RUN_PROMPT

      const prompt = template
        .replace(/\{workflowName\}/g, detail.workflowName)
        .replace(/\{runUrl\}/g, detail.runUrl)
        .replace(/\{runId\}/g, detail.runId)
        .replace(/\{branch\}/g, detail.branch)
        .replace(/\{displayTitle\}/g, detail.displayTitle)

      const investigateModel =
        preferences?.magic_prompt_models?.investigate_workflow_run_model ??
        selectedModelRef.current
      const investigateProvider = resolveMagicPromptProvider(
        preferences?.magic_prompt_providers,
        'investigate_workflow_run_provider',
        preferences?.default_provider
      )
      const investigateEffort =
        preferences?.magic_prompt_efforts?.investigate_workflow_run_effort ??
        null
      const investigateEffortLevel =
        investigateEffort === 'low' ||
        investigateEffort === 'medium' ||
        investigateEffort === 'high'
          ? investigateEffort
          : undefined
      const { customProfileName: resolvedInvestigateProfile } =
        resolveCustomProfile(investigateModel, investigateProvider)

      // Find the right worktree for this branch
      let targetWorktreeId: string | null = null
      let targetWorktreePath: string | null = null

      if (detail.projectPath) {
        const projects = await queryClient.fetchQuery({
          queryKey: projectsQueryKeys.list(),
          queryFn: () => invoke<Project[]>('list_projects'),
          staleTime: 1000 * 60,
        })
        const project = projects?.find(p => p.path === detail.projectPath)

        if (project) {
          let worktrees: Worktree[] = []
          try {
            worktrees = await queryClient.fetchQuery({
              queryKey: projectsQueryKeys.worktrees(project.id),
              queryFn: () =>
                invoke<Worktree[]>('list_worktrees', {
                  projectId: project.id,
                }),
              staleTime: 1000 * 60,
            })
          } catch (err) {
            logger.error('[INVESTIGATE-WF] Failed to fetch worktrees:', err)
          }

          const isUsable = (w: Worktree) => !w.status || w.status === 'ready'

          if (worktrees.length > 0) {
            const matching = worktrees.find(
              w => w.branch === detail.branch && isUsable(w)
            )
            if (matching) {
              targetWorktreeId = matching.id
              targetWorktreePath = matching.path
            } else {
              const base = worktrees.find(w => isUsable(w))
              if (base) {
                targetWorktreeId = base.id
                targetWorktreePath = base.path
              }
            }
          }

          if (!targetWorktreeId) {
            try {
              const baseSession = await invoke<Worktree>(
                'create_base_session',
                { projectId: project.id }
              )
              queryClient.invalidateQueries({
                queryKey: projectsQueryKeys.worktrees(project.id),
              })
              targetWorktreeId = baseSession.id
              targetWorktreePath = baseSession.path
            } catch (error) {
              logger.error(
                '[INVESTIGATE-WF] Failed to create base session:',
                error
              )
              toast.error(`Failed to open base session: ${error}`)
              return
            }
          }
        }
      }

      // Final fallback: use active worktree
      if (!targetWorktreeId || !targetWorktreePath) {
        targetWorktreeId = activeWorktreeIdRef.current ?? null
        targetWorktreePath = activeWorktreePathRef.current ?? null
      }

      if (!targetWorktreeId || !targetWorktreePath) {
        logger.error('[INVESTIGATE-WF] No worktree found at all, aborting')
        toast.error('No worktree found for this branch')
        return
      }

      const worktreeId = targetWorktreeId
      const worktreePath = targetWorktreePath

      const investigateIsCustom = Boolean(
        investigateProvider && investigateProvider !== '__anthropic__'
      )
      const investigateUseAdaptive =
        !investigateIsCustom &&
        supportsAdaptiveThinking(investigateModel, cliVersion)

      const investigateBackend = resolveBackend(investigateModel)

      const sendInvestigateMessage = (targetSessionId: string) => {
        const {
          addSendingSession,
          setLastSentMessage,
          setError,
          setSelectedModel,
          setEffortLevel,
          setSelectedProvider,
          setExecutingMode,
        } = useChatStore.getState()

        setLastSentMessage(targetSessionId, prompt)
        setError(targetSessionId, null)
        addSendingSession(targetSessionId)
        setSelectedModel(targetSessionId, investigateModel)
        if (investigateEffortLevel) {
          setEffortLevel(targetSessionId, investigateEffortLevel)
        }
        setSelectedProvider(targetSessionId, investigateProvider)
        setExecutingMode(targetSessionId, 'yolo')

        setSessionBackend.mutate({
          sessionId: targetSessionId,
          worktreeId,
          worktreePath,
          backend: investigateBackend,
        })
        setSessionModel.mutate({
          sessionId: targetSessionId,
          worktreeId,
          worktreePath,
          model: investigateModel,
        })
        setSessionProvider.mutate({
          sessionId: targetSessionId,
          worktreeId,
          worktreePath,
          provider: investigateProvider,
        })
        if (investigateEffortLevel) {
          setSessionEffortLevel.mutate({
            sessionId: targetSessionId,
            worktreeId,
            worktreePath,
            effortLevel: investigateEffortLevel,
          })
        }
        {
          const {
            setSelectedBackend: setZustandBackend,
            setSelectedModel: setZustandModel,
          } = useChatStore.getState()
          setZustandBackend(targetSessionId, investigateBackend)
          setZustandModel(targetSessionId, investigateModel)
        }
        queryClient.setQueryData(
          chatQueryKeys.session(targetSessionId),
          (old: Session | null | undefined) =>
            old
              ? {
                  ...old,
                  backend: investigateBackend,
                  selected_model: investigateModel,
                }
              : old
        )

        sendMessage.mutate(
          {
            sessionId: targetSessionId,
            worktreeId,
            worktreePath,
            message: prompt,
            model: investigateModel,
            executionMode: 'yolo',
            thinkingLevel: selectedThinkingLevelRef.current,
            effortLevel: investigateUseAdaptive
              ? (investigateEffort ?? undefined)
              : undefined,
            mcpConfig: buildMcpConfigJson(
              mcpServersDataRef.current ?? [],
              enabledMcpServersRef.current,
              investigateBackend
            ),
            customProfileName: resolvedInvestigateProfile,
            parallelExecutionPrompt: resolveParallelExecutionPromptForSession(
              targetSessionId,
              preferences
            ),
            chromeEnabled: preferences?.chrome_enabled ?? false,
            aiLanguage: preferences?.ai_language,
            backend: investigateBackend,
          },
          { onSettled: () => inputRef.current?.focus() }
        )
      }

      // Switch to the target worktree, create a new session, then send the prompt
      const { setActiveWorktree, setActiveSession } = useChatStore.getState()
      const { selectWorktree, expandProject } = useProjectsStore.getState()
      setActiveWorktree(worktreeId, worktreePath)
      selectWorktree(worktreeId)

      const projects = queryClient.getQueryData<Project[]>(
        projectsQueryKeys.list()
      )
      const project = projects?.find(p => p.path === detail.projectPath)
      if (project) expandProject(project.id)

      createSession.mutate(
        { worktreeId, worktreePath },
        {
          onSuccess: session => {
            setActiveSession(worktreeId, session.id)
            sendInvestigateMessage(session.id)
          },
          onError: error => {
            logger.error('[INVESTIGATE-WF] Failed to create session:', error)
            toast.error(`Failed to create session: ${error}`)
          },
        }
      )
    },
    [
      sendMessage,
      createSession,
      queryClient,
      preferences?.magic_prompts?.investigate_workflow_run,
      preferences?.magic_prompt_models?.investigate_workflow_run_model,
      preferences?.default_provider,
      preferences?.parallel_execution_prompt_enabled,
      preferences?.magic_prompts?.parallel_execution,
      preferences?.magic_prompt_providers,
      preferences?.magic_prompt_efforts?.investigate_workflow_run_effort,
      preferences?.chrome_enabled,
      preferences?.ai_language,
      setSessionProvider,
      setSessionBackend,
      setSessionModel,
      setSessionEffortLevel,
      resolveCustomProfile,
      cliVersion,
      inputRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      executionModeRef,
      mcpServersDataRef,
      enabledMcpServersRef,
    ]
  )

  const handleReviewComments = useCallback(
    async (
      promptOrPrompts: string | string[],
      options?: { executionMode?: ExecutionMode }
    ) => {
      const worktreeId = activeWorktreeIdRef.current
      const worktreePath = activeWorktreePathRef.current
      if (!worktreeId || !worktreePath) return
      const prompts = Array.isArray(promptOrPrompts)
        ? promptOrPrompts.filter(prompt => prompt.trim().length > 0)
        : [promptOrPrompts].filter(prompt => prompt.trim().length > 0)
      if (prompts.length === 0) return
      const reviewExecutionMode =
        options?.executionMode ??
        (Array.isArray(promptOrPrompts) ? 'plan' : executionModeRef.current)

      const reviewCommentsBackend = resolveMagicPromptBackend(
        preferences?.magic_prompt_backends,
        'review_comments_backend',
        preferences?.default_backend
      )
      const storedReviewCommentsModel =
        preferences?.magic_prompt_models?.review_comments_model ??
        selectedModelRef.current
      const reviewCommentsModel = isMagicPromptModelCompatibleWithBackend(
        storedReviewCommentsModel,
        reviewCommentsBackend
      )
        ? storedReviewCommentsModel
        : reviewCommentsBackend === 'codex'
          ? CODEX_DEFAULT_MAGIC_PROMPT_MODELS.review_comments_model
          : reviewCommentsBackend === 'opencode'
            ? OPENCODE_DEFAULT_MAGIC_PROMPT_MODELS.review_comments_model
            : DEFAULT_MAGIC_PROMPT_MODELS.review_comments_model
      const reviewCommentsProvider =
        reviewCommentsBackend === 'claude'
          ? resolveMagicPromptProvider(
              preferences?.magic_prompt_providers,
              'review_comments_provider',
              preferences?.default_provider
            )
          : null
      const { customProfileName: resolvedProfile } = resolveCustomProfile(
        reviewCommentsModel,
        reviewCommentsProvider
      )
      const reviewCommentsEffort =
        preferences?.magic_prompt_efforts?.review_comments_effort ?? null
      const reviewCommentsEffortLevel =
        reviewCommentsEffort === 'low' ||
        reviewCommentsEffort === 'medium' ||
        reviewCommentsEffort === 'high'
          ? reviewCommentsEffort
          : undefined

      const isCustom = Boolean(
        reviewCommentsProvider && reviewCommentsProvider !== '__anthropic__'
      )
      const useAdaptive =
        !isCustom && supportsAdaptiveThinking(reviewCommentsModel, cliVersion)

      // Helper to send the message once we have a session ID
      const sendInSession = (sessionId: string, prompt: string) => {
        const {
          addSendingSession,
          setLastSentMessage,
          setError,
          setSelectedModel,
          setEffortLevel,
          setSelectedProvider,
          setExecutingMode,
          setSelectedBackend: setZustandBackend,
        } = useChatStore.getState()

        setLastSentMessage(sessionId, prompt)
        setError(sessionId, null)
        addSendingSession(sessionId)
        setSelectedModel(sessionId, reviewCommentsModel)
        if (reviewCommentsEffortLevel) {
          setEffortLevel(sessionId, reviewCommentsEffortLevel)
        }
        setSelectedProvider(sessionId, reviewCommentsProvider)
        setExecutingMode(sessionId, reviewExecutionMode)
        setZustandBackend(sessionId, reviewCommentsBackend)

        useChatStore.getState().setSelectedModel(sessionId, reviewCommentsModel)

        setSessionProvider.mutate({
          sessionId,
          worktreeId,
          worktreePath,
          provider: reviewCommentsProvider,
        })
        setSessionBackend.mutate({
          sessionId,
          worktreeId,
          worktreePath,
          backend: reviewCommentsBackend,
        })
        setSessionModel.mutate({
          sessionId,
          worktreeId,
          worktreePath,
          model: reviewCommentsModel,
        })
        if (reviewCommentsEffortLevel) {
          setSessionEffortLevel.mutate({
            sessionId,
            worktreeId,
            worktreePath,
            effortLevel: reviewCommentsEffortLevel,
          })
        }

        queryClient.setQueryData(
          chatQueryKeys.session(sessionId),
          (old: Session | null | undefined) =>
            old
              ? {
                  ...old,
                  backend: reviewCommentsBackend,
                  selected_model: reviewCommentsModel,
                }
              : old
        )

        const args = {
          sessionId,
          worktreeId,
          worktreePath,
          message: prompt,
          model: reviewCommentsModel,
          executionMode: reviewExecutionMode,
          thinkingLevel: selectedThinkingLevelRef.current,
          effortLevel: useAdaptive
            ? (reviewCommentsEffort ?? undefined)
            : undefined,
          mcpConfig: buildMcpConfigJson(
            mcpServersDataRef.current ?? [],
            enabledMcpServersRef.current,
            reviewCommentsBackend
          ),
          customProfileName: resolvedProfile,
          parallelExecutionPrompt: resolveParallelExecutionPromptForSession(
            sessionId,
            preferences
          ),
          chromeEnabled: preferences?.chrome_enabled ?? false,
          aiLanguage: preferences?.ai_language,
          backend: reviewCommentsBackend,
        }

        if (sendMessage.mutateAsync) {
          return sendMessage
            .mutateAsync(args)
            .finally(() => inputRef.current?.focus())
        }
        sendMessage.mutate(args, { onSettled: () => inputRef.current?.focus() })
        return Promise.resolve()
      }

      const createAndSend = async (prompt: string) => {
        const onSession = async (session: { id: string }) => {
          const { setActiveSession, copySessionSettings, activeSessionIds } =
            useChatStore.getState()
          const currentSessionId = activeSessionIds[worktreeId]
          if (currentSessionId) {
            copySessionSettings(currentSessionId, session.id)
          }
          setActiveSession(worktreeId, session.id)
          queryClient.invalidateQueries({
            queryKey: chatQueryKeys.sessions(worktreeId),
          })
          await sendInSession(session.id, prompt)
        }

        if (createSession.mutateAsync) {
          const session = await createSession.mutateAsync({
            worktreeId,
            worktreePath,
          })
          await onSession(session)
          return
        }

        createSession.mutate(
          { worktreeId, worktreePath },
          {
            onSuccess: session => {
              void onSession(session)
            },
            onError: error => {
              console.error(
                '[REVIEW-COMMENTS] Failed to create session:',
                error
              )
            },
          }
        )
      }

      for (const prompt of prompts) {
        await createAndSend(prompt)
      }
    },
    [
      sendMessage,
      createSession,
      queryClient,
      preferences?.default_provider,
      preferences?.default_backend,
      preferences?.parallel_execution_prompt_enabled,
      preferences?.magic_prompts?.parallel_execution,
      preferences?.magic_prompt_models?.review_comments_model,
      preferences?.magic_prompt_providers,
      preferences?.magic_prompt_backends,
      preferences?.magic_prompt_efforts?.review_comments_effort,
      preferences?.chrome_enabled,
      preferences?.ai_language,
      setSessionProvider,
      setSessionBackend,
      setSessionModel,
      setSessionEffortLevel,
      resolveCustomProfile,
      cliVersion,
      inputRef,
      activeWorktreeIdRef,
      activeWorktreePathRef,
      selectedModelRef,
      selectedThinkingLevelRef,
      executionModeRef,
      mcpServersDataRef,
      enabledMcpServersRef,
    ]
  )

  return {
    handleInvestigate,
    handleInvestigateWorkflowRun,
    handleReviewComments,
  }
}
