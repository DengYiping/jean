import { describe, expect, it } from 'vitest'
import { buildAutomationInput } from './AutomationsPane'

describe('buildAutomationInput', () => {
  it('clears target worktrees for fresh-worktree automations', () => {
    const input = buildAutomationInput({
      name: ' Daily triage ',
      prompt: ' Inspect the repo ',
      targetMode: 'fresh_worktree',
      targetWorktreeIds: ['wt-base', 'wt-feature'],
      backend: 'codex',
      model: '',
      provider: '',
      executionMode: 'plan',
      thinkingLevel: '',
      effortLevel: '',
      frequency: 'daily',
      interval: 1,
      time: '09:00',
      weekdays: ['MO'],
      runWindowEnabled: false,
      runWindowStartHour: 9,
      runWindowEndHour: 17,
      status: 'enabled',
    })

    expect(input).toMatchObject({
      name: 'Daily triage',
      prompt: 'Inspect the repo',
      target_mode: 'fresh_worktree',
      target_worktree_ids: [],
    })
  })

  it('preserves selected worktrees for existing-worktree automations', () => {
    const input = buildAutomationInput({
      name: 'Daily triage',
      prompt: 'Inspect the repo',
      targetMode: 'existing_worktrees',
      targetWorktreeIds: ['wt-base', 'wt-feature'],
      backend: 'codex',
      model: '',
      provider: '',
      executionMode: 'plan',
      thinkingLevel: '',
      effortLevel: '',
      frequency: 'daily',
      interval: 1,
      time: '09:00',
      weekdays: ['MO'],
      runWindowEnabled: false,
      runWindowStartHour: 9,
      runWindowEndHour: 17,
      status: 'enabled',
    })

    expect(input).toMatchObject({
      target_mode: 'existing_worktrees',
      target_worktree_ids: ['wt-base', 'wt-feature'],
    })
  })
})
