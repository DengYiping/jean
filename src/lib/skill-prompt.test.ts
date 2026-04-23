import { describe, expect, it } from 'vitest'
import {
  appendSkillPromptContext,
  buildSkillReferenceLines,
  getActiveSkillsFromText,
  injectSkillTokens,
  removeInlineSkillMentions,
  stripLeadingInjectedSkillTokens,
} from './skill-prompt'

describe('skill-prompt', () => {
  it('does not inject missing skill tokens into the message body', () => {
    expect(
      injectSkillTokens('Add tests', [
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
      ])
    ).toBe('Add tests')
  })

  it('preserves existing tokens without adding new ones', () => {
    expect(
      injectSkillTokens('$skill-creator Add tests', [
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
      ])
    ).toBe('$skill-creator Add tests')
  })

  it('builds hidden skill reference lines for attachment reconstruction', () => {
    expect(
      buildSkillReferenceLines([
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
      ])
    ).toBe(
      '[Skill: /tmp/skill-creator/SKILL.md - Read and use this skill to guide your response]'
    )
  })

  it('appends both visible skill tokens and hidden skill references', () => {
    expect(
      appendSkillPromptContext('$skill-creator Add tests', [
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
      ])
    ).toBe(
      '$skill-creator Add tests\n\n[Skill: /tmp/skill-creator/SKILL.md - Read and use this skill to guide your response]'
    )
  })

  it('strips only the leading injected skill tokens during restore', () => {
    expect(
      stripLeadingInjectedSkillTokens('$skill-creator Add tests', [
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
      ])
    ).toBe('Add tests')
  })

  it('derives only bound skills still present in the inline draft text', () => {
    expect(
      getActiveSkillsFromText(
        'Please use $skill-creator and then check Slack.',
        [
          { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
          { name: 'agent-slack', path: '/tmp/agent-slack/SKILL.md' },
        ]
      )
    ).toEqual([{ name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' }])
  })

  it('removes inline skill mentions while keeping surrounding text readable', () => {
    expect(
      removeInlineSkillMentions(
        'Please use $skill-creator to update this.',
        'skill-creator'
      )
    ).toBe('Please use to update this.')
  })
})
