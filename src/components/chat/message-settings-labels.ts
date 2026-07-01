import {
  CODEX_MODEL_OPTIONS,
  MODEL_OPTIONS,
  OPENCODE_MODEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'
import {
  formatClaudeModelLabel,
  formatOpencodeModelLabel,
} from '@/components/chat/toolbar/toolbar-utils'
import {
  getClaudeFastInfo,
  getCodexFastInfo,
  type CustomCodexModel,
} from '@/types/preferences'

const ALL_MODEL_OPTIONS = [
  ...MODEL_OPTIONS,
  ...CODEX_MODEL_OPTIONS,
  ...OPENCODE_MODEL_OPTIONS,
]

const MODEL_LABEL_ALIASES: Record<string, string> = {
  opus: 'Opus',
}

function getKnownModelLabel(model: string): string | null {
  return (
    ALL_MODEL_OPTIONS.find(option => option.value === model)?.label ??
    MODEL_LABEL_ALIASES[model] ??
    null
  )
}

export function getMessageModelLabel(
  model: string,
  customCodexModels: readonly CustomCodexModel[] = []
): string {
  const customCodexLabel = customCodexModels.find(
    custom => custom.model_id === model
  )?.display_name
  if (customCodexLabel) return customCodexLabel

  const directLabel = getKnownModelLabel(model)
  if (directLabel) return directLabel

  const codexFastInfo = getCodexFastInfo(model)
  if (codexFastInfo.isFast) {
    const baseLabel = getKnownModelLabel(codexFastInfo.baseModel)
    if (baseLabel) return `${baseLabel} Fast`
  }

  const claudeFastInfo = getClaudeFastInfo(model)
  if (claudeFastInfo.isFast) {
    const baseLabel = getKnownModelLabel(claudeFastInfo.baseModel)
    if (baseLabel) return `${baseLabel} Fast`
  }

  if (model.startsWith('claude-')) return formatClaudeModelLabel(model)
  return model.includes('/') ? formatOpencodeModelLabel(model) : model
}
