import { describe, expect, it } from 'vitest'
import { buildPlanApprovalMessage } from './plan-approval-message'

describe('buildPlanApprovalMessage', () => {
  it('returns the default build approval text for non-codex sessions', () => {
    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'claude',
      })
    ).toBe(
      'Plan approved. Begin implementing the changes now. Do not re-explain the plan — start writing code.'
    )
  })

  it('embeds custom instructions before the approved plan', () => {
    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'claude',
        customPrompt: 'Only touch the approval flow.',
        approvedPlanContent: '- [ ] add prompt dialog',
      })
    ).toContain('<additional-instructions>')

    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'claude',
        customPrompt: 'Only touch the approval flow.',
        approvedPlanContent: '- [ ] add prompt dialog',
      })
    ).toContain('<plan>\n- [ ] add prompt dialog\n</plan>')
  })

  it('throws when a custom prompt is provided without approved plan content', () => {
    expect(() =>
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'claude',
        customPrompt: 'Do the work.',
      })
    ).toThrow('Approved plan content is required')
  })
})
