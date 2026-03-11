import { describe, expect, it } from 'vitest'
import { shouldPlayPermissionApprovalSound } from './useStreamingEvents'
import type { PermissionDenial } from '@/types/chat'

function createDenial(toolUseId: string): PermissionDenial {
  return {
    tool_name: 'Bash',
    tool_use_id: toolUseId,
    tool_input: { command: 'echo test' },
  }
}

describe('shouldPlayPermissionApprovalSound', () => {
  it('plays when the first pending approval arrives', () => {
    expect(
      shouldPlayPermissionApprovalSound(undefined, [createDenial('tool-1')])
    ).toBe(true)
  })

  it('does not play when there are no pending approvals', () => {
    expect(shouldPlayPermissionApprovalSound(undefined, [])).toBe(false)
  })

  it('does not replay while approvals are already pending', () => {
    expect(
      shouldPlayPermissionApprovalSound([createDenial('tool-1')], [
        createDenial('tool-1'),
        createDenial('tool-2'),
      ])
    ).toBe(false)
  })
})
