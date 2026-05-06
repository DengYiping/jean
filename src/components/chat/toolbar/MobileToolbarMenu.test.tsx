import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test/test-utils'
import { MobileToolbarMenu } from './MobileToolbarMenu'
import type { ComponentProps } from 'react'

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}))

function createProps(
  overrides: Partial<ComponentProps<typeof MobileToolbarMenu>> = {}
): ComponentProps<typeof MobileToolbarMenu> {
  return {
    isDisabled: false,
    hasOpenPr: false,
    sessionHasMessages: false,
    providerLocked: false,
    selectedBackend: 'codex',
    selectedProvider: null,
    selectedModel: 'gpt-5.4',
    selectedEffortLevel: 'high',
    selectedThinkingLevel: 'off',
    hideThinkingLevel: false,
    useAdaptiveThinking: false,
    isCodex: true,
    executionMode: 'build',
    customCliProfiles: [],
    filteredModelOptions: [{ value: 'gpt-5.4', label: 'GPT-5.4' }],
    uncommittedAdded: 0,
    uncommittedRemoved: 0,
    branchDiffAdded: 0,
    branchDiffRemoved: 0,
    prUrl: undefined,
    prNumber: undefined,
    displayStatus: undefined,
    checkStatus: undefined,
    activeWorktreePath: '/tmp/worktree',
    onSaveContext: vi.fn(),
    onLoadContext: vi.fn(),
    onCommit: vi.fn(),
    onCommitAndPush: vi.fn(),
    onOpenPr: vi.fn(),
    onOpenPullRequestReview: vi.fn(),
    onReview: vi.fn(),
    onMerge: vi.fn(),
    onMergePr: vi.fn(),
    onResolveConflicts: vi.fn(),
    installedBackends: ['codex'],
    onBackendChange: vi.fn(),
    onSetExecutionMode: vi.fn(),
    handlePullClick: vi.fn(),
    handlePullUpstreamClick: vi.fn(),
    handlePushClick: vi.fn(),
    handleUncommittedDiffClick: vi.fn(),
    handleBranchDiffClick: vi.fn(),
    handleProviderChange: vi.fn(),
    handleModelChange: vi.fn(),
    handleEffortLevelChange: vi.fn(),
    handleThinkingLevelChange: vi.fn(),
    ...overrides,
  }
}

describe('MobileToolbarMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a touch-friendly mode sheet and switches execution mode', async () => {
    const user = userEvent.setup()
    const onSetExecutionMode = vi.fn()
    render(<MobileToolbarMenu {...createProps({ onSetExecutionMode })} />)

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    const modeItem = (await screen.findByText('Mode')).closest(
      '[role="menuitem"]'
    )
    expect(modeItem).toBeInTheDocument()
    if (!modeItem) throw new Error('Mode menu item not found')
    await user.click(modeItem)

    expect(
      await screen.findByRole('heading', { name: 'Select Mode' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Build/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await user.click(screen.getByRole('button', { name: /Yolo/ }))

    expect(onSetExecutionMode).toHaveBeenCalledWith('yolo')
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Select Mode' })
      ).not.toBeInTheDocument()
    })
  })
})
