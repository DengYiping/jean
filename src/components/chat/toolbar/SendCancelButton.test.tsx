import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import type { ComponentProps } from 'react'
import { SendCancelButton } from './SendCancelButton'

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

function createProps(
  overrides: Partial<ComponentProps<typeof SendCancelButton>> = {}
): ComponentProps<typeof SendCancelButton> {
  return {
    isSending: false,
    canSend: false,
    executionMode: 'build',
    onCancel: vi.fn(),
    installedBackends: ['codex'],
    ...overrides,
  }
}

describe('SendCancelButton', () => {
  it('renders active cancel without an inline shortcut pill', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <SendCancelButton
        {...createProps({
          isSending: true,
          onCancel,
        })}
      />
    )

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })

    expect(within(cancelButton).queryByText(/backspace|⌫/i)).toBeNull()

    await user.click(cancelButton)

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps queue available while sending with a draft', () => {
    render(
      <SendCancelButton
        {...createProps({
          isSending: true,
          canSend: true,
        })}
      />
    )

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Queue/ })).toHaveAttribute(
      'type',
      'submit'
    )
  })
})
