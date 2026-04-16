import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { hasBackend } from '@/lib/environment'
import type {
  Automation,
  AutomationStatus,
  AutomationUpsertInput,
} from '@/types/automations'

export const automationsQueryKeys = {
  all: ['automations'] as const,
  list: (projectId: string) =>
    [...automationsQueryKeys.all, projectId] as const,
}

function toAutomationCommandPayload(input: AutomationUpsertInput) {
  return {
    name: input.name,
    prompt: input.prompt,
    targetMode: input.target_mode,
    targetWorktreeIds: input.target_worktree_ids,
    backend: input.backend,
    model: input.model,
    provider: input.provider,
    executionMode: input.execution_mode,
    thinkingLevel: input.thinking_level,
    effortLevel: input.effort_level,
    scheduleRrule: input.schedule_rrule,
    runWindowStartHour: input.run_window_start_hour,
    runWindowEndHour: input.run_window_end_hour,
    status: input.status,
  }
}

function hasAutomationBackend() {
  return hasBackend()
}

export function useAutomations(projectId: string | null) {
  return useQuery({
    queryKey: automationsQueryKeys.list(projectId ?? ''),
    queryFn: async (): Promise<Automation[]> => {
      if (!hasAutomationBackend() || !projectId) return []
      return invoke<Automation[]>('list_automations', { projectId })
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

export function useCreateAutomation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      input,
    }: {
      projectId: string
      input: AutomationUpsertInput
    }) =>
      invoke<Automation>('create_automation', {
        projectId,
        ...toAutomationCommandPayload(input),
      }),
    onSuccess: automation => {
      queryClient.invalidateQueries({
        queryKey: automationsQueryKeys.list(automation.project_id),
      })
    },
    onError: error => {
      toast.error('Failed to create automation', {
        description: String(error),
      })
    },
  })
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: AutomationUpsertInput
    }) =>
      invoke<Automation>('update_automation', {
        id,
        ...toAutomationCommandPayload(input),
      }),
    onSuccess: automation => {
      queryClient.invalidateQueries({
        queryKey: automationsQueryKeys.list(automation.project_id),
      })
    },
    onError: error => {
      toast.error('Failed to update automation', {
        description: String(error),
      })
    },
  })
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
    }: {
      id: string
      projectId: string
    }) => invoke<boolean>('delete_automation', { id }),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: automationsQueryKeys.list(projectId),
      })
    },
    onError: error => {
      toast.error('Failed to delete automation', {
        description: String(error),
      })
    },
  })
}

export function useRunAutomationNow() {
  return useMutation({
    mutationFn: async (id: string) => invoke('run_automation_now', { id }),
    onError: error => {
      toast.error('Failed to start automation', {
        description: String(error),
      })
    },
  })
}

function useAutomationStatusMutation(targetStatus: AutomationStatus) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      projectId: _projectId,
    }: {
      id: string
      projectId: string
    }) =>
      invoke<Automation>(
        targetStatus === 'paused' ? 'pause_automation' : 'resume_automation',
        { id }
      ),
    onSuccess: automation => {
      queryClient.invalidateQueries({
        queryKey: automationsQueryKeys.list(automation.project_id),
      })
    },
    onError: error => {
      toast.error(
        targetStatus === 'paused'
          ? 'Failed to pause automation'
          : 'Failed to resume automation',
        {
          description: String(error),
        }
      )
    },
  })
}

export function usePauseAutomation() {
  return useAutomationStatusMutation('paused')
}

export function useResumeAutomation() {
  return useAutomationStatusMutation('enabled')
}
