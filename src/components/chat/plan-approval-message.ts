import type { Session } from '@/types/chat'
import {
  DEFAULT_PLAN_APPROVAL_BUILD_PROMPT,
  DEFAULT_PLAN_APPROVAL_CODEX_PROMPT,
  DEFAULT_PLAN_APPROVAL_YOLO_PROMPT,
} from '@/types/preferences'

interface PlanApprovalMessageOptions {
  mode: 'build' | 'yolo'
  backend: Session['backend'] | null | undefined
  updatedPlan?: string
  originalPlan?: string | null
  customPrompt?: string | null
  approvedPlanContent?: string | null
  configuredBuildPrompt?: string | null
  configuredYoloPrompt?: string | null
  configuredCodexPrompt?: string | null
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
  configuredBuildPrompt,
  configuredYoloPrompt,
  configuredCodexPrompt,
}: PlanApprovalMessageOptions): string {
  const trimmedCustomPrompt = customPrompt?.trim()
  const trimmedUpdatedPlan = updatedPlan?.trim()
  const trimmedBuildPrompt = configuredBuildPrompt?.trim()
  const trimmedYoloPrompt = configuredYoloPrompt?.trim()
  const trimmedCodexPrompt = configuredCodexPrompt?.trim()

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
    return trimmedCodexPrompt || DEFAULT_PLAN_APPROVAL_CODEX_PROMPT
  }

  if (mode === 'yolo') {
    return trimmedYoloPrompt || DEFAULT_PLAN_APPROVAL_YOLO_PROMPT
  }

  return trimmedBuildPrompt || DEFAULT_PLAN_APPROVAL_BUILD_PROMPT
}
