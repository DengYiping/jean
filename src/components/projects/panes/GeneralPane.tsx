import React, { useState, useCallback } from 'react'
import {
  Check,
  ChevronsUpDown,
  FolderOpen,
  GitBranch,
  ImageIcon,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react'
import { convertFileSrc, convertProjectFileSrc } from '@/lib/transport'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
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
  useProjects,
  useProjectBranches,
  useUpdateProjectSettings,
  useAppDataDir,
  useSetProjectAvatar,
  useRemoveProjectAvatar,
  useWorktreeSlots,
  useResetWorktreeSlot,
  useResetIdleWorktreeSlots,
} from '@/services/projects'
import { usePreferences } from '@/services/preferences'
import { useGhCliAccounts } from '@/services/gh-cli'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { hideGitHubIssuesAndPRs } from '@/types/projects'
import { getEditorOptions } from '@/types/preferences'

const SettingsSection: React.FC<{
  title: string
  children: React.ReactNode
}> = ({ title, children }) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
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
  <div className="space-y-2">
    <Label className="text-sm text-foreground">{label}</Label>
    {description && (
      <div className="text-xs text-muted-foreground">{description}</div>
    )}
    {children}
  </div>
)

export function GeneralPane({
  projectId,
}: {
  projectId: string
  projectPath: string
}) {
  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === projectId)

  const {
    data: branches = [],
    isLoading: branchesLoading,
    error: branchesError,
  } = useProjectBranches(projectId)

  const { data: preferences } = usePreferences()
  const { data: githubAccounts = [] } = useGhCliAccounts({
    enabled: !!project && !project.is_folder,
  })
  const profiles = preferences?.custom_cli_profiles ?? []

  const updateSettings = useUpdateProjectSettings()
  const editorSelectOptions = getEditorOptions(preferences?.custom_editors)
  const { data: worktreeSlots = [] } = useWorktreeSlots(projectId)
  const resetWorktreeSlot = useResetWorktreeSlot()
  const resetIdleWorktreeSlots = useResetIdleWorktreeSlots()
  const { data: appDataDir = '' } = useAppDataDir()
  const setProjectAvatar = useSetProjectAvatar()
  const removeProjectAvatar = useRemoveProjectAvatar()

  const [localName, setLocalName] = useState<string | null>(null)
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false)
  const [localSystemPrompt, setLocalSystemPrompt] = useState<string | null>(
    null
  )
  const [localWorktreesDir, setLocalWorktreesDir] = useState<string | null>(
    null
  )
  const [localHideGitHubIssuesAndPRs, setLocalHideGitHubIssuesAndPRs] =
    useState<boolean | null>(null)

  // Track image load errors
  const avatarKey = project?.avatar_path ?? project?.default_avatar_path ?? null
  const [imgErrorKey, setImgErrorKey] = useState<string | null>(null)
  const imgError = imgErrorKey === avatarKey

  const avatarUrl =
    project?.avatar_path && appDataDir && !imgError
      ? convertFileSrc(`${appDataDir}/${project.avatar_path}`)
      : project?.default_avatar_path && !imgError
        ? convertProjectFileSrc(project.default_avatar_path)
        : null

  const displayedName = localName ?? project?.name ?? ''
  const nameChanged = localName !== null && localName !== (project?.name ?? '')

  const handleSaveName = useCallback(() => {
    if (localName === null) return
    updateSettings.mutate(
      { projectId, name: localName.trim() },
      { onSuccess: () => setLocalName(null) }
    )
  }, [localName, projectId, updateSettings])

  const selectedBranch = project?.default_branch ?? ''
  const displayedSystemPrompt =
    localSystemPrompt ?? project?.custom_system_prompt ?? ''

  const handleSelectBranch = useCallback(
    (branch: string) => {
      setBranchPopoverOpen(false)
      updateSettings.mutate({ projectId, defaultBranch: branch })
    },
    [projectId, updateSettings]
  )

  const handleProviderChange = useCallback(
    (value: string) => {
      updateSettings.mutate({
        projectId,
        defaultProvider: value === 'global-default' ? '__none__' : value,
      })
    },
    [projectId, updateSettings]
  )

  const handleBackendChange = useCallback(
    (value: string) => {
      updateSettings.mutate({
        projectId,
        defaultBackend: value === 'global-default' ? '__none__' : value,
      })
    },
    [projectId, updateSettings]
  )

  const handleEditorChange = useCallback(
    (value: string) => {
      updateSettings.mutate({
        projectId,
        defaultEditor: value === 'global-default' ? '__none__' : value,
      })
    },
    [projectId, updateSettings]
  )

  const handleGitHubAccountChange = useCallback(
    (value: string) => {
      if (value === 'cli-default') {
        updateSettings.mutate({
          projectId,
          githubAccountHost: '',
          githubAccountUser: '',
        })
        return
      }

      const [host, user] = value.split('::', 2)
      updateSettings.mutate({
        projectId,
        githubAccountHost: host ?? '',
        githubAccountUser: user ?? '',
      })
    },
    [projectId, updateSettings]
  )

  const systemPromptChanged =
    localSystemPrompt !== null &&
    localSystemPrompt !== (project?.custom_system_prompt ?? '')

  const handleSaveSystemPrompt = useCallback(() => {
    if (localSystemPrompt === null) return
    updateSettings.mutate(
      { projectId, customSystemPrompt: localSystemPrompt },
      { onSuccess: () => setLocalSystemPrompt(null) }
    )
  }, [localSystemPrompt, projectId, updateSettings])

  const displayedWorktreesDir =
    localWorktreesDir ?? project?.worktrees_dir ?? ''

  const worktreesDirChanged =
    localWorktreesDir !== null &&
    localWorktreesDir !== (project?.worktrees_dir ?? '')

  const handleSaveWorktreesDir = useCallback(() => {
    if (localWorktreesDir === null) return
    updateSettings.mutate(
      {
        projectId,
        worktreesDir: localWorktreesDir.trim(),
      },
      { onSuccess: () => setLocalWorktreesDir(null) }
    )
  }, [localWorktreesDir, projectId, updateSettings])

  const handleResetWorktreesDir = useCallback(() => {
    updateSettings.mutate(
      { projectId, worktreesDir: '' },
      { onSuccess: () => setLocalWorktreesDir(null) }
    )
  }, [projectId, updateSettings])

  const handleStableSlotsEnabledChange = useCallback(
    (checked: boolean) => {
      updateSettings.mutate({
        projectId,
        stableWorktreeSlotsEnabled: checked,
      })
    },
    [projectId, updateSettings]
  )

  const resettableSlots = worktreeSlots.filter(
    slot => slot.state === 'idle' || slot.state === 'error'
  )

  const storedGitHubAccountValue =
    project?.github_account_host && project?.github_account_user
      ? `${project.github_account_host}::${project.github_account_user}`
      : null
  const selectedGitHubAccountValue =
    storedGitHubAccountValue &&
    githubAccounts.some(
      account => `${account.host}::${account.user}` === storedGitHubAccountValue
    )
      ? storedGitHubAccountValue
      : 'cli-default'

  const handleHideGitHubIssuesAndPRsChange = useCallback(
    (checked: boolean) => {
      setLocalHideGitHubIssuesAndPRs(checked)
      updateSettings.mutate(
        {
          projectId,
          hideGithubIssuesAndPRs: checked,
        },
        {
          onSuccess: () => setLocalHideGitHubIssuesAndPRs(null),
          onError: () => setLocalHideGitHubIssuesAndPRs(null),
        }
      )
    },
    [projectId, updateSettings]
  )

  const handleBrowseWorktreesDir = useCallback(async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select worktrees base directory',
    })
    if (selected) {
      setLocalWorktreesDir(selected)
    }
  }, [])

  const displayedHideGitHubIssuesAndPRs =
    localHideGitHubIssuesAndPRs ?? hideGitHubIssuesAndPRs(project)

  return (
    <div className="space-y-6">
      <SettingsSection title="Project Name">
        <InlineField
          label="Display Name"
          description="Rename the project without changing the underlying folder"
        >
          <div className="flex items-center gap-2">
            <Input
              value={displayedName}
              onChange={e => setLocalName(e.target.value)}
              className="flex-1 text-sm"
            />
            <Button
              size="sm"
              onClick={handleSaveName}
              disabled={!nameChanged || updateSettings.isPending}
            >
              {updateSettings.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </InlineField>
      </SettingsSection>

      <SettingsSection title="Avatar">
        <InlineField
          label="Project Avatar"
          description="Custom image displayed in the sidebar"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted-foreground/20 overflow-hidden">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={project?.name ?? 'Project avatar'}
                  className="size-full object-cover"
                  onError={() => setImgErrorKey(avatarKey)}
                />
              ) : (
                <span className="text-lg font-medium uppercase text-muted-foreground">
                  {project?.name?.[0] ?? '?'}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setProjectAvatar.mutate(projectId)}
                disabled={setProjectAvatar.isPending}
              >
                {setProjectAvatar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                {project?.avatar_path || project?.default_avatar_path
                  ? 'Change'
                  : 'Add Image'}
              </Button>
              {project?.avatar_path && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeProjectAvatar.mutate(projectId)}
                  disabled={removeProjectAvatar.isPending}
                >
                  {removeProjectAvatar.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  Remove
                </Button>
              )}
            </div>
          </div>
        </InlineField>
      </SettingsSection>

      <SettingsSection title="Defaults">
        <InlineField
          label="Default Branch"
          description="New worktrees will be created from this branch"
        >
          {branchesLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching branches...
            </div>
          ) : branchesError ? (
            <div className="py-2 text-sm text-destructive">
              Failed to load branches
            </div>
          ) : branches.length === 0 ? (
            <div className="py-2 text-sm text-muted-foreground">
              No branches found
            </div>
          ) : (
            <Popover
              open={branchPopoverOpen}
              onOpenChange={setBranchPopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={branchPopoverOpen}
                  aria-controls="default-branch-selector"
                  className="w-full justify-between"
                >
                  <span className="flex items-center gap-2 truncate">
                    <GitBranch className="h-4 w-4 shrink-0" />
                    {selectedBranch || 'Select a branch'}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                id="default-branch-selector"
                align="start"
                className="!w-[var(--radix-popover-trigger-width)] p-0"
              >
                <Command>
                  <CommandInput placeholder="Search branches..." />
                  <CommandList>
                    <CommandEmpty>No branch found.</CommandEmpty>
                    <CommandGroup>
                      {branches.map(branch => (
                        <CommandItem
                          key={branch}
                          value={branch}
                          onSelect={handleSelectBranch}
                        >
                          <GitBranch className="h-4 w-4" />
                          {branch}
                          <Check
                            className={cn(
                              'ml-auto h-4 w-4',
                              selectedBranch === branch
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
          )}
        </InlineField>

        {profiles.length > 0 && (
          <InlineField
            label="Default Provider"
            description="Default provider for new sessions in this project"
          >
            <Select
              value={project?.default_provider ?? 'global-default'}
              onValueChange={handleProviderChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global-default">
                  Use global default
                </SelectItem>
                <SelectItem value="__anthropic__">Anthropic</SelectItem>
                {profiles.map(p => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>
        )}

        <InlineField
          label="Default Backend"
          description="CLI to use for new sessions in this project"
        >
          <Select
            value={project?.default_backend ?? 'global-default'}
            onValueChange={handleBackendChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global-default">Use global default</SelectItem>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="codex">
                Codex{' '}
                <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                  BETA
                </span>
              </SelectItem>
              <SelectItem value="opencode">
                OpenCode{' '}
                <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                  BETA
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </InlineField>

        <InlineField
          label="Default Editor"
          description="Editor to use when opening this repo or its worktrees"
        >
          <Select
            value={project?.default_editor ?? 'global-default'}
            onValueChange={handleEditorChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global-default">Use global default</SelectItem>
              {editorSelectOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InlineField>

        <InlineField
          label="GitHub Account"
          description="Sets the gh host/user context for this project. Jean will export GH_HOST and GH_USER and use the matching locally logged-in account for gh commands."
        >
          <Select
            value={selectedGitHubAccountValue}
            onValueChange={handleGitHubAccountChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cli-default">Use gh active account</SelectItem>
              {githubAccounts.map(account => {
                const value = `${account.host}::${account.user}`
                const status = account.active
                  ? `${account.host} · active`
                  : account.host
                return (
                  <SelectItem key={value} value={value}>
                    {account.user} · {status}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </InlineField>
      </SettingsSection>

      <SettingsSection title="Worktrees Location">
        <InlineField
          label="Base Directory"
          description={
            <>
              Override where this project&apos;s new worktrees are created.
              Defaults to the global setting, which falls back to{' '}
              <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
                ~/jean
              </code>
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Input
              placeholder="Use global default"
              value={displayedWorktreesDir}
              onChange={e => setLocalWorktreesDir(e.target.value)}
              className="flex-1 text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleBrowseWorktreesDir}
            >
              <FolderOpen className="h-4 w-4" />
              Browse
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveWorktreesDir}
              disabled={!worktreesDirChanged || updateSettings.isPending}
            >
              {updateSettings.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
            {project?.worktrees_dir && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetWorktreesDir}
                disabled={updateSettings.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                Reset to default
              </Button>
            )}
          </div>
        </InlineField>

        <InlineField
          label="Stable worktree slots"
          description="Reuse fixed worktree paths for this project to keep build and editor artifacts warm."
        >
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">
                Use stable slots for new worktrees
              </div>
              <div className="text-xs text-muted-foreground">
                Jean keeps up to four idle slots warm for reuse.
              </div>
            </div>
            <Switch
              checked={project?.stable_worktree_slots_enabled === true}
              onCheckedChange={handleStableSlotsEnabledChange}
              disabled={updateSettings.isPending}
              aria-label="Use stable slots for new worktrees"
            />
          </div>
          {worktreeSlots.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">Slots</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetIdleWorktreeSlots.mutate(projectId)}
                  disabled={
                    resettableSlots.length === 0 ||
                    resetIdleWorktreeSlots.isPending
                  }
                >
                  {resetIdleWorktreeSlots.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Reset warm slots
                </Button>
              </div>
              <div className="space-y-2">
                {worktreeSlots.map(slot => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-foreground">
                          {slot.state}
                        </span>
                        {slot.branch && (
                          <span className="truncate text-muted-foreground">
                            {slot.branch}
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {slot.path}
                      </div>
                      {slot.last_error && (
                        <div className="text-xs text-destructive">
                          {slot.last_error}
                        </div>
                      )}
                    </div>
                    {(slot.state === 'idle' || slot.state === 'error') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          resetWorktreeSlot.mutate({
                            projectId,
                            slotId: slot.id,
                          })
                        }
                        disabled={resetWorktreeSlot.isPending}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reset
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </InlineField>
      </SettingsSection>

      <SettingsSection title="GitHub">
        <InlineField
          label="Issues and Pull Requests"
          description="Exclude this project's GitHub issues and pull requests from dashboard, badges, pickers, and session creation flows. Security alerts and advisories still appear."
        >
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">
                Hide GitHub issues and PRs in Jean
              </div>
              <div className="text-xs text-muted-foreground">
                Keep other GitHub surfaces for this project available.
              </div>
            </div>
            <Switch
              checked={displayedHideGitHubIssuesAndPRs}
              onCheckedChange={handleHideGitHubIssuesAndPRsChange}
              disabled={updateSettings.isPending}
              aria-label="Hide GitHub issues and PRs in Jean"
            />
          </div>
        </InlineField>
      </SettingsSection>

      <SettingsSection title="System Prompt">
        <InlineField
          label="Custom System Prompt"
          description="Appended to every session's system prompt in this project"
        >
          <Textarea
            placeholder="e.g. Always use TypeScript strict mode. Prefer functional components..."
            value={displayedSystemPrompt}
            onChange={e => setLocalSystemPrompt(e.target.value)}
            rows={4}
            className="resize-y text-sm"
          />
          <Button
            size="sm"
            onClick={handleSaveSystemPrompt}
            disabled={!systemPromptChanged || updateSettings.isPending}
          >
            {updateSettings.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Save
          </Button>
        </InlineField>
      </SettingsSection>
    </div>
  )
}
