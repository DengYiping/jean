import { getSkillName } from '@/lib/path-utils'

interface SkillPromptInput {
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

const SKILL_TOKEN_REGEX = /(^|[\s\n])\$([\w.-]+)/g

export function extractSkillTokenNames(message: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()

  for (const match of message.matchAll(SKILL_TOKEN_REGEX)) {
    const name = match[2]?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  return names
}

export function resolveMentionedSkills(
  message: string,
  skills: SkillPromptInput[]
) {
  const normalizedSkills = normalizeSkills(skills)
  const skillsByName = new Map(
    normalizedSkills.map(skill => [skill.name, skill] as const)
  )

  return extractSkillTokenNames(message)
    .map(name => skillsByName.get(name))
    .filter((skill): skill is (typeof normalizedSkills)[number] =>
      Boolean(skill)
    )
}

export function injectSkillTokens(
  message: string,
  skills: SkillPromptInput[]
): string {
  const normalizedSkills = normalizeSkills(skills)
  const missingTokens = normalizedSkills
    .map(skill => `$${skill.name}`)
    .filter(token => !message.includes(token))

  if (missingTokens.length === 0) {
    return message
  }

  if (!message) {
    return missingTokens.join(' ')
  }

  return `${missingTokens.join(' ')} ${message}`
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
  const messageWithTokens = injectSkillTokens(message, skills)
  const skillRefs = buildSkillReferenceLines(skills)

  if (!skillRefs) {
    return messageWithTokens
  }

  return messageWithTokens ? `${messageWithTokens}\n\n${skillRefs}` : skillRefs
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
