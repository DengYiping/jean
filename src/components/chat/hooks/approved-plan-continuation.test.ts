import { describe, expect, it } from 'vitest'
import type { AppPreferences } from '@/types/preferences'
import { resolveApprovedPlanContinuation } from './approved-plan-continuation'

const basePreferences = {
  selected_model: 'sonnet',
  selected_codex_model: 'gpt-5.4',
  selected_opencode_model: 'opencode/gpt-5.3-codex',
  thinking_level: 'think',
  default_codex_reasoning_effort: 'high',
  build_model: null,
  yolo_model: null,
  build_backend: null,
  yolo_backend: null,
  build_thinking_level: null,
  yolo_thinking_level: null,
  build_effort_level: null,
  yolo_effort_level: null,
} satisfies Pick<
  AppPreferences,
  | 'selected_model'
  | 'selected_codex_model'
  | 'selected_opencode_model'
  | 'thinking_level'
  | 'default_codex_reasoning_effort'
  | 'build_model'
  | 'yolo_model'
  | 'build_backend'
  | 'yolo_backend'
  | 'build_thinking_level'
  | 'yolo_thinking_level'
  | 'build_effort_level'
  | 'yolo_effort_level'
>

describe('resolveApprovedPlanContinuation', () => {
  it('uses the original session model when no mode override is configured', () => {
    const continuation = resolveApprovedPlanContinuation({
      mode: 'build',
      planContent: 'Ship it',
      originalBackend: 'claude',
      originalModel: 'claude-opus-4-8[1m]',
      preferences: basePreferences,
    })

    expect(continuation).toMatchObject({
      backend: 'claude',
      model: 'claude-opus-4-8[1m]',
      modeLabel: 'Build',
      modeOverride: '',
      thinkingLevel: 'think',
      effortLevel: undefined,
    })
    expect(continuation.message).toBe(
      'Execute this plan. Implement all changes described.\n\n<plan>\nShip it\n</plan>'
    )
  })

  it('resolves backend overrides, plan file context, and attachment references', () => {
    const continuation = resolveApprovedPlanContinuation({
      mode: 'yolo',
      planContent: 'Update screenshots',
      planFilePath: '/tmp/plan.md',
      originalBackend: 'claude',
      originalModel: 'claude-opus-4-8[1m]',
      preferences: {
        ...basePreferences,
        yolo_backend: 'opencode',
        yolo_thinking_level: 'ultrathink',
        yolo_effort_level: 'medium',
      },
      imagePaths: ['/tmp/screenshot.png'],
      skillPaths: ['/skills/frontend-design/SKILL.md'],
      textFilePaths: ['/tmp/notes.txt'],
    })

    expect(continuation).toMatchObject({
      backend: 'opencode',
      model: 'opencode/gpt-5.3-codex',
      modeLabel: 'Yolo',
      modeOverride: 'opencode / opencode/gpt-5.3-codex',
      thinkingLevel: 'ultrathink',
      effortLevel: 'medium',
    })
    expect(continuation.message).toContain(
      '[Yolo: opencode / opencode/gpt-5.3-codex]'
    )
    expect(continuation.message).toContain('Plan file: /tmp/plan.md')
    expect(continuation.message).toContain(
      '[Skill: /skills/frontend-design/SKILL.md - Read and use this skill to guide your response]'
    )
    expect(continuation.message).toContain(
      '[Image attached: /tmp/screenshot.png - Use the Read tool to view this image]'
    )
    expect(continuation.message).toContain(
      '[Text file attached: /tmp/notes.txt - Use the Read tool to view this file]'
    )
  })

  it('forces codex thinking off and falls back to default codex effort', () => {
    const continuation = resolveApprovedPlanContinuation({
      mode: 'build',
      planContent: 'Implement API',
      originalBackend: 'claude',
      originalModel: 'claude-opus-4-8[1m]',
      preferences: {
        ...basePreferences,
        build_backend: 'codex',
        build_thinking_level: 'ultrathink',
        default_codex_reasoning_effort: 'xhigh',
      },
    })

    expect(continuation).toMatchObject({
      backend: 'codex',
      model: 'gpt-5.4',
      thinkingLevel: 'off',
      effortLevel: 'max',
    })
  })

  it('can use the original backend for reasoning without returning it as a send override', () => {
    const continuation = resolveApprovedPlanContinuation({
      mode: 'yolo',
      planContent: 'Apply changes',
      originalBackend: 'codex',
      originalModel: 'gpt-5.4',
      preferences: {
        ...basePreferences,
        yolo_effort_level: null,
      },
      fallbackThinkingLevel: 'ultrathink',
      fallbackEffortLevel: 'medium',
      returnOriginalBackend: false,
      useNonAdaptiveEffortOverride: false,
    })

    expect(continuation).toMatchObject({
      backend: undefined,
      model: 'gpt-5.4',
      modeOverride: '',
      thinkingLevel: 'off',
      effortLevel: 'medium',
    })
  })
})
