import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PermissionApproval } from './PermissionApproval'
import type { PermissionDenial } from '@/types/chat'

function createBashDenial(command: string): PermissionDenial {
  return {
    tool_name: 'Bash',
    tool_use_id: `tool-${command}`,
    tool_input: { command },
  }
}

describe('PermissionApproval', () => {
  it('calls persistent approval with selected Bash patterns', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn()
    const onApproveAndPersist = vi.fn()

    render(
      <PermissionApproval
        sessionId="session-1"
        denials={[createBashDenial('bun run check:all')]}
        onApprove={onApprove}
        onApproveAndPersist={onApproveAndPersist}
      />
    )

    await user.click(
      screen.getByRole('button', { name: /Always Allow & Continue/i })
    )

    expect(onApproveAndPersist).toHaveBeenCalledWith('session-1', [
      'Bash(bun run check:all)',
    ])
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('disables persistent approval when no selected Bash command can be saved', () => {
    render(
      <PermissionApproval
        sessionId="session-1"
        denials={[
          {
            tool_name: 'Write',
            tool_use_id: 'tool-write',
            tool_input: { file_path: '/tmp/example.txt' },
          },
        ]}
        onApprove={vi.fn()}
        onApproveAndPersist={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /Always Allow & Continue/i })
    ).toBeDisabled()
  })
})
