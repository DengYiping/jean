import { getSkillName } from '@/lib/path-utils'

export interface SkillPromptInput {
  name?: string
  path: string
}

function normalizeSkills(skills: SkillPromptInput[]) {
  const seenPaths = new Set<string>()

  return skills
    .filter(skill => {
      if (!skill.path || seenPaths.has(skill.path)) {
        return false
      }
      seenPaths.add(skill.path)
      return true
    })
    .map(skill => ({
      name: skill.name?.trim() || getSkillName(skill.path),
      path: skill.path,
    }))
}

export function injectSkillTokens(
  message: string,
  _skills: SkillPromptInput[]
): string {
  return message
}

export function buildSkillReferenceLines(skills: SkillPromptInput[]): string {
  return normalizeSkills(skills)
    .map(
      skill =>
        `[Skill: ${skill.path} - Read and use this skill to guide your response]`
    )
    .join('\n')
}

export function appendSkillPromptContext(
  message: string,
  skills: SkillPromptInput[]
): string {
  const skillRefs = buildSkillReferenceLines(skills)

  if (!skillRefs) {
    return message
  }

  return message ? `${message}\n\n${skillRefs}` : skillRefs
}

export function stripLeadingInjectedSkillTokens(
  message: string,
  skills: SkillPromptInput[]
): string {
  let remaining = message.trimStart()
  const skillTokens = new Set(
    normalizeSkills(skills).map(skill => `$${skill.name}`)
  )

  while (remaining) {
    const nextSpace = remaining.indexOf(' ')
    const candidate =
      nextSpace === -1 ? remaining : remaining.slice(0, nextSpace)

    if (!skillTokens.has(candidate)) {
      break
    }

    remaining =
      nextSpace === -1 ? '' : remaining.slice(nextSpace + 1).trimStart()
  }

  return remaining
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildSkillMentionRegex(name: string): RegExp {
  return new RegExp(
    `(^|[\\s([{])\\$${escapeRegex(name)}(?=$|[\\s.,!?;:)}\\]])`,
    'm'
  )
}

export function hasInlineSkillMention(
  message: string,
  skill: SkillPromptInput
): boolean {
  const normalizedName = skill.name?.trim() || getSkillName(skill.path)
  if (!normalizedName) return false
  return buildSkillMentionRegex(normalizedName).test(message)
}

export function getActiveSkillsFromText(
  message: string,
  skills: SkillPromptInput[]
): { name: string; path: string }[] {
  return normalizeSkills(skills).filter(skill =>
    hasInlineSkillMention(message, skill)
  )
}

export function removeInlineSkillMentions(
  message: string,
  skillName: string
): string {
  const regex = new RegExp(
    `(^|[\\s([{])\\$${escapeRegex(skillName)}(?=$|[\\s.,!?;:)}\\]])`,
    'gm'
  )

  return message
    .replace(regex, (_match, prefix: string) => prefix)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}
