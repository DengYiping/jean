import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  type FC,
} from 'react'
import { invoke } from '@/lib/transport'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Loader2,
  ChevronDown,
  Check,
  ChevronsUpDown,
  Play,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  useClaudeCliStatus,
  useClaudeCliAuth,
  claudeCliQueryKeys,
  resolveClaudeUpdateCommand,
} from '@/services/claude-cli'
import { useGhCliStatus, useGhCliAuth, ghCliQueryKeys } from '@/services/gh-cli'
import {
  useCodexCliStatus,
  useCodexCliAuth,
  codexCliQueryKeys,
  resolveCodexUpdateCommand,
} from '@/services/codex-cli'
import {
  useOpenCodeCliStatus,
  useOpenCodeCliAuth,
  useAvailableOpencodeModels,
  opencodeCliQueryKeys,
} from '@/services/opencode-cli'
import { useUIStore } from '@/store/ui-store'
import type { ClaudeAuthStatus } from '@/types/claude-cli'
import type { GhAuthStatus } from '@/types/gh-cli'
import type { CodexAuthStatus } from '@/types/codex-cli'
import type { OpenCodeAuthStatus } from '@/types/opencode-cli'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { usePreferences, usePatchPreferences } from '@/services/preferences'
import type { AppPreferences } from '@/types/preferences'
import {
  modelOptions,
  thinkingLevelOptions,
  effortLevelOptions,
  codexModelOptions,
  codexReasoningOptions,
  backendOptions,
  terminalOptions,
  editorOptions,
  gitPollIntervalOptions,
  remotePollIntervalOptions,
  archiveRetentionOptions,
  removalBehaviorOptions,
  notificationSoundOptions,
  type RemovalBehavior,
  type ClaudeModel,
  type CodexModel,
  type CodexReasoningEffort,
  type CliBackend,
  type TerminalApp,
  type EditorApp,
  type NotificationSound,
  openInDefaultOptions,
  type OpenInDefault,
} from '@/types/preferences'
import { OPENCODE_MODEL_OPTIONS } from '@/components/chat/toolbar/toolbar-options'
import { formatOpencodeModelLabel } from '@/components/chat/toolbar/toolbar-utils'
import { playNotificationSound } from '@/lib/sounds'
import type { ThinkingLevel, EffortLevel } from '@/types/chat'
import { isNativeApp } from '@/lib/environment'
import { cn } from '@/lib/utils'
import {
  setGitPollInterval,
  setRemotePollInterval,
} from '@/services/git-status'

interface CleanupResult {
  deleted_worktrees: number
  deleted_sessions: number
}

const SettingsSection: React.FC<{
  title: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}> = ({ title, actions, children }) => (
  <div className="space-y-4">
    <div>
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-medium text-foreground">{title}</h3>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <Separator className="mt-2" />
    </div>
    {children}
  </div>
)

const InlineField: React.FC<{
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}> = ({ label, description, children }) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
    <div className="space-y-0.5 sm:w-96 sm:shrink-0">
      <Label className="text-sm text-foreground">{label}</Label>
      {description && (
        <div className="text-xs text-muted-foreground break-words">
          {description}
        </div>
      )}
    </div>
    {children}
  </div>
)

