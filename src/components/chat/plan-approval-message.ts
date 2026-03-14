import type { Session } from '@/types/chat'

interface PlanApprovalMessageOptions {
  mode: 'build' | 'yolo'
  backend: Session['backend'] | null | undefined
  updatedPlan?: string
  originalPlan?: string | null
  customPrompt?: string | null
  approvedPlanContent?: string | null
}

function formatUpdatedPlanMessage(updatedPlan: string): string {
  return `I've updated the plan. Please review and execute:

<updated-plan>
${updatedPlan}
</updated-plan>`
}

export function buildPlanApprovalMessage({
  mode,
  backend,
  updatedPlan,
  originalPlan,
  customPrompt,
  approvedPlanContent,
}: PlanApprovalMessageOptions): string {
  const trimmedCustomPrompt = customPrompt?.trim()
  const trimmedUpdatedPlan = updatedPlan?.trim()

  if (trimmedCustomPrompt) {
    const planContent =
      approvedPlanContent?.trim() ??
      trimmedUpdatedPlan ??
      originalPlan?.trim() ??
      ''

    if (!planContent) {
      throw new Error(
        'Approved plan content is required for custom prompt approvals'
      )
    }

    return `Follow these additional instructions while implementing the approved plan:

<additional-instructions>
${trimmedCustomPrompt}
</additional-instructions>

<plan>
${planContent}
</plan>`
  }

  if (trimmedUpdatedPlan && trimmedUpdatedPlan !== originalPlan?.trim()) {
    return formatUpdatedPlanMessage(trimmedUpdatedPlan)
  }

  if (backend === 'codex') {
    return 'Execute the plan you created. Implement all changes described.'
  }

  if (mode === 'yolo') {
    return 'Plan approved (yolo mode). Begin implementing all changes immediately without asking for confirmation. Do not re-explain the plan — start writing code.'
  }

  return 'Plan approved. Begin implementing the changes now. Do not re-explain the plan — start writing code.'
}
