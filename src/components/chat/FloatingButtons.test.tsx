import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { FloatingButtons } from './FloatingButtons'

describe('FloatingButtons', () => {
  it('shows the floating approve CTA even when already at the bottom', () => {
    render(
      <FloatingButtons
        showApproveButton
        showFindingsButton={false}
        isAtBottom
        approveShortcut="Cmd+Enter"
        onApprove={vi.fn()}
        onYoloApprove={vi.fn()}
        onScrollToFindings={vi.fn()}
        onScrollToBottom={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'YOLO' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Bottom' })
    ).not.toBeInTheDocument()
  })

  it('shows and triggers the custom prompt action from the floating approve menu', () => {
    const onCustomBuildPrompt = vi.fn()

    render(
      <FloatingButtons
        showApproveButton
        showFindingsButton={false}
        isAtBottom={false}
        approveShortcut="Cmd+Enter"
        onApprove={vi.fn()}
        onCustomBuildPrompt={onCustomBuildPrompt}
        onYoloApprove={vi.fn()}
        onScrollToFindings={vi.fn()}
        onScrollToBottom={vi.fn()}
      />
    )

    const dropdownTrigger = screen.getAllByRole('button')[1]
    if (!dropdownTrigger) {
      throw new Error('Expected floating approve dropdown trigger')
    }
    fireEvent.pointerDown(dropdownTrigger)
    fireEvent.click(screen.getByText('Custom Prompt...'))

    expect(onCustomBuildPrompt).toHaveBeenCalledTimes(1)
  })
})
