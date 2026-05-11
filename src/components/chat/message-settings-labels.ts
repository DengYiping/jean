import {
  CODEX_MODEL_OPTIONS,
  MODEL_OPTIONS,
  OPENCODE_MODEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'
import { formatOpencodeModelLabel } from '@/components/chat/toolbar/toolbar-utils'
import { getClaudeFastInfo, getCodexFastInfo } from '@/types/preferences'

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

export function getMessageModelLabel(model: string): string {
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

  return model.includes('/') ? formatOpencodeModelLabel(model) : model
}
