import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type { Backend, ClaudeSkill, ClaudeCommand } from '@/types/chat'
import { isTauri } from '@/services/projects'

// Query keys for Claude CLI skills and commands
export const skillQueryKeys = {
  all: ['claude-cli'] as const,
  skills: (backend: Backend, worktreePath?: string | null) =>
    [...skillQueryKeys.all, 'skills', backend, worktreePath ?? null] as const,
  commands: () => [...skillQueryKeys.all, 'commands'] as const,
}

/**
 * Hook to get Claude CLI skills from ~/.claude/skills/
 * Skills can be attached anywhere in a prompt as context
 * Results are cached for 5 minutes (skills rarely change)
 */
export function useSkills(backend: Backend, worktreePath?: string | null) {
  return useQuery({
    queryKey: skillQueryKeys.skills(backend, worktreePath),
    queryFn: async (): Promise<ClaudeSkill[]> => {
      if (!isTauri()) {
        return []
      }

      try {
        const command =
          backend === 'codex' ? 'list_codex_skills' : 'list_claude_skills'
        logger.debug('Loading backend skills', { backend, command })
        const skills =
          backend === 'codex'
            ? await invoke<ClaudeSkill[]>(command, { worktreePath })
            : await invoke<ClaudeSkill[]>(command)
        logger.info('Backend skills loaded', { backend, count: skills.length })
        return skills
      } catch (error) {
        logger.error('Failed to load backend skills', { backend, error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    gcTime: 1000 * 60 * 10, // Keep in memory for 10 minutes
  })
}

export function useClaudeSkills() {
  return useSkills('claude')
}

/**
 * Hook to get Claude CLI custom commands from ~/.claude/commands/
 * Commands can only be executed at the start of an empty prompt
 * Results are cached for 5 minutes (commands rarely change)
 */
export function useClaudeCommands() {
  return useQuery({
    queryKey: skillQueryKeys.commands(),
    queryFn: async (): Promise<ClaudeCommand[]> => {
      if (!isTauri()) {
        return []
      }

      try {
        logger.debug('Loading Claude CLI custom commands')
        const commands = await invoke<ClaudeCommand[]>('list_claude_commands')
        logger.info('Claude CLI custom commands loaded', {
          count: commands.length,
        })
        return commands
      } catch (error) {
        logger.error('Failed to load Claude CLI custom commands', { error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    gcTime: 1000 * 60 * 10, // Keep in memory for 10 minutes
  })
}
