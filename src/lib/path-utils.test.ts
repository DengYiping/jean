import { describe, expect, it } from 'vitest'
import { getSkillName } from './path-utils'

describe('getSkillName', () => {
  it('returns the direct skill directory name', () => {
    expect(
      getSkillName('/Users/test/.claude/skills/frontend-design/SKILL.md')
    ).toBe('frontend-design')
  })

  it('returns the nested codex system skill directory name', () => {
    expect(
      getSkillName('/Users/test/.codex/skills/.system/skill-creator/SKILL.md')
    ).toBe('skill-creator')
  })

  it('handles windows paths', () => {
    expect(
      getSkillName(
        'C:\\Users\\test\\.codex\\skills\\.system\\skill-installer\\SKILL.md'
      )
    ).toBe('skill-installer')
  })
})
