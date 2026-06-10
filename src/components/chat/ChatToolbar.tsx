import { memo, useCallback, useEffect, useState } from 'react'
import { Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { useUIStore } from '@/store/ui-store'
import {
  gitPush,
  triggerImmediateGitPoll,
  fetchWorktreesStatus,
  performGitPull,
  performGitPullUpstream,
} from '@/services/git-status'
import { useChatStore } from '@/store/chat-store'
import { useRemotePicker } from '@/hooks/useRemotePicker'
import { useAllBackendsMcpHealth } from '@/services/mcp'
import type { ClaudeModel } from '@/types/preferences'
import type { EffortLevel, ThinkingLevel } from '@/types/chat'
import type { ChatToolbarProps } from '@/components/chat/toolbar/types'
import { MobileToolbarMenu } from '@/components/chat/toolbar/MobileToolbarMenu'
import { DesktopToolbarControls } from '@/components/chat/toolbar/DesktopToolbarControls'
import { DockBurgerButton } from '@/components/chat/toolbar/DockBurgerButton'
import { SendCancelButton } from '@/components/chat/toolbar/SendCancelButton'
import { SessionUsageMeter } from '@/components/chat/toolbar/SessionUsageMeter'
import { ContextViewerDialog } from '@/components/chat/toolbar/ContextViewerDialog'
import { SupervisorActionPopover } from '@/components/chat/toolbar/SupervisorActionPopover'
import {
  CODEX_MODEL_OPTIONS,
  EFFORT_LEVEL_OPTIONS,
  MODEL_OPTIONS,
  OPENCODE_MODEL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'
import { useToolbarDropdownShortcuts } from '@/components/chat/toolbar/useToolbarDropdownShortcuts'
import { useToolbarDerivedState } from '@/components/chat/toolbar/useToolbarDerivedState'
import { useContextViewer } from '@/components/chat/toolbar/useContextViewer'
import { formatOpencodeModelLabel } from '@/components/chat/toolbar/toolbar-utils'
import { useAvailableOpencodeModels } from '@/services/opencode-cli'
import { cn } from '@/lib/utils'
import { DEFAULT_KEYBINDINGS, formatShortcutDisplay } from '@/types/keybindings'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { usePatchPreferences, usePreferences } from '@/services/preferences'
import {
  getCatalogModelFastInfo,
  getCatalogModelPreferenceKey,
  resolveRememberedCatalogFastModel,
  useModelCatalog,
} from '@/services/model-catalog'

// eslint-disable-next-line react-refresh/only-export-components
export {
  MODEL_OPTIONS,
  CODEX_MODEL_OPTIONS,
  OPENCODE_MODEL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  EFFORT_LEVEL_OPTIONS,
}
export type { ChatToolbarProps }

export const ChatToolbar = memo(function ChatToolbar({
  isSending,
  hasPendingQuestions,
  hasPendingAttachments,
  hasInputValue,
  executionMode,
  selectedBackend,
  selectedModel,
  selectedProvider,
  selectedThinkingLevel,
  selectedEffortLevel,
  useAdaptiveThinking,
  hideThinkingLevel,
  sessionHasMessages,
  providerLocked,
  baseBranch,
  uncommittedAdded,
  uncommittedRemoved,
  branchDiffAdded,
  branchDiffRemoved,
  prUrl,
  prNumber,
  displayStatus,
  checkStatus,
  mergeableStatus,
  activeWorktreePath,
  worktreeId,
  activeSessionId,
  projectId,
  loadedIssueContexts,
  loadedPRContexts,
  loadedSecurityContexts,
  loadedAdvisoryContexts,
  loadedLinearContexts,
  attachedSavedContexts,
  onOpenMagicModal,
  onSaveContext,
  onLoadContext,
  onCommit,
  onCommitAndPush,
  onOpenPr,
  onOpenPullRequestReview,
  onReview,
  onMerge,
  onMergePr,
  onAttach,
  onResolvePrConflicts,
  onResolveConflicts: _onResolveConflicts,
  hasOpenPr,
  onSetDiffRequest,
  installedBackends,
  onBackendChange,
  onModelChange,
  onProviderChange,
  customCliProfiles,
  onThinkingLevelChange,
  onEffortLevelChange,
  onSetExecutionMode,
  parallelExecutionPromptEnabled,
  onParallelExecutionPromptChange,
  supervisorAction,
  onSupervisorActionChange,
  onCancel,
  queuedMessageCount,
  onHarnessFanoutSend,
  fanoutDisabled,
  availableMcpServers,
  enabledMcpServers,
  onToggleMcpServer,
  onOpenProjectSettings,
}: ChatToolbarProps) {
  const { data: preferences } = usePreferences()
  const { data: modelCatalog } = useModelCatalog()
  const patchPreferences = usePatchPreferences()
  const {
    statuses: mcpStatuses,
    isFetching: isHealthChecking,
    refetchAll: checkHealth,
  } = useAllBackendsMcpHealth(installedBackends)

  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false)
  const [mcpDropdownOpen, setMcpDropdownOpen] = useState(false)
  const parallelPromptShortcut = formatShortcutDisplay(
    (preferences?.keybindings?.toggle_parallel_execution_prompting ??
      DEFAULT_KEYBINDINGS.toggle_parallel_execution_prompting) as string
  )

  const pickRemoteOrRun = useRemotePicker(activeWorktreePath)
  const openResolveConflictsDialog = useCallback(() => {
    useUIStore.getState().setResolveConflictsDialogOpen(true)
  }, [])

  const handleMcpDropdownOpenChange = useCallback(
    (open: boolean) => {
      setMcpDropdownOpen(open)
      if (open) {
        checkHealth()
      }
    },
    [checkHealth]
  )

  useToolbarDropdownShortcuts({
    setProviderDropdownOpen,
    setModelDropdownOpen,
    setThinkingDropdownOpen,
  })

  useEffect(() => {
    const { setChatToolbarMounted } = useUIStore.getState()
    setChatToolbarMounted(true)
    return () => setChatToolbarMounted(false)
  }, [])

  const { data: availableOpencodeModels } = useAvailableOpencodeModels({
    enabled: selectedBackend === 'opencode',
  })
  const opencodeModelOptions =
    availableOpencodeModels?.map(model => ({
      value: model,
      label: formatOpencodeModelLabel(model),
    })) ?? OPENCODE_MODEL_OPTIONS

  const {
    isCodex,
    activeMcpCount,
    filteredModelOptions,
    desktopModelOptions,
    selectedBaseModel,
    selectedModelIsFast,
    selectedModelLabel,
  } = useToolbarDerivedState({
    selectedBackend,
    selectedProvider,
    selectedModel,
    opencodeModelOptions,
    customCliProfiles,
    favoriteModels: preferences?.favorite_models ?? [],
    fastModeModels: preferences?.fast_mode_models ?? [],
    availableMcpServers,
    enabledMcpServers,
  })

  const {
    viewingContext,
    setViewingContext,
    handleViewIssue,
    handleViewPR,
    handleViewSavedContext,
    handleViewSecurityAlert,
    handleViewAdvisory,
    handleViewLinear,
  } = useContextViewer({
    activeSessionId,
    activeWorktreePath,
    worktreeId,
    projectId,
  })

  const handleModelChange = useCallback(
    (value: string) => {
      const selectedFastInfo = getCatalogModelFastInfo(
        modelCatalog,
        selectedBackend,
        selectedModel
      )
      const fastModelSelectionEnabled =
        selectedBackend === 'codex' ||
        (selectedBackend === 'claude' &&
          (!selectedProvider || selectedProvider === '__anthropic__'))
      const resolvedModel =
        selectedFastInfo.isFast && selectedFastInfo.baseModel === value
          ? selectedModel
          : fastModelSelectionEnabled
            ? resolveRememberedCatalogFastModel(
                modelCatalog,
                selectedBackend,
                value,
                preferences?.fast_mode_models ?? []
              )
            : value

      onModelChange(resolvedModel as ClaudeModel)
    },
    [
      onModelChange,
      modelCatalog,
      preferences?.fast_mode_models,
      selectedBackend,
      selectedModel,
      selectedProvider,
    ]
  )

  const handleToggleFavoriteModel = useCallback(
    (value: string) => {
      if (!preferences) return

      const favoriteKey = getCatalogModelPreferenceKey(
        modelCatalog,
        selectedBackend,
        value
      )
      const favoriteModels = preferences.favorite_models ?? []
      const nextFavoriteModels = favoriteModels.includes(favoriteKey)
        ? favoriteModels.filter(key => key !== favoriteKey)
        : [...favoriteModels, favoriteKey]

      patchPreferences.mutate({ favorite_models: nextFavoriteModels })
    },
    [modelCatalog, patchPreferences, preferences, selectedBackend]
  )

  const handleFastModeChange = useCallback(
    (value: string, enabled: boolean) => {
      if (!preferences) return

      const fastInfo = getCatalogModelFastInfo(
        modelCatalog,
        selectedBackend,
        value
      )
      if (!fastInfo.supportsFast) return

      const modelKey = getCatalogModelPreferenceKey(
        modelCatalog,
        selectedBackend,
        value
      )
      const fastModeModels = preferences.fast_mode_models ?? []
      const nextFastModeModels = enabled
        ? [...new Set([...fastModeModels, modelKey])]
        : fastModeModels.filter(key => key !== modelKey)

      patchPreferences.mutate({ fast_mode_models: nextFastModeModels })

      const currentFastInfo = getCatalogModelFastInfo(
        modelCatalog,
        selectedBackend,
        selectedModel
      )
      if (currentFastInfo.baseModel !== fastInfo.baseModel) return

      const nextModel = enabled
        ? (fastInfo.fastModel ?? fastInfo.baseModel)
        : fastInfo.baseModel
      onModelChange(nextModel as ClaudeModel)
    },
    [
      onModelChange,
      modelCatalog,
      patchPreferences,
      preferences,
      selectedBackend,
      selectedModel,
    ]
  )

  const handleProviderChange = useCallback(
    (value: string) => {
      const provider = value === 'default' ? null : value
      onProviderChange(provider)
      if (provider && provider !== '__anthropic__') {
        if (
          selectedModel === 'claude-opus-4-8[1m]' ||
          selectedModel === 'claude-opus-4-8[1m]-fast'
        ) {
          onModelChange('claude-opus-4-8' as ClaudeModel)
        } else if (
          selectedModel === 'claude-opus-4-7[1m]' ||
          selectedModel === 'claude-opus-4-7[1m]-fast'
        ) {
          onModelChange('claude-opus-4-7' as ClaudeModel)
        } else if (
          selectedModel === 'claude-opus-4-6[1m]' ||
          selectedModel === 'claude-sonnet-4-6[1m]' ||
          selectedModel === 'claude-opus-4-6-fast' ||
          selectedModel === 'claude-opus-4-6[1m]-fast'
        ) {
          onModelChange('claude-opus-4-6' as ClaudeModel)
        }
      }
    },
    [onProviderChange, onModelChange, selectedModel]
  )

  const handleThinkingLevelChange = useCallback(
    (value: string) => {
      onThinkingLevelChange(value as ThinkingLevel)
    },
    [onThinkingLevelChange]
  )

  const handleEffortLevelChange = useCallback(
    (value: string) => {
      onEffortLevelChange(value as EffortLevel)
    },
    [onEffortLevelChange]
  )

  const handlePullClick = useCallback(async () => {
    if (!activeWorktreePath || !worktreeId) return
    await performGitPull({
      worktreeId,
      worktreePath: activeWorktreePath,
      baseBranch,
      projectId,
      onMergeConflict: openResolveConflictsDialog,
    })
  }, [
    activeWorktreePath,
    baseBranch,
    worktreeId,
    projectId,
    openResolveConflictsDialog,
  ])

  const handlePullUpstreamClick = useCallback(async () => {
    if (!activeWorktreePath || !worktreeId) return
    await performGitPullUpstream({
      worktreeId,
      worktreePath: activeWorktreePath,
      branchLabel: activeWorktreePath.split('/').pop() ?? undefined,
      projectId,
      onMergeConflict: openResolveConflictsDialog,
    })
  }, [activeWorktreePath, worktreeId, projectId, openResolveConflictsDialog])

  const handlePushClick = useCallback(() => {
    if (!activeWorktreePath || !worktreeId) return
    pickRemoteOrRun(async remote => {
      const { setWorktreeLoading, clearWorktreeLoading } =
        useChatStore.getState()
      setWorktreeLoading(worktreeId, 'push')
      const toastId = toast.loading('Pushing changes...')
      try {
        const result = await gitPush(activeWorktreePath, prNumber, remote)
        triggerImmediateGitPoll()
        if (projectId) fetchWorktreesStatus(projectId)
        if (result.fellBack) {
          toast.warning(
            'Could not push to PR branch, pushed to new branch instead',
            { id: toastId }
          )
        } else {
          toast.success('Changes pushed', { id: toastId })
        }
      } catch (error) {
        toast.error(`Push failed: ${error}`, { id: toastId })
      } finally {
        clearWorktreeLoading(worktreeId)
      }
    })
  }, [activeWorktreePath, worktreeId, projectId, prNumber, pickRemoteOrRun])

  const handleUncommittedDiffClick = useCallback(() => {
    onSetDiffRequest({
      type: 'uncommitted',
      worktreePath: activeWorktreePath ?? '',
      baseBranch,
    })
  }, [activeWorktreePath, baseBranch, onSetDiffRequest])

  const handleBranchDiffClick = useCallback(() => {
    onSetDiffRequest({
      type: 'branch',
      worktreePath: activeWorktreePath ?? '',
      baseBranch,
    })
  }, [activeWorktreePath, baseBranch, onSetDiffRequest])

  const canSend = hasInputValue || hasPendingAttachments

  return (
    <div className="@container flex justify-center px-4 py-2 md:px-6">
      <div className="flex max-w-full min-w-0 items-center rounded-lg bg-muted/50">
        <div
          className="inline-flex min-w-0 flex-1 flex-nowrap items-center overflow-x-auto whitespace-nowrap scrollbar-hide"
          data-testid="chat-toolbar-scroll-controls"
        >
          <DockBurgerButton
            activeMcpCount={activeMcpCount}
            className="flex @xl:hidden shrink-0"
          />
          <SessionUsageMeter side="top" align="start" variant="toolbar" />
          <MobileToolbarMenu
            isDisabled={isSending}
            hasOpenPr={hasOpenPr}
            sessionHasMessages={sessionHasMessages}
            providerLocked={providerLocked}
            selectedBackend={selectedBackend}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            selectedEffortLevel={selectedEffortLevel}
            selectedThinkingLevel={selectedThinkingLevel}
            hideThinkingLevel={hideThinkingLevel}
            useAdaptiveThinking={useAdaptiveThinking}
            isCodex={isCodex}
            executionMode={executionMode}
            customCliProfiles={customCliProfiles}
            filteredModelOptions={filteredModelOptions}
            uncommittedAdded={uncommittedAdded}
            uncommittedRemoved={uncommittedRemoved}
            branchDiffAdded={branchDiffAdded}
            branchDiffRemoved={branchDiffRemoved}
            prUrl={prUrl}
            prNumber={prNumber}
            displayStatus={displayStatus}
            checkStatus={checkStatus}
            activeWorktreePath={activeWorktreePath}
            onSaveContext={onSaveContext}
            onLoadContext={onLoadContext}
            onCommit={onCommit}
            onCommitAndPush={onCommitAndPush}
            onOpenPr={onOpenPr}
            onOpenPullRequestReview={onOpenPullRequestReview}
            onReview={onReview}
            onMerge={onMerge}
            onMergePr={onMergePr}
            onResolveConflicts={openResolveConflictsDialog}
            onOpenMagicModal={onOpenMagicModal}
            installedBackends={installedBackends}
            onBackendChange={onBackendChange}
            onSetExecutionMode={onSetExecutionMode}
            handlePullClick={handlePullClick}
            handlePullUpstreamClick={handlePullUpstreamClick}
            handlePushClick={handlePushClick}
            handleUncommittedDiffClick={handleUncommittedDiffClick}
            handleBranchDiffClick={handleBranchDiffClick}
            handleProviderChange={handleProviderChange}
            handleModelChange={handleModelChange}
            handleEffortLevelChange={handleEffortLevelChange}
            handleThinkingLevelChange={handleThinkingLevelChange}
            loadedIssueContexts={loadedIssueContexts}
            loadedPRContexts={loadedPRContexts}
            loadedSecurityContexts={loadedSecurityContexts}
            loadedAdvisoryContexts={loadedAdvisoryContexts}
            loadedLinearContexts={loadedLinearContexts}
            attachedSavedContexts={attachedSavedContexts}
            handleViewIssue={handleViewIssue}
            handleViewPR={handleViewPR}
            handleViewSecurityAlert={handleViewSecurityAlert}
            handleViewAdvisory={handleViewAdvisory}
            handleViewLinear={handleViewLinear}
            handleViewSavedContext={handleViewSavedContext}
            availableMcpServers={availableMcpServers}
            enabledMcpServers={enabledMcpServers}
            activeMcpCount={activeMcpCount}
            onToggleMcpServer={onToggleMcpServer}
          />

          <DesktopToolbarControls
            hasPendingQuestions={hasPendingQuestions}
            selectedBackend={selectedBackend}
            selectedModelValue={selectedBaseModel}
            selectedProvider={selectedProvider}
            selectedThinkingLevel={selectedThinkingLevel}
            selectedEffortLevel={selectedEffortLevel}
            executionMode={executionMode}
            useAdaptiveThinking={useAdaptiveThinking}
            hideThinkingLevel={hideThinkingLevel}
            sessionHasMessages={sessionHasMessages}
            providerLocked={providerLocked}
            customCliProfiles={customCliProfiles}
            desktopModelOptions={desktopModelOptions}
            selectedModelLabel={selectedModelLabel}
            selectedModelIsFast={selectedModelIsFast}
            isCodex={isCodex}
            prUrl={prUrl}
            prNumber={prNumber}
            displayStatus={displayStatus}
            checkStatus={checkStatus}
            mergeableStatus={mergeableStatus}
            activeWorktreePath={activeWorktreePath}
            availableMcpServers={availableMcpServers}
            enabledMcpServers={enabledMcpServers}
            activeMcpCount={activeMcpCount}
            isHealthChecking={isHealthChecking}
            mcpStatuses={mcpStatuses}
            loadedIssueContexts={loadedIssueContexts}
            loadedPRContexts={loadedPRContexts}
            loadedSecurityContexts={loadedSecurityContexts}
            loadedAdvisoryContexts={loadedAdvisoryContexts}
            loadedLinearContexts={loadedLinearContexts}
            attachedSavedContexts={attachedSavedContexts}
            providerDropdownOpen={providerDropdownOpen}
            modelDropdownOpen={modelDropdownOpen}
            thinkingDropdownOpen={thinkingDropdownOpen}
            mcpDropdownOpen={mcpDropdownOpen}
            setProviderDropdownOpen={setProviderDropdownOpen}
            setModelDropdownOpen={setModelDropdownOpen}
            setThinkingDropdownOpen={setThinkingDropdownOpen}
            onMcpDropdownOpenChange={handleMcpDropdownOpenChange}
            onOpenMagicModal={onOpenMagicModal}
            onOpenProjectSettings={onOpenProjectSettings}
            onResolvePrConflicts={onResolvePrConflicts}
            onLoadContext={onLoadContext}
            onAttach={onAttach}
            onOpenPullRequestReview={onOpenPullRequestReview}
            installedBackends={installedBackends}
            onBackendChange={onBackendChange}
            onSetExecutionMode={onSetExecutionMode}
            onToggleMcpServer={onToggleMcpServer}
            handleModelChange={handleModelChange}
            handleToggleFavoriteModel={handleToggleFavoriteModel}
            handleFastModeChange={handleFastModeChange}
            handleProviderChange={handleProviderChange}
            handleThinkingLevelChange={handleThinkingLevelChange}
            handleEffortLevelChange={handleEffortLevelChange}
            handleViewIssue={handleViewIssue}
            handleViewPR={handleViewPR}
            handleViewSecurityAlert={handleViewSecurityAlert}
            handleViewAdvisory={handleViewAdvisory}
            handleViewLinear={handleViewLinear}
            handleViewSavedContext={handleViewSavedContext}
          />

          <div className="h-4 w-px shrink-0 bg-border/50" />

          <div className="flex h-8 shrink-0 items-center gap-1 px-2">
            <SupervisorActionPopover
              action={supervisorAction}
              disabled={!activeSessionId}
              onChange={onSupervisorActionChange}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={isSending}
                  aria-label="Parallel execution prompting"
                  aria-pressed={parallelExecutionPromptEnabled}
                  onClick={() =>
                    onParallelExecutionPromptChange(
                      !parallelExecutionPromptEnabled
                    )
                  }
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50',
                    parallelExecutionPromptEnabled
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  )}
                >
                  <Workflow className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {`Parallel execution prompting (${parallelPromptShortcut})`}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="h-4 w-px shrink-0 bg-border/50" />

        <div
          className="shrink-0 pr-1"
          data-testid="chat-toolbar-pinned-actions"
        >
          <SendCancelButton
            isSending={isSending}
            canSend={canSend}
            executionMode={executionMode}
            queuedMessageCount={queuedMessageCount}
            onCancel={onCancel}
            installedBackends={installedBackends}
            onHarnessFanoutSend={onHarnessFanoutSend}
            fanoutDisabled={fanoutDisabled}
          />
        </div>
      </div>

      <ContextViewerDialog
        viewingContext={viewingContext}
        onClose={() => setViewingContext(null)}
      />
    </div>
  )
})
