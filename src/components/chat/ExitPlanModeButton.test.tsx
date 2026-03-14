import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { ExitPlanModeButton } from './ExitPlanModeButton'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
}))

describe('ExitPlanModeButton', () => {
  it('shows and triggers the custom prompt action from approve options', () => {
    const onCustomBuildPrompt = vi.fn()

    render(
      <ExitPlanModeButton
        toolCalls={[{ id: 'plan-1', name: 'ExitPlanMode', input: {} }]}
        isApproved={false}
        onPlanApproval={vi.fn()}
        onCustomBuildPrompt={onCustomBuildPrompt}
        onPlanApprovalYolo={vi.fn()}
      />
    )

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Approve options' })
    )
    fireEvent.click(screen.getByText('Custom Prompt...'))

    expect(onCustomBuildPrompt).toHaveBeenCalledTimes(1)
  })
})
