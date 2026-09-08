import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePathCopyRow } from './FilePathCopyRow'

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: mocks.copyToClipboard,
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

function clickCopyButton() {
  const button = screen.getByRole('button', { name: 'Copy file path' })
  fireEvent.click(button)
  return button
}

describe('FilePathCopyRow', () => {
  beforeEach(() => {
    mocks.copyToClipboard.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
  })

  it('shows success only after copying succeeds', async () => {
    let resolveCopy!: () => void
    mocks.copyToClipboard.mockReturnValueOnce(
      new Promise<void>(resolve => {
        resolveCopy = resolve
      })
    )
    render(<FilePathCopyRow filePath="/tmp/example.ts" />)

    const button = clickCopyButton()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(button.querySelector('svg')).not.toHaveClass('text-green-500')

    resolveCopy()
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Copied file path to clipboard'
      )
    )
    expect(button.querySelector('svg')).toHaveClass('text-green-500')
  })

  it('reports copy failures without a success checkmark', async () => {
    mocks.copyToClipboard.mockRejectedValueOnce(new Error('permission denied'))
    render(<FilePathCopyRow filePath="/tmp/example.ts" />)

    const button = clickCopyButton()
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Failed to copy: permission denied'
      )
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(button.querySelector('svg')).not.toHaveClass('text-green-500')
  })

  it('does not show a stale checkmark after the file path changes', async () => {
    let resolveCopy!: () => void
    mocks.copyToClipboard.mockReturnValueOnce(
      new Promise<void>(resolve => {
        resolveCopy = resolve
      })
    )
    const { rerender } = render(<FilePathCopyRow filePath="/tmp/a.ts" />)

    clickCopyButton()
    rerender(<FilePathCopyRow filePath="/tmp/b.ts" />)
    resolveCopy()

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Copied file path to clipboard'
      )
    )
    expect(
      screen
        .getByRole('button', { name: 'Copy file path' })
        .querySelector('svg')
    ).not.toHaveClass('text-green-500')
  })
})
