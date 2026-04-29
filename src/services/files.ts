import { useMutation, useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type { WorktreeFile } from '@/types/chat'
import { isTauri } from '@/services/projects'
import { toast } from 'sonner'

// Query keys for files
export const fileQueryKeys = {
  all: ['files'] as const,
  worktreeFiles: (worktreePath: string) =>
    [...fileQueryKeys.all, 'worktree', worktreePath] as const,
}

/**
 * Hook to get all files in a worktree (for @ mentions)
 * Results are cached and only refetched when worktree changes
 */
export function useWorktreeFiles(worktreePath: string | null) {
  return useQuery({
    queryKey: fileQueryKeys.worktreeFiles(worktreePath ?? ''),
    queryFn: async (): Promise<WorktreeFile[]> => {
      if (!isTauri() || !worktreePath) {
        return []
      }

      try {
        logger.debug('Loading worktree files', { worktreePath })
        const files = await invoke<WorktreeFile[]>('list_worktree_files', {
          worktreePath,
          maxFiles: 5000,
        })
        logger.info('Worktree files loaded', { count: files.length })
        return files
      } catch (error) {
        logger.error('Failed to load worktree files', { error, worktreePath })
        return []
      }
    },
    enabled: !!worktreePath,
    staleTime: 0, // Always refetch in background so newly added files appear
    gcTime: 1000 * 60 * 10, // Keep in memory for 10 minutes
  })
}

/**
 * Hook to open a file in the configured editor.
 */
export function useOpenFileInEditor() {
  return useMutation({
    mutationFn: async ({
      path,
      editor,
      lineNumber,
    }: {
      path: string
      editor?: string
      lineNumber?: number
    }): Promise<void> => {
      if (!isTauri()) {
        throw new Error('Not in Tauri context')
      }

      logger.debug('Opening file in editor', { path, editor, lineNumber })
      await invoke('open_file_in_default_app', { path, editor, lineNumber })
      logger.info('Opened file in editor')
    },
    onError: error => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error occurred'
      logger.error('Failed to open file in editor', { error })
      toast.error('Failed to open file in editor', { description: message })
    },
  })
}
