// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import type { Automation } from '@/types/automations'
import type { Worktree } from '@/types/projects'
import { AutomationsPane, buildAutomationInput } from './AutomationsPane'

const mockUseAutomations = vi.fn()
const mockUseCreateAutomation = vi.fn()
const mockUseDeleteAutomation = vi.fn()
const mockUsePauseAutomation = vi.fn()
const mockUseResumeAutomation = vi.fn()
const mockUseRunAutomationNow = vi.fn()
const mockUseUpdateAutomation = vi.fn()
const mockUseWorktrees = vi.fn()

vi.mock('@/services/automations', () => ({
  useAutomations: (...args: unknown[]) => mockUseAutomations(...args),
  useCreateAutomation: (...args: unknown[]) => mockUseCreateAutomation(...args),
  useDeleteAutomation: (...args: unknown[]) => mockUseDeleteAutomation(...args),
  usePauseAutomation: (...args: unknown[]) => mockUsePauseAutomation(...args),
  useResumeAutomation: (...args: unknown[]) => mockUseResumeAutomation(...args),
  useRunAutomationNow: (...args: unknown[]) => mockUseRunAutomationNow(...args),
  useUpdateAutomation: (...args: unknown[]) => mockUseUpdateAutomation(...args),
}))

vi.mock('@/services/projects', () => ({
  useWorktrees: (...args: unknown[]) => mockUseWorktrees(...args),
}))

const mutationStub = {
  isPending: false,
  mutateAsync: vi.fn(),
}

const worktrees: Worktree[] = [
  {
    id: 'wt-base',
    project_id: 'project-1',
    name: 'Base',
    path: '/tmp/base',
    branch: 'main',
    created_at: 0,
    session_type: 'base',
    order: 0,
    automation_owned: false,
  },
]

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-1',
    project_id: 'project-1',
    name: 'Pull in latest change from upstream and cherry-pick all missing work',
    prompt: 'Check upstream and merge the missing changes.',
    target_mode: 'existing_worktrees',
    target_worktree_ids: ['wt-base'],
    backend: 'codex',
    model: null,
    provider: null,
    execution_mode: 'plan',
    thinking_level: null,
    effort_level: null,
    schedule_rrule: 'FREQ=DAILY;INTERVAL=1;BYHOUR=11;BYMINUTE=0',
    run_window_start_hour: null,
    run_window_end_hour: null,
    status: 'enabled',
    last_run_at: null,
    next_run_at: 1_776_488_400,
    last_run_status: 'running',
    last_error: null,
    session_ids_by_worktree_id: {},
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

describe('buildAutomationInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

describe('AutomationsPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stacks the status badge below long titles on narrow layouts', () => {
    mockUseAutomations.mockReturnValue({
      data: [createAutomation()],
    })
    mockUseWorktrees.mockReturnValue({ data: worktrees })
    mockUseCreateAutomation.mockReturnValue(mutationStub)
    mockUseDeleteAutomation.mockReturnValue(mutationStub)
    mockUsePauseAutomation.mockReturnValue(mutationStub)
    mockUseResumeAutomation.mockReturnValue(mutationStub)
    mockUseRunAutomationNow.mockReturnValue(mutationStub)
    mockUseUpdateAutomation.mockReturnValue(mutationStub)

    render(<AutomationsPane projectId="project-1" projectPath="/tmp/project" />)

    expect(
      screen.getByText(/Pull in latest change from upstream/i)
    ).toHaveClass('line-clamp-2')
    expect(screen.getByText('running')).toHaveClass('shrink-0', 'self-start')
    expect(screen.getByText('running').parentElement).toHaveClass(
      'flex-col',
      'sm:flex-row'
    )
  })
})
