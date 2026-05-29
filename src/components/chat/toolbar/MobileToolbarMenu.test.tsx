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
    availableMcpServers: [],
    enabledMcpServers: [],
    activeMcpCount: 0,
    onToggleMcpServer: vi.fn(),
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
    onOpenMagicModal: vi.fn(),
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

  it('hides the model chevron when there is only one model choice', async () => {
    const user = userEvent.setup()
    render(<MobileToolbarMenu {...createProps()} />)

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    const modelItem = (await screen.findByText('Model')).closest(
      '[role="menuitem"]'
    )
    expect(modelItem).toBeInTheDocument()
    expect(modelItem?.querySelector('svg.lucide-chevron-right')).toBeNull()
  })

  it('opens Magic from the mobile toolbar menu', async () => {
    const user = userEvent.setup()
    const onOpenMagicModal = vi.fn()
    render(<MobileToolbarMenu {...createProps({ onOpenMagicModal })} />)

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByText('Magic'))

    expect(onOpenMagicModal).toHaveBeenCalledOnce()
  })

  it('shows MCP as a disabled row when no servers can be toggled', async () => {
    const user = userEvent.setup()
    render(<MobileToolbarMenu {...createProps()} />)

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    const mcpItem = (await screen.findByText('MCP')).closest(
      '[role="menuitem"]'
    )
    expect(mcpItem).toHaveAttribute('aria-disabled', 'true')
    expect(mcpItem?.querySelector('svg.lucide-chevron-right')).toBeNull()
    expect(screen.getByText('None')).toBeInTheDocument()
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

  it('opens a touch-friendly MCP sheet and toggles a server', async () => {
    const user = userEvent.setup()
    const onToggleMcpServer = vi.fn()
    render(
      <MobileToolbarMenu
        {...createProps({
          availableMcpServers: [
            {
              name: 'filesystem',
              config: {},
              scope: 'project',
              disabled: false,
              backend: 'codex',
            },
          ],
          enabledMcpServers: ['filesystem'],
          activeMcpCount: 1,
          onToggleMcpServer,
        })}
      />
    )

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    const mcpItem = (await screen.findByText('MCP')).closest(
      '[role="menuitem"]'
    )
    expect(mcpItem).toBeInTheDocument()
    if (!mcpItem) throw new Error('MCP menu item not found')
    await user.click(mcpItem)

    expect(
      await screen.findByRole('heading', { name: 'MCP Servers' })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /filesystem/i }))

    expect(onToggleMcpServer).toHaveBeenCalledWith('filesystem')
  })
})
