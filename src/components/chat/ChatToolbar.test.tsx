import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { ChatToolbar } from './ChatToolbar'
import type { ChatToolbarProps } from './toolbar/types'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
  usePatchPreferences: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/services/mcp', () => ({
  useAllBackendsMcpHealth: () => ({
    statuses: {},
    isFetching: false,
    refetchAll: vi.fn(),
  }),
}))

vi.mock('@/hooks/useRemotePicker', () => ({
  useRemotePicker: () => vi.fn(),
}))

vi.mock('@/services/opencode-cli', () => ({
  useAvailableOpencodeModels: () => ({ data: undefined }),
}))

vi.mock('@/components/chat/toolbar/DesktopToolbarControls', () => ({
  DesktopToolbarControls: () => <div data-testid="desktop-controls" />,
}))

vi.mock('@/components/chat/toolbar/MobileToolbarMenu', () => ({
  MobileToolbarMenu: () => <div data-testid="mobile-toolbar-menu" />,
}))

vi.mock('@/components/chat/toolbar/SendCancelButton', () => ({
  SendCancelButton: () => <div data-testid="send-cancel-button" />,
}))

vi.mock('@/components/chat/toolbar/ContextViewerDialog', () => ({
  ContextViewerDialog: () => null,
}))

vi.mock('@/components/chat/toolbar/useToolbarDropdownShortcuts', () => ({
  useToolbarDropdownShortcuts: () => undefined,
}))

vi.mock('@/components/chat/toolbar/useToolbarDerivedState', () => ({
  useToolbarDerivedState: () => ({
    isCodex: true,
    activeMcpCount: 0,
    filteredModelOptions: [],
    desktopModelOptions: [],
    selectedBaseModel: 'gpt-5.4',
    selectedModelIsFast: false,
    selectedModelLabel: 'gpt-5.4',
  }),
}))

vi.mock('@/components/chat/toolbar/useContextViewer', () => ({
  useContextViewer: () => ({
    viewingContext: null,
    setViewingContext: vi.fn(),
    handleViewIssue: vi.fn(),
    handleViewPR: vi.fn(),
    handleViewSavedContext: vi.fn(),
    handleViewSecurityAlert: vi.fn(),
    handleViewAdvisory: vi.fn(),
    handleViewLinear: vi.fn(),
  }),
}))

function createProps(
  overrides: Partial<ChatToolbarProps> = {}
): ChatToolbarProps {
  return {
    isSending: false,
    hasPendingQuestions: false,
    hasPendingAttachments: false,
    hasInputValue: false,
    executionMode: 'build',
    selectedBackend: 'codex',
    selectedModel: 'gpt-5.4',
    selectedProvider: null,
    selectedThinkingLevel: 'off',
    selectedEffortLevel: 'high',
    useAdaptiveThinking: false,
    baseBranch: 'main',
    uncommittedAdded: 0,
    uncommittedRemoved: 0,
    branchDiffAdded: 0,
    branchDiffRemoved: 0,
    prUrl: undefined,
    prNumber: undefined,
    displayStatus: undefined,
    checkStatus: undefined,
    mergeableStatus: undefined,
    activeWorktreePath: '/tmp/worktree',
    worktreeId: 'worktree-1',
    activeSessionId: 'session-1',
    projectId: 'project-1',
    loadedIssueContexts: [],
    loadedPRContexts: [],
    loadedLinearContexts: [],
    attachedSavedContexts: [],
    onOpenMagicModal: vi.fn(),
    onSaveContext: vi.fn(),
    onLoadContext: vi.fn(),
    onCommit: vi.fn(),
    onCommitAndPush: vi.fn(),
    onOpenPr: vi.fn(),
    onOpenPullRequestReview: vi.fn(),
    onReview: vi.fn(),
    onMerge: vi.fn(),
    onMergePr: vi.fn(),
    onAttach: vi.fn(),
    onResolvePrConflicts: vi.fn(),
    onResolveConflicts: vi.fn(),
    hasOpenPr: false,
    onSetDiffRequest: vi.fn(),
    installedBackends: ['codex'],
    onBackendChange: vi.fn(),
    onModelChange: vi.fn(),
    onProviderChange: vi.fn(),
    customCliProfiles: [],
    onThinkingLevelChange: vi.fn(),
    onEffortLevelChange: vi.fn(),
    onSetExecutionMode: vi.fn(),
    parallelExecutionPromptEnabled: false,
    onParallelExecutionPromptChange: vi.fn(),
    supervisorAction: null,
    onSupervisorActionChange: vi.fn(),
    onCancel: vi.fn(),
    availableMcpServers: [],
    enabledMcpServers: [],
    onToggleMcpServer: vi.fn(),
    ...overrides,
  }
}

describe('ChatToolbar', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      selectedWorktreeId: 'worktree-1',
    })
    useChatStore.setState({
      activeWorktreeId: 'worktree-1',
      activeWorktreePath: '/tmp/worktree',
      activeSessionIds: { 'worktree-1': 'session-1' },
      selectedBackends: { 'session-1': 'codex' },
      threadTokenUsage: {
        'session-1': {
          total: {
            totalTokens: 812_700,
            inputTokens: 406_000,
            cachedInputTokens: 405_500,
            outputTokens: 1_200,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 68_500,
            inputTokens: 400,
            cachedInputTokens: 66_900,
            outputTokens: 1_200,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 997_500,
        },
      },
    })
    useUIStore.setState({
      sessionChatModalOpen: false,
      sessionChatModalWorktreeId: null,
      chatToolbarMounted: false,
    })
  })

  it('allows toggling parallel execution prompting before a thread starts', () => {
    const onParallelExecutionPromptChange = vi.fn()
    render(
      <ChatToolbar {...createProps({ onParallelExecutionPromptChange })} />
    )

    const button = screen.getByRole('button', {
      name: 'Parallel execution prompting',
    })

    expect(button).toBeEnabled()

    fireEvent.click(button)

    expect(onParallelExecutionPromptChange).toHaveBeenCalledWith(true)
  })

  it('keeps parallel execution prompting toggleable for existing Codex threads', () => {
    const onParallelExecutionPromptChange = vi.fn()
    render(
      <ChatToolbar
        {...createProps({
          onParallelExecutionPromptChange,
        })}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Parallel execution prompting',
    })

    expect(button).toBeEnabled()

    fireEvent.click(button)

    expect(onParallelExecutionPromptChange).toHaveBeenCalledWith(true)
  })

  it('shows Codex context usage from the toolbar while the floating dock is hidden', () => {
    render(<ChatToolbar {...createProps()} />)

    const trigger = screen.getByRole('button', {
      name: /Codex context usage/i,
    })

    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute(
      'aria-label',
      expect.stringContaining('94% remaining')
    )
    expect(
      screen
        .getByRole('button', {
          name: /Codex context usage/i,
        })
        .querySelector('svg')
    ).toBeInTheDocument()
    expect(screen.queryByText('94%')).not.toBeInTheDocument()
    expect(screen.queryByText('-- tok')).not.toBeInTheDocument()
  })

  it('opens the toolbar usage menu from the global usage shortcut event', async () => {
    render(<ChatToolbar {...createProps()} />)

    fireEvent(window, new CustomEvent('toggle-usage-menu'))

    expect(await screen.findByText('Context window')).toBeInTheDocument()
    expect(screen.getByText('94% remaining')).toBeInTheDocument()
  })
})
