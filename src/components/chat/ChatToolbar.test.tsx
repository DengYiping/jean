import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { ChatToolbar } from './ChatToolbar'
import type { ChatToolbarProps } from './toolbar/types'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
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
    onCancel: vi.fn(),
    availableMcpServers: [],
    enabledMcpServers: [],
    onToggleMcpServer: vi.fn(),
    ...overrides,
  }
}

describe('ChatToolbar', () => {
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

  it('disables parallel execution prompting once the session setting is locked', () => {
    const onParallelExecutionPromptChange = vi.fn()
    render(
      <ChatToolbar
        {...createProps({
          parallelExecutionPromptToggleDisabled: true,
          onParallelExecutionPromptChange,
        })}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Parallel execution prompting',
    })

    expect(button).toBeDisabled()

    fireEvent.click(button)

    expect(onParallelExecutionPromptChange).not.toHaveBeenCalled()
  })
})
