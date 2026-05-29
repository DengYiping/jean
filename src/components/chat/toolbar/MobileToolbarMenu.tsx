import { useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bot,
  BookmarkPlus,
  Brain,
  Check,
  ChevronRight,
  ClipboardList,
  Eye,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Hammer,
  MessageSquare,
  Pencil,
  Plug,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { CustomCliProfile } from '@/types/preferences'
import type { EffortLevel, ExecutionMode, ThinkingLevel } from '@/types/chat'
import type { CheckStatus, PrDisplayStatus } from '@/types/pr-status'
import type { McpServerInfo } from '@/types/chat'
import type {
  AttachedSavedContext,
  LoadedIssueContext,
  LoadedPullRequestContext,
  LoadedSecurityAlertContext,
  LoadedAdvisoryContext,
} from '@/types/github'
import type { LoadedLinearIssueContext } from '@/types/linear'
import { CheckStatusButton } from '@/components/chat/toolbar/CheckStatusButton'
import {
  EFFORT_LEVEL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'
import {
  getPrStatusDisplay,
  getProviderDisplayName,
} from '@/components/chat/toolbar/toolbar-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { useUIStore } from '@/store/ui-store'
import { cn } from '@/lib/utils'

interface MobileToolbarMenuProps {
  isDisabled: boolean
  hasOpenPr: boolean
  sessionHasMessages?: boolean
  providerLocked?: boolean
  selectedBackend: 'claude' | 'codex' | 'opencode'
  selectedProvider: string | null
  selectedModel: string
  selectedEffortLevel: EffortLevel
  selectedThinkingLevel: ThinkingLevel
  hideThinkingLevel?: boolean
  useAdaptiveThinking: boolean
  isCodex: boolean
  executionMode: ExecutionMode
  customCliProfiles: CustomCliProfile[]
  filteredModelOptions: { value: string; label: string }[]

  uncommittedAdded: number
  uncommittedRemoved: number
  branchDiffAdded: number
  branchDiffRemoved: number
  prUrl: string | undefined
  prNumber: number | undefined
  displayStatus: PrDisplayStatus | undefined
  checkStatus: CheckStatus | undefined
  activeWorktreePath: string | undefined
  loadedIssueContexts?: LoadedIssueContext[]
  loadedPRContexts?: LoadedPullRequestContext[]
  loadedSecurityContexts?: LoadedSecurityAlertContext[]
  loadedAdvisoryContexts?: LoadedAdvisoryContext[]
  loadedLinearContexts?: LoadedLinearIssueContext[]
  attachedSavedContexts?: AttachedSavedContext[]
  handleViewIssue?: (ctx: LoadedIssueContext) => void
  handleViewPR?: (ctx: LoadedPullRequestContext) => void
  handleViewSecurityAlert?: (ctx: LoadedSecurityAlertContext) => void
  handleViewAdvisory?: (ctx: LoadedAdvisoryContext) => void
  handleViewLinear?: (ctx: LoadedLinearIssueContext) => void
  handleViewSavedContext?: (ctx: AttachedSavedContext) => void
  availableMcpServers?: McpServerInfo[]
  enabledMcpServers?: string[]
  activeMcpCount?: number
  onToggleMcpServer?: (serverName: string) => void

  onSaveContext: () => void
  onLoadContext: () => void
  onCommit: () => void
  onCommitAndPush: () => void
  onOpenPr: () => void
  onOpenPullRequestReview: () => void
  onReview: () => void
  onMerge: () => void
  onMergePr: () => void
  onResolveConflicts: () => void
  onOpenMagicModal: () => void
  installedBackends: ('claude' | 'codex' | 'opencode')[]
  onBackendChange: (backend: 'claude' | 'codex' | 'opencode') => void
  onSetExecutionMode: (mode: ExecutionMode) => void

  handlePullClick: () => void
  handlePullUpstreamClick: () => void
  handlePushClick: () => void
  handleUncommittedDiffClick: () => void
  handleBranchDiffClick: () => void
  handleProviderChange: (value: string) => void
  handleModelChange: (value: string) => void
  handleEffortLevelChange: (value: string) => void
  handleThinkingLevelChange: (value: string) => void
}

export function MobileToolbarMenu({
  isDisabled,
  hasOpenPr,
  sessionHasMessages,
  providerLocked,
  selectedBackend,
  selectedProvider,
  selectedModel,
  selectedEffortLevel,
  selectedThinkingLevel,
  hideThinkingLevel,
  useAdaptiveThinking,
  isCodex,
  executionMode,
  customCliProfiles,
  filteredModelOptions,
  uncommittedAdded,
  uncommittedRemoved,
  branchDiffAdded,
  branchDiffRemoved,
  prUrl,
  prNumber,
  displayStatus,
  checkStatus,
  activeWorktreePath,
  availableMcpServers,
  enabledMcpServers,
  activeMcpCount,
  onToggleMcpServer,
  onSaveContext,
  onLoadContext,
  onCommit,
  onCommitAndPush,
  onOpenPr,
  onOpenPullRequestReview,
  onReview,
  onMerge,
  onMergePr,
  onResolveConflicts: _onResolveConflicts,
  onOpenMagicModal,
  installedBackends,
  onBackendChange,
  onSetExecutionMode,
  handlePullClick,
  handlePullUpstreamClick,
  handlePushClick,
  handleUncommittedDiffClick,
  handleBranchDiffClick,
  handleProviderChange,
  handleModelChange,
  handleEffortLevelChange,
  handleThinkingLevelChange,
}: MobileToolbarMenuProps) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const [modelSheetOpen, setModelSheetOpen] = useState(false)
  const [mcpSheetOpen, setMcpSheetOpen] = useState(false)
  const [modeSheetOpen, setModeSheetOpen] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const providerDisplayName = getProviderDisplayName(selectedProvider)
  const selectedModelLabel = filteredModelOptions.find(
    o => o.value === selectedModel
  )?.label

  const openModelSheet = () => {
    setMenuOpen(false)
    setModelSearchQuery('')
    requestAnimationFrame(() => setModelSheetOpen(true))
  }
  const openModeSheet = () => {
    setMenuOpen(false)
    requestAnimationFrame(() => setModeSheetOpen(true))
  }
  const openMcpSheet = () => {
    setMenuOpen(false)
    requestAnimationFrame(() => setMcpSheetOpen(true))
  }
  const normalizedModelQuery = modelSearchQuery.trim().toLowerCase()
  const visibleModelOptions = normalizedModelQuery
    ? filteredModelOptions.filter(option => {
        const label = option.label.toLowerCase()
        const value = option.value.toLowerCase()
        return (
          label.includes(normalizedModelQuery) ||
          value.includes(normalizedModelQuery)
        )
      })
    : filteredModelOptions
  const hasMultipleModelChoices = filteredModelOptions.length > 1
  const modeOptions = [
    {
      value: 'plan' as const,
      label: 'Plan',
      icon: ClipboardList,
    },
    {
      value: 'build' as const,
      label: 'Build',
      icon: Hammer,
    },
    {
      value: 'yolo' as const,
      label: 'Yolo',
      icon: Zap,
    },
  ]
  const selectedModeOption =
    modeOptions.find(option => option.value === executionMode) ??
    ({
      value: 'plan' as const,
      label: 'Plan',
      icon: ClipboardList,
    } satisfies (typeof modeOptions)[number])
  const SelectedModeIcon = selectedModeOption.icon
  const hasToggleableMcpServers =
    !!onToggleMcpServer &&
    (availableMcpServers ?? []).some(server => !server.disabled)
  const enabledMcpSet = new Set(enabledMcpServers ?? [])

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className="flex @xl:hidden h-8 items-center gap-1 rounded-l-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={isDisabled}
          >
            <Wand2 className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={isMobile ? 'end' : 'start'}
          className="w-56"
        >
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false)
              onOpenMagicModal()
            }}
          >
            <Wand2 className="h-4 w-4" />
            Magic
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              ⌘M
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Context
          </div>
          <DropdownMenuItem onClick={onSaveContext}>
            <BookmarkPlus className="h-4 w-4" />
            Save Context
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              S
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onLoadContext}>
            <FolderOpen className="h-4 w-4" />
            Load Context
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              L
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {isMobile ? (
            <DropdownMenuItem onSelect={openModeSheet}>
              <SelectedModeIcon className="h-4 w-4" />
              <span>Mode</span>
              <span className="ml-auto w-16 text-right text-xs text-muted-foreground">
                {selectedModeOption.label}
              </span>
              <ChevronRight className="ml-2 h-4 w-4 shrink-0" />
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:!ml-2">
                <SelectedModeIcon className="mr-2 h-4 w-4" />
                <span>Mode</span>
                <span className="ml-auto w-16 text-right text-xs text-muted-foreground">
                  {selectedModeOption.label}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={executionMode}
                  onValueChange={v => onSetExecutionMode(v as ExecutionMode)}
                >
                  <DropdownMenuRadioItem value="plan">
                    Plan
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="build">
                    Build
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioItem
                    value="yolo"
                    className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                  >
                    Yolo
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Commit
          </div>
          <DropdownMenuItem onClick={onCommit}>
            <GitCommitHorizontal className="h-4 w-4" />
            Commit
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              C
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCommitAndPush}>
            <GitCommitHorizontal className="h-4 w-4" />
            Commit & Push
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              P
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Sync
          </div>
          <DropdownMenuItem onClick={handlePullClick}>
            <ArrowDownToLine className="h-4 w-4" />
            Pull
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              D
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePullUpstreamClick}>
            <ArrowDownToLine className="h-4 w-4" />
            Upstream Pull
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              T
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePushClick}>
            <ArrowUpToLine className="h-4 w-4" />
            Push
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              U
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Pull Request
          </div>
          <DropdownMenuItem onClick={onOpenPr}>
            <GitPullRequest className="h-4 w-4" />
            {hasOpenPr ? 'Open' : 'Create'}
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              O
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onReview}>
            <Eye className="h-4 w-4" />
            Review
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              R
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasOpenPr}
            onClick={onOpenPullRequestReview}
          >
            <MessageSquare className="h-4 w-4" />
            PR Comments
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasOpenPr} onClick={onMergePr}>
            <GitMerge className="h-4 w-4" />
            Merge
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              N
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Branch
          </div>
          <DropdownMenuItem onClick={onMerge}>
            <GitMerge className="h-4 w-4" />
            Merge to Base
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              M
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              useUIStore.getState().setResolveConflictsDialogOpen(true)
            }
          >
            <GitMerge className="h-4 w-4" />
            Resolve Conflicts
            <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              F
            </span>
          </DropdownMenuItem>

          {(uncommittedAdded > 0 ||
            uncommittedRemoved > 0 ||
            branchDiffAdded > 0 ||
            branchDiffRemoved > 0 ||
            prUrl) && <DropdownMenuSeparator />}

          {(uncommittedAdded > 0 || uncommittedRemoved > 0) && (
            <DropdownMenuItem onClick={handleUncommittedDiffClick}>
              <Pencil className="h-4 w-4" />
              <span>Uncommitted</span>
              <span className="ml-auto text-xs">
                <span className="text-green-500">+{uncommittedAdded}</span>
                {' / '}
                <span className="text-red-500">-{uncommittedRemoved}</span>
              </span>
            </DropdownMenuItem>
          )}

          {(branchDiffAdded > 0 || branchDiffRemoved > 0) && (
            <DropdownMenuItem onClick={handleBranchDiffClick}>
              <GitBranch className="h-4 w-4" />
              <span>Branch diff</span>
              <span className="ml-auto text-xs">
                <span className="text-green-500">+{branchDiffAdded}</span>
                {' / '}
                <span className="text-red-500">-{branchDiffRemoved}</span>
              </span>
            </DropdownMenuItem>
          )}

          {prUrl && prNumber && (
            <DropdownMenuItem asChild>
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  displayStatus
                    ? getPrStatusDisplay(displayStatus).className
                    : ''
                )}
              >
                {displayStatus === 'merged' ? (
                  <GitMerge className="h-4 w-4" />
                ) : (
                  <GitPullRequest className="h-4 w-4" />
                )}
                <span>#{prNumber}</span>
                <CheckStatusButton
                  status={checkStatus ?? null}
                  projectPath={activeWorktreePath}
                />
              </a>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {!sessionHasMessages && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:!ml-2">
                <Sparkles className="mr-2 h-4 w-4" />
                <span>Backend</span>
                <span className="ml-auto w-16 text-right text-xs text-muted-foreground capitalize">
                  {selectedBackend}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={selectedBackend}
                  onValueChange={v =>
                    onBackendChange(v as 'claude' | 'codex' | 'opencode')
                  }
                >
                  {installedBackends.includes('claude') && (
                    <DropdownMenuRadioItem value="claude">
                      Claude
                    </DropdownMenuRadioItem>
                  )}
                  {installedBackends.includes('codex') && (
                    <DropdownMenuRadioItem value="codex">
                      Codex
                    </DropdownMenuRadioItem>
                  )}
                  {installedBackends.includes('opencode') && (
                    <DropdownMenuRadioItem value="opencode">
                      OpenCode{' '}
                      <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase text-primary">
                        BETA
                      </span>
                    </DropdownMenuRadioItem>
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {customCliProfiles.length > 0 &&
            !providerLocked &&
            selectedBackend === 'claude' && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Sparkles className="mr-2 h-4 w-4" />
                  <span>Provider</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {providerDisplayName}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={selectedProvider ?? '__anthropic__'}
                    onValueChange={handleProviderChange}
                  >
                    <DropdownMenuRadioItem value="__anthropic__">
                      Anthropic
                    </DropdownMenuRadioItem>
                    {customCliProfiles.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          Custom Providers
                        </DropdownMenuLabel>
                        {customCliProfiles.map(profile => (
                          <DropdownMenuRadioItem
                            key={profile.name}
                            value={profile.name}
                          >
                            {profile.name}
                          </DropdownMenuRadioItem>
                        ))}
                      </>
                    )}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

          {isMobile ? (
            <DropdownMenuItem onSelect={openModelSheet}>
              <Bot className="h-4 w-4 text-foreground" />
              <span>Model</span>
              <span className="ml-auto w-16 text-right text-xs text-muted-foreground">
                {selectedModelLabel}
              </span>
              {hasMultipleModelChoices && (
                <ChevronRight className="ml-2 h-4 w-4 shrink-0" />
              )}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:!ml-2">
                <Bot className="mr-2 h-4 w-4 text-foreground" />
                <span>Model</span>
                <span className="ml-auto w-16 text-right text-xs text-muted-foreground">
                  {selectedModelLabel}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {providerLocked && customCliProfiles.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Provider: {providerDisplayName}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuRadioGroup
                  value={selectedModel}
                  onValueChange={handleModelChange}
                >
                  {filteredModelOptions.map(option => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {hasToggleableMcpServers ? (
            <DropdownMenuItem onSelect={openMcpSheet}>
              <Plug className="h-4 w-4" />
              <span>MCP</span>
              <span className="ml-auto w-16 text-right text-xs text-muted-foreground">
                {activeMcpCount && activeMcpCount > 0
                  ? `${activeMcpCount}`
                  : 'Off'}
              </span>
              <ChevronRight className="ml-2 h-4 w-4 shrink-0" />
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>
              <Plug className="h-4 w-4 text-muted-foreground" />
              <span>MCP</span>
              <span className="ml-auto text-xs text-muted-foreground">
                None
              </span>
            </DropdownMenuItem>
          )}

          {hideThinkingLevel ? null : useAdaptiveThinking || isCodex ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:!ml-2">
                <Brain className="mr-2 h-4 w-4" />
                <span>Effort</span>
                <span className="ml-auto w-16 text-right text-xs text-muted-foreground">
                  {
                    EFFORT_LEVEL_OPTIONS.find(
                      o => o.value === selectedEffortLevel
                    )?.label
                  }
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={selectedEffortLevel}
                  onValueChange={handleEffortLevelChange}
                >
                  {EFFORT_LEVEL_OPTIONS.map(option => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                      <span className="ml-auto pl-4 text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg:last-child]:!ml-2">
                <Brain className="mr-2 h-4 w-4" />
                <span>Thinking</span>
                <span className="ml-auto w-16 text-right text-xs text-muted-foreground">
                  {
                    THINKING_LEVEL_OPTIONS.find(
                      o => o.value === selectedThinkingLevel
                    )?.label
                  }
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={selectedThinkingLevel}
                  onValueChange={handleThinkingLevelChange}
                >
                  {THINKING_LEVEL_OPTIONS.map(option => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                      <span className="ml-auto pl-4 text-xs text-muted-foreground">
                        {option.tokens}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet open={modeSheetOpen} onOpenChange={setModeSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[75svh] rounded-t-xl p-0"
          showCloseButton={false}
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">Select Mode</SheetTitle>
            <SheetDescription className="sr-only">
              Choose the execution mode for the next message.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-1 p-2">
            {modeOptions.map(option => {
              const Icon = option.icon
              const selected = executionMode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-accent hover:text-accent-foreground',
                    selected && 'bg-accent text-accent-foreground',
                    option.value === 'yolo' &&
                      'text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400'
                  )}
                  onClick={() => {
                    onSetExecutionMode(option.value)
                    setModeSheetOpen(false)
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{option.label}</span>
                  {selected && <Check className="h-4 w-4" />}
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={modelSheetOpen} onOpenChange={setModelSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[75svh] rounded-t-xl p-0"
          showCloseButton={false}
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">Select Model</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto p-2">
            <div className="px-2 pb-2">
              <input
                value={modelSearchQuery}
                onChange={event => setModelSearchQuery(event.target.value)}
                placeholder="Search models..."
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none ring-0 focus:border-ring focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
            {providerLocked && customCliProfiles.length > 0 && (
              <div className="px-2 pb-1 text-xs text-muted-foreground">
                Provider: {providerDisplayName}
              </div>
            )}
            {visibleModelOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                  selectedModel === option.value &&
                    'bg-accent text-accent-foreground'
                )}
                onClick={() => {
                  handleModelChange(option.value)
                  setModelSheetOpen(false)
                }}
              >
                <span className="flex-1">{option.label}</span>
                {selectedModel === option.value && (
                  <Check className="h-4 w-4" />
                )}
              </button>
            ))}
            {visibleModelOptions.length === 0 && (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                No models match your search.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={mcpSheetOpen} onOpenChange={setMcpSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[75svh] rounded-t-xl p-0"
          showCloseButton={false}
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">MCP Servers</SheetTitle>
            <SheetDescription className="sr-only">
              Enable or disable MCP servers for this session.
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto p-2">
            {(availableMcpServers ?? []).map(server => {
              const selected =
                !server.disabled && enabledMcpSet.has(server.name)
              return (
                <button
                  key={server.name}
                  type="button"
                  disabled={server.disabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50',
                    selected && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => onToggleMcpServer?.(server.name)}
                >
                  <span className="flex-1">{server.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {server.disabled ? 'disabled' : server.scope}
                  </span>
                  {selected && <Check className="h-4 w-4" />}
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