export const GeneralPane: React.FC = () => {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // CLI status hooks
  const { data: cliStatus, isLoading: isCliLoading } = useClaudeCliStatus()
  const { data: ghStatus, isLoading: isGhLoading } = useGhCliStatus()
  const { data: codexStatus, isLoading: isCodexLoading } = useCodexCliStatus()
  const { data: opencodeStatus, isLoading: isOpenCodeLoading } =
    useOpenCodeCliStatus()

  // Auth status queries - only enabled when CLI is installed
  const { data: claudeAuth, isLoading: isClaudeAuthLoading } = useClaudeCliAuth(
    {
      enabled: !!cliStatus?.installed,
    }
  )
  const { data: ghAuth, isLoading: isGhAuthLoading } = useGhCliAuth({
    enabled: !!ghStatus?.installed,
  })
  const { data: codexAuth, isLoading: isCodexAuthLoading } = useCodexCliAuth({
    enabled: !!codexStatus?.installed,
  })
  const { data: opencodeAuth, isLoading: isOpenCodeAuthLoading } =
    useOpenCodeCliAuth({
      enabled: !!opencodeStatus?.installed,
    })
  const { data: availableOpencodeModels } = useAvailableOpencodeModels({
    enabled: !!opencodeStatus?.installed,
  })

  // Track which auth check is in progress (for manual refresh)
  const [checkingClaudeAuth, setCheckingClaudeAuth] = useState(false)
  const [checkingGhAuth, setCheckingGhAuth] = useState(false)
  const [checkingCodexAuth, setCheckingCodexAuth] = useState(false)
  const [checkingOpenCodeAuth, setCheckingOpenCodeAuth] = useState(false)
  const [openCodeModelPopoverOpen, setOpenCodeModelPopoverOpen] =
    useState(false)
  const [buildModelPopoverOpen, setBuildModelPopoverOpen] = useState(false)
  const [yoloModelPopoverOpen, setYoloModelPopoverOpen] = useState(false)

  // Use global ui-store for CLI modals
  const openCliUpdateModal = useUIStore(state => state.openCliUpdateModal)
  const openCliLoginModal = useUIStore(state => state.openCliLoginModal)

  const handleDeleteAllArchives = useCallback(async () => {
    setIsDeleting(true)
    const toastId = toast.loading('Deleting all archives...')

    try {
      const result = await invoke<CleanupResult>('delete_all_archives')

      // Invalidate archive queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ['archived-worktrees'] })
      queryClient.invalidateQueries({ queryKey: ['all-archived-sessions'] })

      const parts: string[] = []
      if (result.deleted_worktrees > 0) {
        parts.push(
          `${result.deleted_worktrees} worktree${result.deleted_worktrees === 1 ? '' : 's'}`
        )
      }
      if (result.deleted_sessions > 0) {
        parts.push(
          `${result.deleted_sessions} session${result.deleted_sessions === 1 ? '' : 's'}`
        )
      }

      if (parts.length > 0) {
        toast.success(`Deleted ${parts.join(' and ')}`, { id: toastId })
      } else {
        toast.info('No archives to delete', { id: toastId })
      }
    } catch (error) {
      toast.error(`Failed to delete archives: ${error}`, { id: toastId })
    } finally {
      setIsDeleting(false)
      setShowDeleteAllDialog(false)
    }
  }, [queryClient])

  const handleModelChange = (value: ClaudeModel) => {
    if (preferences) {
      patchPreferences.mutate({ selected_model: value })
    }
  }

  const handleThinkingLevelChange = (value: ThinkingLevel) => {
    if (preferences) {
      patchPreferences.mutate({ thinking_level: value })
    }
  }

  const handleEffortLevelChange = (value: EffortLevel) => {
    if (preferences) {
      patchPreferences.mutate({ default_effort_level: value })
    }
  }

  const handleBuildModelChange = (value: string) => {
    if (preferences) {
      patchPreferences.mutate({
        build_model: value === 'default' ? null : value,
      })
    }
  }

  const handleBuildBackendChange = (value: string) => {
    if (preferences) {
      patchPreferences.mutate({
        build_backend: value === 'default' ? null : value,
        // Reset model and thinking/effort when backend changes
        build_model: null,
        build_thinking_level: null,
      })
    }
  }

  const handleYoloModelChange = (value: string) => {
    if (preferences) {
      patchPreferences.mutate({
        yolo_model: value === 'default' ? null : value,
      })
    }
  }

  const handleYoloBackendChange = (value: string) => {
    if (preferences) {
      patchPreferences.mutate({
        yolo_backend: value === 'default' ? null : value,
        // Reset model and thinking/effort when backend changes
        yolo_model: null,
        yolo_thinking_level: null,
      })
    }
  }

  const handleBuildThinkingLevelChange = (value: string) => {
    if (preferences) {
      patchPreferences.mutate({
        build_thinking_level: value === 'default' ? null : value,
      })
    }
  }

  const handleYoloThinkingLevelChange = (value: string) => {
    if (preferences) {
      patchPreferences.mutate({
        yolo_thinking_level: value === 'default' ? null : value,
      })
    }
  }

  const handleBackendChange = (value: CliBackend) => {
    if (preferences) {
      patchPreferences.mutate({ default_backend: value })
    }
  }

  // If stored default_backend isn't installed, fall back to the first installed one
  const stored = preferences?.default_backend ?? 'claude'
  const claudeInstalled = cliStatus?.installed
  const codexInstalled = codexStatus?.installed
  const opencodeInstalled = opencodeStatus?.installed
  const effectiveBackend = useMemo(() => {
    const installed: Record<string, boolean | undefined> = {
      claude: claudeInstalled,
      codex: codexInstalled,
      opencode: opencodeInstalled,
    }
    if (installed[stored]) return stored
    const first = backendOptions.find(o => installed[o.value])
    return first?.value ?? stored
  }, [stored, claudeInstalled, codexInstalled, opencodeInstalled])

  const handleCodexModelChange = (value: CodexModel) => {
    if (preferences) {
      patchPreferences.mutate({ selected_codex_model: value })
    }
  }

  const handleCodexReasoningChange = (value: CodexReasoningEffort) => {
    if (preferences) {
      patchPreferences.mutate({
        default_codex_reasoning_effort: value,
      })
    }
  }

  const handleOpenCodeModelChange = (value: string) => {
    if (preferences) {
      patchPreferences.mutate({ selected_opencode_model: value })
    }
  }

  const selectedOpenCodeModel =
    preferences?.selected_opencode_model ?? 'opencode/gpt-5'
  const formatOpenCodeModelLabelForSettings = (value: string) => {
    const formatted = formatOpencodeModelLabel(value)
    return value.startsWith('opencode/')
      ? formatted.replace(/\s+\(OpenCode\)$/, '')
      : formatted
  }
  const openCodeModelOptions = (
    availableOpencodeModels?.length
      ? availableOpencodeModels
      : OPENCODE_MODEL_OPTIONS.map(option => option.value)
  ).map(value => ({
    value,
    label: formatOpenCodeModelLabelForSettings(value),
  }))
  const selectedOpenCodeModelLabel =
    openCodeModelOptions.find(option => option.value === selectedOpenCodeModel)
      ?.label ?? formatOpenCodeModelLabelForSettings(selectedOpenCodeModel)

  const handleCodexMultiAgentToggle = (enabled: boolean) => {
    if (preferences) {
      patchPreferences.mutate({
        codex_multi_agent_enabled: enabled,
      })
    }
  }

  const handleCodexMaxThreadsChange = (value: string) => {
    if (preferences) {
      const num = Math.max(1, Math.min(8, parseInt(value, 10) || 3))
      patchPreferences.mutate({
        codex_max_agent_threads: num,
      })
    }
  }

  const handleTerminalChange = (value: TerminalApp) => {
    if (preferences) {
      patchPreferences.mutate({ terminal: value })
    }
  }

  const handleEditorChange = (value: EditorApp) => {
    if (preferences) {
      patchPreferences.mutate({ editor: value })
    }
  }

  const handleOpenInChange = (value: OpenInDefault) => {
    if (preferences) {
      patchPreferences.mutate({ open_in: value })
    }
  }

  const handleAutoBranchNamingChange = (checked: boolean) => {
    if (preferences) {
      patchPreferences.mutate({ auto_branch_naming: checked })
    }
  }

  const handleAutoSessionNamingChange = (checked: boolean) => {
    if (preferences) {
      patchPreferences.mutate({ auto_session_naming: checked })
    }
  }

  const handleGitPollIntervalChange = (value: string) => {
    const seconds = parseInt(value, 10)
    if (preferences && !isNaN(seconds)) {
      patchPreferences.mutate({ git_poll_interval: seconds })
      // Also update the backend immediately
      setGitPollInterval(seconds)
    }
  }

  const handleRemotePollIntervalChange = (value: string) => {
    const seconds = parseInt(value, 10)
    if (preferences && !isNaN(seconds)) {
      patchPreferences.mutate({ remote_poll_interval: seconds })
      // Also update the backend immediately
      setRemotePollInterval(seconds)
    }
  }

  const handleGitHubDashboardFetchIntervalChange = (value: string) => {
    const seconds = parseInt(value, 10)
    if (preferences && !isNaN(seconds)) {
      patchPreferences.mutate({ github_dashboard_fetch_interval: seconds })
    }
  }

  const handleArchiveRetentionChange = (value: string) => {
    const days = parseInt(value, 10)
    if (preferences && !isNaN(days)) {
      patchPreferences.mutate({ archive_retention_days: days })
    }
  }

  const handleWaitingSoundChange = (value: NotificationSound) => {
    if (preferences) {
      patchPreferences.mutate({ waiting_sound: value })
      // Play preview of the selected sound
      playNotificationSound(value)
    }
  }

  const handleReviewSoundChange = (value: NotificationSound) => {
    if (preferences) {
      patchPreferences.mutate({ review_sound: value })
      // Play preview of the selected sound
      playNotificationSound(value)
    }
  }

  const handleClaudeLogin = useCallback(async () => {
    if (!cliStatus?.path) return

    // First check if already authenticated
    setCheckingClaudeAuth(true)
    try {
      // Invalidate cache and refetch to get fresh status
      await queryClient.invalidateQueries({
        queryKey: claudeCliQueryKeys.auth(),
      })
      const result = await queryClient.fetchQuery<ClaudeAuthStatus>({
        queryKey: claudeCliQueryKeys.auth(),
      })

      if (result?.authenticated) {
        toast.success('Claude CLI is already authenticated')
        return
      }
    } finally {
      setCheckingClaudeAuth(false)
    }

    // Not authenticated, open login modal
    const args = cliStatus.supports_auth_command ? ['auth', 'login'] : ['login']
    openCliLoginModal('claude', cliStatus.path, args)
  }, [
    cliStatus?.path,
    cliStatus?.supports_auth_command,
    openCliLoginModal,
    queryClient,
  ])

  const handleGhLogin = useCallback(async () => {
    if (!ghStatus?.path) return

    // First check if already authenticated
    setCheckingGhAuth(true)
    try {
      // Invalidate cache and refetch to get fresh status
      await queryClient.invalidateQueries({ queryKey: ghCliQueryKeys.auth() })
      const result = await queryClient.fetchQuery<GhAuthStatus>({
        queryKey: ghCliQueryKeys.auth(),
      })

      if (result?.authenticated) {
        toast.success('GitHub CLI is already authenticated')
        return
      }
    } finally {
      setCheckingGhAuth(false)
    }

    // Not authenticated, open login modal
    openCliLoginModal('gh', ghStatus.path, ['auth', 'login'])
  }, [ghStatus?.path, openCliLoginModal, queryClient])

  const handleCodexLogin = useCallback(async () => {
    if (!codexStatus?.path) return

    setCheckingCodexAuth(true)
    try {
      await queryClient.invalidateQueries({
        queryKey: codexCliQueryKeys.auth(),
      })
      const result = await queryClient.fetchQuery<CodexAuthStatus>({
        queryKey: codexCliQueryKeys.auth(),
      })

      if (result?.authenticated) {
        toast.success('Codex CLI is already authenticated')
        return
      }
    } finally {
      setCheckingCodexAuth(false)
    }

    // Not authenticated, open login modal
    openCliLoginModal('codex', codexStatus.path, ['login'])
  }, [codexStatus?.path, openCliLoginModal, queryClient])

  const handleOpenCodeLogin = useCallback(async () => {
    if (!opencodeStatus?.command) return

    setCheckingOpenCodeAuth(true)
    try {
      await queryClient.invalidateQueries({
        queryKey: opencodeCliQueryKeys.auth(),
      })
      const result = await queryClient.fetchQuery<OpenCodeAuthStatus>({
        queryKey: opencodeCliQueryKeys.auth(),
      })

      if (result?.authenticated) {
        toast.success('OpenCode CLI is already authenticated')
        return
      }
    } finally {
      setCheckingOpenCodeAuth(false)
    }

    openCliLoginModal('opencode', opencodeStatus.command, [
      ...(opencodeStatus.command_args ?? []),
      'auth',
      'login',
    ])
  }, [
    opencodeStatus?.command,
    opencodeStatus?.command_args,
    openCliLoginModal,
    queryClient,
  ])

  const handleClaudeRelogin = useCallback(() => {
    if (!cliStatus?.path) return
    const args = cliStatus.supports_auth_command ? ['auth', 'login'] : ['login']
    openCliLoginModal('claude', cliStatus.path, args)
  }, [cliStatus?.path, cliStatus?.supports_auth_command, openCliLoginModal])

  const handleGhRelogin = useCallback(() => {
    if (!ghStatus?.path) return
    openCliLoginModal('gh', ghStatus.path, ['auth', 'login'])
  }, [ghStatus?.path, openCliLoginModal])

  const handleCodexRelogin = useCallback(() => {
    if (!codexStatus?.path) return
    openCliLoginModal('codex', codexStatus.path, ['login'])
  }, [codexStatus?.path, openCliLoginModal])

  const handleOpenCodeRelogin = useCallback(() => {
    if (!opencodeStatus?.command) return
    openCliLoginModal('opencode', opencodeStatus.command, [
      ...(opencodeStatus.command_args ?? []),
      'auth',
      'login',
    ])
  }, [opencodeStatus?.command, opencodeStatus?.command_args, openCliLoginModal])

  const claudeStatusDescription = cliStatus?.installed
    ? cliStatus.path
    : 'Claude CLI is required for chat functionality'

  const ghStatusDescription = ghStatus?.installed
    ? ghStatus.path
    : 'GitHub CLI is required for GitHub integration'

  const handleCopyPath = useCallback((path: string | null | undefined) => {
    if (!path) return
    navigator.clipboard.writeText(path)
    toast.success('Path copied to clipboard')
  }, [])

  const handleRefreshClaudeStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: claudeCliQueryKeys.status() })
    queryClient.invalidateQueries({ queryKey: claudeCliQueryKeys.auth() })
  }, [queryClient])

  const handleClaudeInstallOrUpdate = useCallback(async () => {
    try {
      const resolved = await resolveClaudeUpdateCommand()
      if (resolved) {
        openCliLoginModal(
          'claude',
          resolved.command,
          resolved.commandArgs,
          'update'
        )
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('Failed to resolve Claude update command', {
        description: message,
      })
      return
    }

    if (cliStatus?.installed && cliStatus.path) {
      openCliLoginModal('claude', cliStatus.path, ['update'], 'update')
      return
    }

    handleRefreshClaudeStatus()
  }, [
    cliStatus?.installed,
    cliStatus?.path,
    handleRefreshClaudeStatus,
    openCliLoginModal,
  ])

  const handleRefreshCodexStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: codexCliQueryKeys.status() })
    queryClient.invalidateQueries({ queryKey: codexCliQueryKeys.auth() })
  }, [queryClient])

  const handleCodexInstallOrUpdate = useCallback(async () => {
    try {
      const resolved = await resolveCodexUpdateCommand()
      if (resolved) {
        openCliLoginModal(
          'codex',
          resolved.command,
          resolved.commandArgs,
          'update'
        )
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('Failed to resolve Codex update command', {
        description: message,
      })
      return
    }

    if (codexStatus?.installed) {
      openCliUpdateModal('codex')
      return
    }

    handleRefreshCodexStatus()
  }, [
    codexStatus?.installed,
    handleRefreshCodexStatus,
    openCliLoginModal,
    openCliUpdateModal,
  ])

  const handleRefreshOpenCodeStatus = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: opencodeCliQueryKeys.status() })
    queryClient.invalidateQueries({ queryKey: opencodeCliQueryKeys.auth() })
  }, [queryClient])

  return (
    <div className="space-y-6">
      {isNativeApp() && (
        <SettingsSection
          title="Claude CLI"
          actions={
            cliStatus?.installed ? (
              checkingClaudeAuth || isClaudeAuthLoading ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Checking...
                </span>
              ) : claudeAuth?.authenticated ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  Logged in
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClaudeRelogin}
                  >
                    Relogin
                  </Button>
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={handleClaudeLogin}>
                  Login
                </Button>
              )
            ) : (
              <span className="text-sm text-muted-foreground">
                Not installed
              </span>
            )
          }
        >
          <div className="space-y-4">
            <ClaudeUpdateCommandField
              preferences={preferences}
              patchPreferences={patchPreferences}
              queryClient={queryClient}
            />
            <InlineField
              label={cliStatus?.installed ? 'Version' : 'Status'}
              description={
                cliStatus?.installed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleCopyPath(cliStatus.path)}
                        className="text-left hover:underline cursor-pointer"
                      >
                        {claudeStatusDescription}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Click to copy path</TooltipContent>
                  </Tooltip>
                ) : (
                  <>
                    Install <code>claude</code> on your system to enable Claude
                    AI sessions.
                  </>
                )
              }
            >
              {isCliLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : cliStatus?.installed ? (
                <div className="flex items-center gap-2">
                  <div className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {cliStatus.version ?? 'Installed'}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClaudeInstallOrUpdate}
                  >
                    Update
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshClaudeStatus}
                  >
                    Refresh
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="w-40"
                    onClick={handleClaudeInstallOrUpdate}
                  >
                    {preferences?.claude_update_command ? 'Install' : 'Refresh'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshClaudeStatus}
                  >
                    Refresh
                  </Button>
                </div>
              )}
            </InlineField>
          </div>
        </SettingsSection>
      )}

      {isNativeApp() && (
        <SettingsSection
          title="GitHub CLI"
          actions={
            ghStatus?.installed ? (
              checkingGhAuth || isGhAuthLoading ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Checking...
                </span>
              ) : ghAuth?.authenticated ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  Logged in
                  <Button variant="outline" size="sm" onClick={handleGhRelogin}>
                    Relogin
                  </Button>
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={handleGhLogin}>
                  Login
                </Button>
              )
            ) : (
              <span className="text-sm text-muted-foreground">
                Not installed
              </span>
            )
          }
        >
          <div className="space-y-4">
            <InlineField
              label={ghStatus?.installed ? 'Version' : 'Status'}
              description={
                ghStatus?.installed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleCopyPath(ghStatus.path)}
                        className="text-left hover:underline cursor-pointer"
                      >
                        {ghStatusDescription}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Click to copy path</TooltipContent>
                  </Tooltip>
                ) : (
                  'Optional'
                )
              }
            >
              {isGhLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : ghStatus?.installed ? (
                <Button
                  variant="outline"
                  className="w-40 justify-between"
                  onClick={() => openCliUpdateModal('gh')}
                >
                  {ghStatus.version ?? 'Installed'}
                  <ChevronDown className="size-3" />
                </Button>
              ) : (
                <Button
                  className="w-40"
                  onClick={() => openCliUpdateModal('gh')}
                >
                  Install
                </Button>
              )}
            </InlineField>
          </div>
        </SettingsSection>
      )}

      {isNativeApp() && (
        <SettingsSection
          title="Codex CLI"
          actions={
            codexStatus?.installed ? (
              checkingCodexAuth || isCodexAuthLoading ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Checking...
                </span>
              ) : codexAuth?.authenticated ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  Logged in
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCodexRelogin}
                  >
                    Relogin
                  </Button>
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={handleCodexLogin}>
                  Login
                </Button>
              )
            ) : (
              <span className="text-sm text-muted-foreground">
                Not installed
              </span>
            )
          }
        >
          <div className="space-y-4">
            <CodexUpdateCommandField
              preferences={preferences}
              patchPreferences={patchPreferences}
              queryClient={queryClient}
            />
            <InlineField
              label={codexStatus?.installed ? 'Version' : 'Status'}
              description={
                codexStatus?.installed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleCopyPath(codexStatus.path)}
                        className="text-left hover:underline cursor-pointer"
                      >
                        {codexStatus.path ?? 'Unknown path'}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Click to copy path</TooltipContent>
                  </Tooltip>
                ) : (
                  <>
                    Install <code>codex</code> on your system to enable Codex AI
                    sessions.
                  </>
                )
              }
            >
              {isCodexLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : codexStatus?.installed ? (
                <div className="flex items-center gap-2">
                  <div className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {codexStatus.version ?? 'Installed'}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCodexInstallOrUpdate}
                  >
                    Update
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshCodexStatus}
                  >
                    Refresh
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="w-40"
                    onClick={handleCodexInstallOrUpdate}
                  >
                    {preferences?.codex_update_command ? 'Install' : 'Refresh'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshCodexStatus}
                  >
                    Refresh
                  </Button>
                </div>
              )}
            </InlineField>
          </div>
        </SettingsSection>
      )}

      {isNativeApp() && (
        <SettingsSection
          title={
            <>
              OpenCode CLI{' '}
              <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                BETA
              </span>
            </>
          }
          actions={
            opencodeStatus?.installed ? (
              checkingOpenCodeAuth || isOpenCodeAuthLoading ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Checking...
                </span>
              ) : opencodeAuth?.authenticated ? (
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  Logged in
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenCodeRelogin}
                  >
                    Relogin
                  </Button>
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenCodeLogin}
                >
                  Login
                </Button>
              )
            ) : (
              <span className="text-sm text-muted-foreground">
                Not installed
              </span>
            )
          }
        >
          <div className="space-y-4">
            <OpenCodeLauncherCommandField
              preferences={preferences}
              patchPreferences={patchPreferences}
              queryClient={queryClient}
            />
            <InlineField
              label={opencodeStatus?.installed ? 'Version' : 'Status'}
              description={
                opencodeStatus?.installed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleCopyPath(opencodeStatus.path)}
                        className="text-left hover:underline cursor-pointer"
                      >
                        {opencodeStatus.path ?? 'Unknown launcher command'}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Click to copy launcher command
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <>
                    Install <code>opencode</code> on your system, or set a
                    wrapper like <code>dvx opencode</code> below, to enable
                    OpenCode AI sessions.
                  </>
                )
              }
            >
              {isOpenCodeLoading ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : opencodeStatus?.installed ? (
                <div className="flex items-center gap-2">
                  <div className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {opencodeStatus.version ?? 'Installed'}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshOpenCodeStatus}
                  >
                    Refresh
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-40"
                  onClick={handleRefreshOpenCodeStatus}
                >
                  Refresh
                </Button>
              )}
            </InlineField>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Defaults">
        <div className="space-y-4">
          <InlineField
            label="Default backend"
            description="CLI to use for new sessions"
          >
            <Select
              value={effectiveBackend}
              onValueChange={handleBackendChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {backendOptions
                  .filter(option =>
                    option.value === 'claude'
                      ? cliStatus?.installed
                      : option.value === 'codex'
                        ? codexStatus?.installed
                        : opencodeStatus?.installed
                  )
                  .map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Build execution"
            description="Backend, model, and thinking/effort override when approving plans"
          >
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Select
                  value={preferences?.build_backend ?? 'default'}
                  onValueChange={handleBuildBackendChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    {backendOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                {preferences?.build_backend === 'opencode' ? (
                  <Popover
                    open={buildModelPopoverOpen}
                    onOpenChange={setBuildModelPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={buildModelPopoverOpen}
                        className="w-full justify-between"
                      >
                        <span className="truncate text-left">
                          {preferences?.build_model
                            ? (openCodeModelOptions.find(
                                o => o.value === preferences.build_model
                              )?.label ??
                              formatOpenCodeModelLabelForSettings(
                                preferences.build_model
                              ))
                            : 'Default model'}
                        </span>
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 p-0">
                      <Command>
                        <CommandInput placeholder="Search models..." />
                        <CommandList onWheel={e => e.stopPropagation()}>
                          <CommandEmpty>No models found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="default"
                              onSelect={() => {
                                handleBuildModelChange('default')
                                setBuildModelPopoverOpen(false)
                              }}
                            >
                              Default model
                              <Check
                                className={cn(
                                  'ml-auto h-4 w-4',
                                  !preferences?.build_model ||
                                    preferences.build_model === 'default'
                                    ? 'opacity-100'
                                    : 'opacity-0'
                                )}
                              />
                            </CommandItem>
                            {openCodeModelOptions.map(option => (
                              <CommandItem
                                key={option.value}
                                value={`${option.label} ${option.value}`}
                                onSelect={() => {
                                  handleBuildModelChange(option.value)
                                  setBuildModelPopoverOpen(false)
                                }}
                              >
                                <span className="truncate">{option.label}</span>
                                <Check
                                  className={cn(
                                    'ml-auto h-4 w-4',
                                    preferences?.build_model === option.value
                                      ? 'opacity-100'
                                      : 'opacity-0'
                                  )}
                                />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Select
                    value={preferences?.build_model ?? 'default'}
                    onValueChange={handleBuildModelChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default model</SelectItem>
                      {(preferences?.build_backend === 'codex'
                        ? codexModelOptions
                        : modelOptions
                      ).map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Select
                  value={preferences?.build_thinking_level ?? 'default'}
                  onValueChange={handleBuildThinkingLevelChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preferences?.build_backend === 'codex' ? (
                      <>
                        <SelectItem value="default">Default effort</SelectItem>
                        {codexReasoningOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </>
                    ) : (
                      <>
                        <SelectItem value="default">
                          Default thinking
                        </SelectItem>
                        {thinkingLevelOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </InlineField>

          <InlineField
            label="Yolo execution"
            description="Backend, model, and thinking/effort override when yolo-approving plans"
          >
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Select
                  value={preferences?.yolo_backend ?? 'default'}
                  onValueChange={handleYoloBackendChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    {backendOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                {preferences?.yolo_backend === 'opencode' ? (
                  <Popover
                    open={yoloModelPopoverOpen}
                    onOpenChange={setYoloModelPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={yoloModelPopoverOpen}
                        className="w-full justify-between"
                      >
                        <span className="truncate text-left">
                          {preferences?.yolo_model
                            ? (openCodeModelOptions.find(
                                o => o.value === preferences.yolo_model
                              )?.label ??
                              formatOpenCodeModelLabelForSettings(
                                preferences.yolo_model
                              ))
                            : 'Default model'}
                        </span>
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80 p-0">
                      <Command>
                        <CommandInput placeholder="Search models..." />
                        <CommandList onWheel={e => e.stopPropagation()}>
                          <CommandEmpty>No models found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="default"
                              onSelect={() => {
                                handleYoloModelChange('default')
                                setYoloModelPopoverOpen(false)
                              }}
                            >
                              Default model
                              <Check
                                className={cn(
                                  'ml-auto h-4 w-4',
                                  !preferences?.yolo_model ||
                                    preferences.yolo_model === 'default'
                                    ? 'opacity-100'
                                    : 'opacity-0'
                                )}
                              />
                            </CommandItem>
                            {openCodeModelOptions.map(option => (
                              <CommandItem
                                key={option.value}
                                value={`${option.label} ${option.value}`}
                                onSelect={() => {
                                  handleYoloModelChange(option.value)
                                  setYoloModelPopoverOpen(false)
                                }}
                              >
                                <span className="truncate">{option.label}</span>
                                <Check
                                  className={cn(
                                    'ml-auto h-4 w-4',
                                    preferences?.yolo_model === option.value
                                      ? 'opacity-100'
                                      : 'opacity-0'
                                  )}
                                />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Select
                    value={preferences?.yolo_model ?? 'default'}
                    onValueChange={handleYoloModelChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default model</SelectItem>
                      {(preferences?.yolo_backend === 'codex'
                        ? codexModelOptions
                        : modelOptions
                      ).map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Select
                  value={preferences?.yolo_thinking_level ?? 'default'}
                  onValueChange={handleYoloThinkingLevelChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preferences?.yolo_backend === 'codex' ? (
                      <>
                        <SelectItem value="default">Default effort</SelectItem>
                        {codexReasoningOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </>
                    ) : (
                      <>
                        <SelectItem value="default">
                          Default thinking
                        </SelectItem>
                        {thinkingLevelOptions.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </InlineField>

          {/* Claude subsection */}
          <div className="pt-2">
            <div className="text-sm font-semibold text-foreground/80 mb-3">
              Claude
            </div>
          </div>

          <InlineField
            label="Model"
            description="Claude model for AI assistance"
          >
            <Select
              value={preferences?.selected_model ?? 'claude-opus-4-7'}
              onValueChange={handleModelChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Thinking"
            description="Extended thinking for complex tasks"
          >
            <Select
              value={preferences?.thinking_level ?? 'off'}
              onValueChange={handleThinkingLevelChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {thinkingLevelOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Effort level"
            description="Effort for Opus (requires CLI 2.1.32+)"
          >
            <Select
              value={preferences?.default_effort_level ?? 'high'}
              onValueChange={handleEffortLevelChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {effortLevelOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Chrome browser integration"
            description="Enable browser automation via Chrome extension"
          >
            <Switch
              checked={preferences?.chrome_enabled ?? true}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    chrome_enabled: checked,
                  })
                }
              }}
            />
          </InlineField>

          {/* Codex subsection */}
          <div className="pt-2">
            <div className="text-sm font-semibold text-foreground/80 mb-3">
              Codex
            </div>
          </div>

          <InlineField
            label="Model"
            description="Codex model for AI assistance"
          >
            <Select
              value={preferences?.selected_codex_model ?? 'gpt-5.4'}
              onValueChange={handleCodexModelChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codexModelOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Reasoning effort"
            description="Codex reasoning depth"
          >
            <Select
              value={preferences?.default_codex_reasoning_effort ?? 'high'}
              onValueChange={handleCodexReasoningChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {codexReasoningOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Multi-Agent"
            description="Allow Codex to spawn parallel subagents (experimental)"
          >
            <Switch
              checked={preferences?.codex_multi_agent_enabled ?? false}
              onCheckedChange={handleCodexMultiAgentToggle}
            />
          </InlineField>

          {preferences?.codex_multi_agent_enabled && (
            <InlineField
              label="Max agent threads"
              description="Maximum concurrent subagents (1–8)"
            >
              <Input
                type="number"
                min={1}
                max={8}
                className="w-20"
                value={preferences?.codex_max_agent_threads ?? 3}
                onChange={e => handleCodexMaxThreadsChange(e.target.value)}
              />
            </InlineField>
          )}

          {/* OpenCode subsection */}
          <div className="pt-2">
            <div className="text-sm font-semibold text-foreground/80 mb-3">
              OpenCode{' '}
              <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                BETA
              </span>
            </div>
          </div>

          <InlineField
            label="Model"
            description="OpenCode model for AI assistance"
          >
            <Popover
              open={openCodeModelPopoverOpen}
              onOpenChange={setOpenCodeModelPopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={openCodeModelPopoverOpen}
                  aria-label="Select OpenCode model"
                  className="w-80 max-w-full justify-between"
                >
                  <span className="max-w-[16rem] truncate text-left">
                    {selectedOpenCodeModelLabel}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
              >
                <Command>
                  <CommandInput placeholder="Search models..." />
                  <CommandList onWheel={e => e.stopPropagation()}>
                    <CommandEmpty>No models found.</CommandEmpty>
                    <CommandGroup>
                      {openCodeModelOptions.map(option => (
                        <CommandItem
                          key={option.value}
                          value={`${option.label} ${option.value}`}
                          onSelect={() => {
                            handleOpenCodeModelChange(option.value)
                            setOpenCodeModelPopoverOpen(false)
                          }}
                        >
                          <span className="max-w-[18rem] truncate">
                            {option.label}
                          </span>
                          <Check
                            className={cn(
                              'ml-auto h-4 w-4',
                              selectedOpenCodeModel === option.value
                                ? 'opacity-100'
                                : 'opacity-0'
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </InlineField>

          {/* Shared settings */}
          <div className="pt-2">
            <div className="text-sm font-semibold text-foreground/80 mb-3">
              General
            </div>
          </div>

          <AiLanguageField
            preferences={preferences}
            patchPreferences={patchPreferences}
          />

          {isNativeApp() && (
            <GitCliPathField
              preferences={preferences}
              patchPreferences={patchPreferences}
            />
          )}

          {isNativeApp() && (
            <WorktreesBaseDirField
              preferences={preferences}
              patchPreferences={patchPreferences}
            />
          )}

          <InlineField
            label="Allow web tools in plan mode"
            description="WebFetch/WebSearch for Claude, --search for Codex"
          >
            <Switch
              checked={preferences?.allow_web_tools_in_plan_mode ?? true}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    allow_web_tools_in_plan_mode: checked,
                  })
                }
              }}
            />
          </InlineField>

          {isNativeApp() && (
            <InlineField label="Editor" description="App to open worktrees in">
              <Select
                value={preferences?.editor ?? 'zed'}
                onValueChange={handleEditorChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editorOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
          )}

          {isNativeApp() && (
            <InlineField
              label="Terminal"
              description="App to open terminals in"
            >
              <Select
                value={preferences?.terminal ?? 'terminal'}
                onValueChange={handleTerminalChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {terminalOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
          )}

          {isNativeApp() && (
            <InlineField
              label="Open In"
              description="Default app for Open button"
            >
              <Select
                value={preferences?.open_in ?? 'editor'}
                onValueChange={handleOpenInChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {openInDefaultOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InlineField>
          )}

          <InlineField
            label="Git poll interval"
            description="Check for branch updates when focused"
          >
            <Select
              value={String(preferences?.git_poll_interval ?? 60)}
              onValueChange={handleGitPollIntervalChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {gitPollIntervalOptions.map(option => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Remote poll interval"
            description="Check for PR status updates"
          >
            <Select
              value={String(preferences?.remote_poll_interval ?? 60)}
              onValueChange={handleRemotePollIntervalChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {remotePollIntervalOptions.map(option => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="GitHub dashboard refresh interval"
            description="Refresh GitHub Dashboard issues, PRs, and alerts"
          >
            <Select
              value={String(preferences?.github_dashboard_fetch_interval ?? 60)}
              onValueChange={handleGitHubDashboardFetchIntervalChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {remotePollIntervalOptions.map(option => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="Notifications">
        <div className="space-y-4">
          <InlineField
            label="Waiting sound"
            description="Play when session needs your input"
          >
            <div className="flex items-center gap-2">
              <Select
                value={preferences?.waiting_sound ?? 'none'}
                onValueChange={handleWaitingSoundChange}
              >
                <SelectTrigger className="w-full sm:min-w-96">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {notificationSoundOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                disabled={
                  !preferences?.waiting_sound ||
                  preferences.waiting_sound === 'none'
                }
                onClick={() =>
                  playNotificationSound(preferences?.waiting_sound ?? 'none')
                }
              >
                <Play className="h-4 w-4" />
              </Button>
            </div>
          </InlineField>

          <InlineField
            label="Review sound"
            description="Play when session finishes"
          >
            <div className="flex items-center gap-2">
              <Select
                value={preferences?.review_sound ?? 'none'}
                onValueChange={handleReviewSoundChange}
              >
                <SelectTrigger className="w-full sm:min-w-96">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {notificationSoundOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                disabled={
                  !preferences?.review_sound ||
                  preferences.review_sound === 'none'
                }
                onClick={() =>
                  playNotificationSound(preferences?.review_sound ?? 'none')
                }
              >
                <Play className="h-4 w-4" />
              </Button>
            </div>
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="Auto-generate">
        <div className="space-y-4">
          <InlineField
            label="Branch names"
            description="Generate branch names from your first message"
          >
            <Switch
              checked={preferences?.auto_branch_naming ?? true}
              onCheckedChange={handleAutoBranchNamingChange}
            />
          </InlineField>
          <InlineField
            label="Session names"
            description="Generate session names from your first message"
          >
            <Switch
              checked={preferences?.auto_session_naming ?? true}
              onCheckedChange={handleAutoSessionNamingChange}
            />
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="Worktrees">
        <div className="space-y-4">
          <InlineField
            label="Auto-pull base branch"
            description="Pull the latest changes before creating a new worktree"
          >
            <Switch
              checked={preferences?.auto_pull_base_branch ?? true}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    auto_pull_base_branch: checked,
                  })
                }
              }}
            />
          </InlineField>

          <InlineField
            label="Show issue sources on create page"
            description="Show GitHub Issues, Security, and Linear sections in the New Session page, plus project issue/security badges"
          >
            <Switch
              checked={preferences?.show_create_page_issue_sources ?? true}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    show_create_page_issue_sources: checked,
                  })
                }
              }}
            />
          </InlineField>

          <InlineField
            label="Restore last session on project switch"
            description="Automatically reopen the last worktree and session when switching projects"
          >
            <Switch
              checked={preferences?.restore_last_session ?? false}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    restore_last_session: checked,
                  })
                }
              }}
            />
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="Archive">
        <div className="space-y-4">
          <InlineField
            label="Confirm before closing"
            description="Show confirmation dialog when closing sessions or worktrees"
          >
            <Switch
              checked={preferences?.confirm_session_close ?? true}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    confirm_session_close: checked,
                  })
                }
              }}
            />
          </InlineField>

          <InlineField
            label="Close original session on clear context"
            description="Automatically close the original session when using Clear Context and yolo"
          >
            <Switch
              checked={preferences?.close_original_on_clear_context ?? true}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    close_original_on_clear_context: checked,
                  })
                }
              }}
            />
          </InlineField>

          <InlineField
            label="Removal behavior"
            description="What happens when closing sessions or worktrees"
          >
            <Select
              value={preferences?.removal_behavior ?? 'delete'}
              onValueChange={(value: RemovalBehavior) => {
                if (preferences) {
                  patchPreferences.mutate({
                    removal_behavior: value,
                  })
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {removalBehaviorOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Auto-archive on PR merge"
            description="Archive worktrees when their PR is merged"
          >
            <Switch
              checked={preferences?.auto_archive_on_pr_merged ?? true}
              onCheckedChange={checked => {
                if (preferences) {
                  patchPreferences.mutate({
                    auto_archive_on_pr_merged: checked,
                  })
                }
              }}
            />
          </InlineField>

          <InlineField
            label="Auto-delete archives"
            description="Delete archived items older than this"
          >
            <Select
              value={String(preferences?.archive_retention_days ?? 30)}
              onValueChange={handleArchiveRetentionChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {archiveRetentionOptions.map(option => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <InlineField
            label="Delete all archives"
            description="Permanently delete all archived worktrees and sessions"
          >
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteAllDialog(true)}
              disabled={isDeleting}
            >
              Delete All
            </Button>
          </InlineField>
        </div>
      </SettingsSection>

      {isNativeApp() && (
        <SettingsSection title="Troubleshooting">
          <div className="space-y-4">
            <InlineField
              label="Application logs"
              description="Open the log directory for troubleshooting"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await invoke('open_log_directory')
                  } catch (error) {
                    toast.error(`Failed to open logs: ${error}`)
                  }
                }}
              >
                Show Logs
              </Button>
            </InlineField>
          </div>
        </SettingsSection>
      )}

      <AlertDialog
        open={showDeleteAllDialog}
        onOpenChange={setShowDeleteAllDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all archives?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all archived worktrees and sessions,
              including their git branches and worktree directories. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAllArchives}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const AiLanguageField: FC<{
  preferences: AppPreferences | undefined
  patchPreferences: ReturnType<typeof usePatchPreferences>
}> = ({ preferences, patchPreferences }) => {
  const [localValue, setLocalValue] = useState(preferences?.ai_language ?? '')

  useEffect(() => {
    setLocalValue(preferences?.ai_language ?? '')
  }, [preferences?.ai_language])

  const hasChanges = localValue !== (preferences?.ai_language ?? '')

  const handleSave = useCallback(() => {
    if (!preferences) return
    patchPreferences.mutate({ ai_language: localValue })
  }, [preferences, patchPreferences, localValue])

  return (
    <InlineField
      label="AI Language"
      description="Language for AI responses (e.g. French, 日本語)"
    >
      <div className="flex items-center gap-2">
        <Input
          className="w-40"
          placeholder="Default"
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || patchPreferences.isPending}
        >
          {patchPreferences.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
      </div>
    </InlineField>
  )
}

const GitCliPathField: FC<{
  preferences: AppPreferences | undefined
  patchPreferences: ReturnType<typeof usePatchPreferences>
}> = ({ preferences, patchPreferences }) => {
  const [localValue, setLocalValue] = useState(preferences?.git_cli_path ?? '')

  useEffect(() => {
    setLocalValue(preferences?.git_cli_path ?? '')
  }, [preferences?.git_cli_path])

  const hasChanges = localValue !== (preferences?.git_cli_path ?? '')

  const handleSave = useCallback(() => {
    if (!preferences) return
    const trimmed = localValue.trim()
    patchPreferences.mutate({
      git_cli_path: trimmed.length > 0 ? trimmed : null,
    })
  }, [preferences, patchPreferences, localValue])

  return (
    <InlineField
      label="Git executable"
      description={
        <>
          Optional override for the <code>git</code> binary. Supports{' '}
          <code>~</code>, for example <code>~/.hubspot/git-wrapper</code>.
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Input
          className="w-80"
          placeholder="System default (git)"
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || patchPreferences.isPending}
        >
          {patchPreferences.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
      </div>
    </InlineField>
  )
}

const WorktreesBaseDirField: FC<{
  preferences: AppPreferences | undefined
  patchPreferences: ReturnType<typeof usePatchPreferences>
}> = ({ preferences, patchPreferences }) => {
  const [localValue, setLocalValue] = useState(
    preferences?.worktrees_base_dir ?? ''
  )

  useEffect(() => {
    setLocalValue(preferences?.worktrees_base_dir ?? '')
  }, [preferences?.worktrees_base_dir])

  const hasChanges = localValue !== (preferences?.worktrees_base_dir ?? '')

  const handleSave = useCallback(() => {
    if (!preferences) return
    const trimmed = localValue.trim()
    patchPreferences.mutate({
      worktrees_base_dir: trimmed.length > 0 ? trimmed : null,
    })
  }, [preferences, patchPreferences, localValue])

  return (
    <InlineField
      label="Default worktrees directory"
      description={
        <>
          Base directory for new worktrees when a project does not override it.
          Supports <code>~</code>. Leave blank to use <code>~/jean</code>.
          Existing worktrees are not moved automatically.
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Input
          className="w-80"
          placeholder="~/jean"
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || patchPreferences.isPending}
        >
          {patchPreferences.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
      </div>
    </InlineField>
  )
}

const OpenCodeLauncherCommandField: FC<{
  preferences: AppPreferences | undefined
  patchPreferences: ReturnType<typeof usePatchPreferences>
  queryClient: ReturnType<typeof useQueryClient>
}> = ({ preferences, patchPreferences, queryClient }) => {
  const [localValue, setLocalValue] = useState(
    preferences?.opencode_launch_command ?? ''
  )

  useEffect(() => {
    setLocalValue(preferences?.opencode_launch_command ?? '')
  }, [preferences?.opencode_launch_command])

  const hasChanges = localValue !== (preferences?.opencode_launch_command ?? '')

  const handleSave = useCallback(() => {
    if (!preferences) return
    const trimmed = localValue.trim()
    patchPreferences.mutate(
      {
        opencode_launch_command: trimmed.length > 0 ? trimmed : null,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: opencodeCliQueryKeys.status(),
          })
          queryClient.invalidateQueries({
            queryKey: opencodeCliQueryKeys.auth(),
          })
          queryClient.invalidateQueries({
            queryKey: opencodeCliQueryKeys.models(),
          })
        },
      }
    )
  }, [preferences, patchPreferences, localValue, queryClient])

  return (
    <InlineField
      label="Launcher command"
      description={
        <>
          Optional wrapper used to start OpenCode. Leave blank to run{' '}
          <code>opencode</code> directly. Example: <code>dvx opencode</code>.
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Input
          className="w-80"
          placeholder="System default (opencode)"
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || patchPreferences.isPending}
        >
          {patchPreferences.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
      </div>
    </InlineField>
  )
}

const ClaudeUpdateCommandField: FC<{
  preferences: AppPreferences | undefined
  patchPreferences: ReturnType<typeof usePatchPreferences>
  queryClient: ReturnType<typeof useQueryClient>
}> = ({ preferences, patchPreferences, queryClient }) => {
  const [localValue, setLocalValue] = useState(
    preferences?.claude_update_command ?? ''
  )

  useEffect(() => {
    setLocalValue(preferences?.claude_update_command ?? '')
  }, [preferences?.claude_update_command])

  const hasChanges = localValue !== (preferences?.claude_update_command ?? '')

  const handleSave = useCallback(() => {
    const trimmed = localValue.trim()
    patchPreferences.mutate(
      {
        claude_update_command: trimmed.length > 0 ? trimmed : null,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: claudeCliQueryKeys.status(),
          })
          queryClient.invalidateQueries({
            queryKey: claudeCliQueryKeys.auth(),
          })
        },
      }
    )
  }, [localValue, patchPreferences, queryClient])

  return (
    <InlineField
      label="Update command"
      description={
        <>
          Optional command Jean should run to install or update Claude on your
          host system. Leave blank to manage <code>claude</code> manually.
          Example: <code>pnpm install -g @anthropic-ai/claude-code</code>.
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Input
          className="w-80"
          placeholder="Manual host install (claude)"
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || patchPreferences.isPending}
        >
          {patchPreferences.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
      </div>
    </InlineField>
  )
}

const CodexUpdateCommandField: FC<{
  preferences: AppPreferences | undefined
  patchPreferences: ReturnType<typeof usePatchPreferences>
  queryClient: ReturnType<typeof useQueryClient>
}> = ({ preferences, patchPreferences, queryClient }) => {
  const [localValue, setLocalValue] = useState(
    preferences?.codex_update_command ?? ''
  )

  useEffect(() => {
    setLocalValue(preferences?.codex_update_command ?? '')
  }, [preferences?.codex_update_command])

  const hasChanges = localValue !== (preferences?.codex_update_command ?? '')

  const handleSave = useCallback(() => {
    const trimmed = localValue.trim()
    patchPreferences.mutate(
      {
        codex_update_command: trimmed.length > 0 ? trimmed : null,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: codexCliQueryKeys.status(),
          })
          queryClient.invalidateQueries({
            queryKey: codexCliQueryKeys.auth(),
          })
        },
      }
    )
  }, [localValue, patchPreferences, queryClient])

  return (
    <InlineField
      label="Update command"
      description={
        <>
          Optional command Jean should run to install or update Codex on your
          host system. Leave blank to manage <code>codex</code> manually.
          Example: <code>npm install -g @openai/codex</code>.
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Input
          className="w-80"
          placeholder="Manual host install (codex)"
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || patchPreferences.isPending}
        >
          {patchPreferences.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Save
        </Button>
      </div>
    </InlineField>
  )
}
