import { appendSkillPromptContext } from '@/lib/skill-prompt'
import type {
  Backend,
  EffortLevel,
  ExecutionMode,
  ThinkingLevel,
} from '@/types/chat'
import type { AppPreferences } from '@/types/preferences'

type ApprovalContinuationMode = Extract<ExecutionMode, 'build' | 'yolo'>

type ApprovalContinuationPreferences = Pick<
  AppPreferences,
  | 'selected_model'
  | 'selected_codex_model'
  | 'selected_opencode_model'
  | 'thinking_level'
  | 'default_codex_reasoning_effort'
  | 'build_model'
  | 'yolo_model'
  | 'build_backend'
  | 'yolo_backend'
  | 'build_thinking_level'
  | 'yolo_thinking_level'
  | 'build_effort_level'
  | 'yolo_effort_level'
>

interface ResolveApprovedPlanContinuationParams {
  mode: ApprovalContinuationMode
  planContent: string
  planFilePath?: string | null
  originalBackend?: Backend | null
  originalModel?: string | null
  preferences?: ApprovalContinuationPreferences
  modeBackendOverride?: string | null
  modeModelOverride?: string | null
  modeThinkingOverride?: string | null
  modeEffortOverride?: string | null
  fallbackThinkingLevel?: ThinkingLevel
  fallbackEffortLevel?: EffortLevel
  useAdaptiveThinking?: boolean
  returnOriginalBackend?: boolean
  useNonAdaptiveEffortOverride?: boolean
  imagePaths?: string[]
  skillPaths?: string[]
  textFilePaths?: string[]
}

export interface ApprovedPlanContinuation {
  backend?: Backend
  model: string
  modeLabel: 'Build' | 'Yolo'
  modeOverride: string
  message: string
  thinkingLevel: ThinkingLevel
  effortLevel?: EffortLevel
}

const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8[1m]'
const DEFAULT_CODEX_MODEL = 'gpt-5.5'
const DEFAULT_OPENCODE_MODEL = 'opencode/gpt-5.3-codex'

const THINKING_LEVEL_VALUES = new Set<ThinkingLevel>([
  'off',
  'think',
  'megathink',
  'ultrathink',
])

function isBackend(value: string | null | undefined): value is Backend {
  return value === 'claude' || value === 'codex' || value === 'opencode'
}

function isThinkingLevel(
  value: string | null | undefined
): value is ThinkingLevel {
  if (!value) return false
  return THINKING_LEVEL_VALUES.has(value as ThinkingLevel)
}

function mapCodexReasoningToEffort(
  value: string | null | undefined
): EffortLevel | undefined {
  switch (value) {
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
      return 'xhigh'
    case 'max':
      return 'max'
    default:
      return undefined
  }
}

function getDefaultModelForBackend(
  backend: Backend | undefined,
  preferences: ApprovalContinuationPreferences | undefined
): string {
  if (backend === 'codex') {
    return preferences?.selected_codex_model ?? DEFAULT_CODEX_MODEL
  }
  if (backend === 'opencode') {
    return preferences?.selected_opencode_model ?? DEFAULT_OPENCODE_MODEL
  }
  return preferences?.selected_model ?? DEFAULT_CLAUDE_MODEL
}

function appendFileReferences(
  message: string,
  imagePaths: string[],
  textFilePaths: string[]
): string {
  let nextMessage = message

  if (imagePaths.length > 0) {
    const imageRefs = imagePaths
      .map(p => `[Image attached: ${p} - Use the Read tool to view this image]`)
      .join('\n')
    nextMessage = `${nextMessage}\n\n${imageRefs}`
  }

  if (textFilePaths.length > 0) {
    const textFileRefs = textFilePaths
      .map(
        p => `[Text file attached: ${p} - Use the Read tool to view this file]`
      )
      .join('\n')
    nextMessage = `${nextMessage}\n\n${textFileRefs}`
  }

  return nextMessage
}

export function resolveApprovedPlanContinuation({
  mode,
  planContent,
  planFilePath,
  originalBackend,
  originalModel,
  preferences,
  modeBackendOverride,
  modeModelOverride,
  modeThinkingOverride,
  modeEffortOverride,
  fallbackThinkingLevel,
  fallbackEffortLevel,
  useAdaptiveThinking = false,
  returnOriginalBackend = true,
  useNonAdaptiveEffortOverride = true,
  imagePaths = [],
  skillPaths = [],
  textFilePaths = [],
}: ResolveApprovedPlanContinuationParams): ApprovedPlanContinuation {
  const isYolo = mode === 'yolo'
  const modeLabel = isYolo ? 'Yolo' : 'Build'
  const modeBackendPref =
    modeBackendOverride ??
    (isYolo ? preferences?.yolo_backend : preferences?.build_backend)
  const modeModelPref =
    modeModelOverride ??
    (isYolo ? preferences?.yolo_model : preferences?.build_model)
  const modeThinkingPref =
    modeThinkingOverride ??
    (isYolo
      ? preferences?.yolo_thinking_level
      : preferences?.build_thinking_level)
  const modeEffortPref =
    modeEffortOverride ??
    (isYolo ? preferences?.yolo_effort_level : preferences?.build_effort_level)

  const resolvedBackendOverride = isBackend(modeBackendPref)
    ? modeBackendPref
    : null
  const effectiveBackend =
    resolvedBackendOverride ?? originalBackend ?? undefined
  const backend =
    resolvedBackendOverride ??
    (returnOriginalBackend ? (originalBackend ?? undefined) : undefined)
  const model =
    modeModelPref ??
    (resolvedBackendOverride
      ? getDefaultModelForBackend(effectiveBackend, preferences)
      : (originalModel ??
        getDefaultModelForBackend(effectiveBackend, preferences)))
  const modeOverride =
    modeModelPref || resolvedBackendOverride
      ? [backend, model].filter(Boolean).join(' / ')
      : ''

  let thinkingLevel: ThinkingLevel = 'off'
  let effortLevel: EffortLevel | undefined

  if (effectiveBackend === 'codex') {
    const defaultCodexEffort =
      mapCodexReasoningToEffort(preferences?.default_codex_reasoning_effort) ??
      'high'
    effortLevel =
      mapCodexReasoningToEffort(modeEffortPref) ??
      fallbackEffortLevel ??
      defaultCodexEffort
  } else {
    const fallbackThinking = fallbackThinkingLevel
      ? fallbackThinkingLevel
      : isThinkingLevel(preferences?.thinking_level)
        ? preferences.thinking_level
        : 'off'
    thinkingLevel = isThinkingLevel(modeThinkingPref)
      ? modeThinkingPref
      : fallbackThinking
    if (useAdaptiveThinking) {
      effortLevel =
        mapCodexReasoningToEffort(modeEffortPref) ?? fallbackEffortLevel
    } else if (useNonAdaptiveEffortOverride) {
      effortLevel = mapCodexReasoningToEffort(modeEffortPref)
    }
  }

  const planFileLine = planFilePath ? `\nPlan file: ${planFilePath}\n` : ''
  const configPrefix = modeOverride ? `[${modeLabel}: ${modeOverride}]\n` : ''
  const baseMessage = `${configPrefix}Execute this plan. Implement all changes described.${planFileLine}\n\n<plan>\n${planContent}\n</plan>`
  const messageWithSkills = appendSkillPromptContext(
    baseMessage,
    skillPaths.map(path => ({ path }))
  )

  return {
    backend,
    model,
    modeLabel,
    modeOverride,
    message: appendFileReferences(messageWithSkills, imagePaths, textFilePaths),
    thinkingLevel,
    effortLevel,
  }
}
