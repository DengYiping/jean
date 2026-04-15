import { describe, expect, it } from 'vitest'
import {
  appendSkillPromptContext,
  buildSkillReferenceLines,
  extractSkillTokenNames,
  injectSkillTokens,
  resolveMentionedSkills,
  stripLeadingInjectedSkillTokens,
} from './skill-prompt'

describe('skill-prompt', () => {
  it('injects missing skill tokens before the message body', () => {
    expect(
      injectSkillTokens('Add tests', [
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
      ])
    ).toBe('$skill-creator Add tests')
  })

  it('deduplicates skill paths and preserves existing tokens', () => {
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
      appendSkillPromptContext('Add tests', [
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

  it('extracts unique inline skill tokens in order of appearance', () => {
    expect(
      extractSkillTokenNames('$skill-creator Add tests with $review-helper')
    ).toEqual(['skill-creator', 'review-helper'])
  })

  it('resolves only exact inventory matches from inline skill tokens', () => {
    expect(
      resolveMentionedSkills('$skill-creator $unknown Add tests', [
        { name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' },
        { name: 'review-helper', path: '/tmp/review-helper/SKILL.md' },
      ])
    ).toEqual([{ name: 'skill-creator', path: '/tmp/skill-creator/SKILL.md' }])
  })
})
