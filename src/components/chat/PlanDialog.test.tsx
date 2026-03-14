import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { PlanDialog } from './PlanDialog'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
}))

vi.mock('@/services/chat', () => ({
  readPlanFile: vi.fn(),
}))

describe('PlanDialog', () => {
  it('shows the custom prompt UI when opened in build-custom mode', () => {
    render(
      <PlanDialog
        content="- [ ] Add custom prompt support"
        isOpen={true}
        editable={true}
        initialMode="build-custom"
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onApproveYolo={vi.fn()}
        onApproveWithCustomPrompt={vi.fn()}
      />
    )

    expect(screen.getByText('Custom build prompt')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Build \(/ })
    ).toBeDisabled()
  })

  it('submits the trimmed custom prompt with the edited plan content', () => {
    const onApproveWithCustomPrompt = vi.fn()

    render(
      <PlanDialog
        content="- [ ] Add custom prompt support"
        isOpen={true}
        editable={true}
        initialMode="build-custom"
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onApproveYolo={vi.fn()}
        onApproveWithCustomPrompt={onApproveWithCustomPrompt}
      />
    )

    fireEvent.change(
      screen.getByPlaceholderText(
        'Add extra implementation instructions for build mode.'
      ),
      {
        target: { value: '  Keep the default approve path unchanged.  ' },
      }
    )
    fireEvent.click(screen.getByRole('button', { name: /Build \(/ }))

    expect(onApproveWithCustomPrompt).toHaveBeenCalledWith(
      '- [ ] Add custom prompt support',
      'Keep the default approve path unchanged.'
    )
  })

  it('submits the custom prompt with Cmd/Ctrl+Enter', () => {
    const onApproveWithCustomPrompt = vi.fn()

    render(
      <PlanDialog
        content="- [ ] Add custom prompt support"
        isOpen={true}
        editable={true}
        initialMode="build-custom"
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onApproveYolo={vi.fn()}
        onApproveWithCustomPrompt={onApproveWithCustomPrompt}
      />
    )

    fireEvent.change(
      screen.getByPlaceholderText(
        'Add extra implementation instructions for build mode.'
      ),
      {
        target: { value: 'Submit from keyboard.' },
      }
    )
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(onApproveWithCustomPrompt).toHaveBeenCalledWith(
      '- [ ] Add custom prompt support',
      'Submit from keyboard.'
    )
  })

  it('offers a Custom Prompt entry in the approve menu', () => {
    render(
      <PlanDialog
        content="- [ ] Add custom prompt support"
        isOpen={true}
        editable={true}
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onApproveYolo={vi.fn()}
        onApproveWithCustomPrompt={vi.fn()}
      />
    )

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Approve options' })
    )

    expect(screen.getByText('Custom Prompt...')).toBeVisible()
  })
})
