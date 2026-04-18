import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { toast } from 'sonner'
import type { Backend, ClaudeSkill, ClaudeCommand } from '@/types/chat'
import { isTauri } from '@/services/projects'

// Query keys for Claude CLI skills and commands
export const skillQueryKeys = {
  all: ['claude-cli'] as const,
  skills: (backend: Backend, worktreePath?: string | null) =>
    [...skillQueryKeys.all, 'skills', backend, worktreePath ?? null] as const,
  codexInventory: (worktreePath?: string | null) =>
    [...skillQueryKeys.all, 'codex-inventory', worktreePath ?? null] as const,
  commands: (worktreePath?: string | null) =>
    [...skillQueryKeys.all, 'commands', worktreePath ?? null] as const,
}

async function loadBackendSkills(
  backend: Backend,
  worktreePath?: string | null
): Promise<ClaudeSkill[]> {
  if (!isTauri()) {
    return []
  }

  try {
    const command =
      backend === 'codex' ? 'list_codex_skills' : 'list_claude_skills'
    logger.debug('Loading backend skills', { backend, command, worktreePath })
    const skills =
      backend === 'codex'
        ? await invoke<ClaudeSkill[]>(command, { worktreePath })
        : await invoke<ClaudeSkill[]>(command, {
            worktreePath: worktreePath ?? undefined,
          })
    logger.info('Backend skills loaded', { backend, count: skills.length })
    return skills
  } catch (error) {
    logger.error('Failed to load backend skills', { backend, error })
    return []
  }
}

/**
 * Hook to get Claude CLI skills from ~/.claude/skills/ and <project>/.claude/skills/
 * Skills can be attached anywhere in a prompt as context
 * Results are cached for 5 minutes (skills rarely change)
 */
export function useSkills(backend: Backend, worktreePath?: string | null) {
  return useQuery({
    queryKey: skillQueryKeys.skills(backend, worktreePath),
    queryFn: async (): Promise<ClaudeSkill[]> => {
      const skills = await loadBackendSkills(backend, worktreePath)
      return backend === 'codex'
        ? skills.filter(skill => skill.enabled !== false)
        : skills
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    gcTime: 1000 * 60 * 10, // Keep in memory for 10 minutes
  })
}

export function useClaudeSkills(worktreePath?: string | null) {
  return useSkills('claude', worktreePath)
}

export function useCodexSkillInventory(worktreePath?: string | null) {
  return useQuery({
    queryKey: skillQueryKeys.codexInventory(worktreePath),
    queryFn: async (): Promise<ClaudeSkill[]> =>
      loadBackendSkills('codex', worktreePath),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

export function useSetCodexSkillEnabled() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      path,
      name,
      enabled,
    }: {
      path?: string | null
      name?: string | null
      enabled: boolean
    }) => {
      if (!isTauri()) {
        throw new Error('Not in Tauri context')
      }

      return invoke<boolean>('set_codex_skill_enabled', {
        path: path ?? undefined,
        name: name ?? undefined,
        enabled,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...skillQueryKeys.all, 'skills', 'codex'],
      })
      queryClient.invalidateQueries({
        queryKey: [...skillQueryKeys.all, 'codex-inventory'],
      })
    },
    onError: error => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error occurred'
      logger.error('Failed to update Codex skill state', { error })
      toast.error('Failed to update Codex skill', { description: message })
    },
  })
}

/**
 * Hook to get Claude CLI custom commands from ~/.claude/commands/ and <project>/.claude/commands/
 * Commands can only be executed at the start of an empty prompt
 * Results are cached for 5 minutes (commands rarely change)
 */
export function useClaudeCommands(worktreePath?: string | null) {
  return useQuery({
    queryKey: skillQueryKeys.commands(worktreePath),
    queryFn: async (): Promise<ClaudeCommand[]> => {
      if (!isTauri()) {
        return []
      }

      try {
        logger.debug('Loading Claude CLI custom commands')
        const commands = await invoke<ClaudeCommand[]>('list_claude_commands', {
          worktreePath: worktreePath ?? undefined,
        })
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
