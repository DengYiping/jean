import { describe, expect, it } from 'vitest'
import { buildPlanApprovalMessage } from './plan-approval-message'
import {
  DEFAULT_PLAN_APPROVAL_BUILD_PROMPT,
  DEFAULT_PLAN_APPROVAL_CODEX_PROMPT,
  DEFAULT_PLAN_APPROVAL_YOLO_PROMPT,
} from '@/types/preferences'

describe('buildPlanApprovalMessage', () => {
  it('returns the default build approval text for non-codex sessions', () => {
    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'claude',
      })
    ).toBe(DEFAULT_PLAN_APPROVAL_BUILD_PROMPT)
  })

  it('returns the default yolo approval text for non-codex sessions', () => {
    expect(
      buildPlanApprovalMessage({
        mode: 'yolo',
        backend: 'claude',
      })
    ).toBe(DEFAULT_PLAN_APPROVAL_YOLO_PROMPT)
  })

  it('returns the default codex approval text for codex sessions', () => {
    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'codex',
      })
    ).toBe(DEFAULT_PLAN_APPROVAL_CODEX_PROMPT)
  })

  it('uses configured global prompts when provided', () => {
    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'claude',
        configuredBuildPrompt: 'Custom build prompt',
      })
    ).toBe('Custom build prompt')

    expect(
      buildPlanApprovalMessage({
        mode: 'yolo',
        backend: 'claude',
        configuredYoloPrompt: 'Custom yolo prompt',
      })
    ).toBe('Custom yolo prompt')

    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'codex',
        configuredCodexPrompt: 'Custom codex prompt',
      })
    ).toBe('Custom codex prompt')
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

  it('prioritizes updated plan content over configured global prompts', () => {
    expect(
      buildPlanApprovalMessage({
        mode: 'build',
        backend: 'claude',
        updatedPlan: '- [ ] revised plan',
        originalPlan: '- [ ] original plan',
        configuredBuildPrompt: 'Custom build prompt',
      })
    ).toContain('<updated-plan>\n- [ ] revised plan\n</updated-plan>')
  })
})
