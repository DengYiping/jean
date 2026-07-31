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
import type { Backend, ChatMessage } from '@/types/chat'

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

export interface ProviderChange {
  from: Backend
  to: Backend
  fromLabel: string
  toLabel: string
}

function inferBackendFromModel(model: string | undefined): Backend | null {
  if (!model) return null
  if (model.startsWith('opencode/') || model.includes('/')) return 'opencode'
  if (model.startsWith('codex') || model.includes('codex')) return 'codex'
  return 'claude'
}

export function getProviderChangeBeforeMessage(
  messages: ChatMessage[],
  index: number
): ProviderChange | null {
  const current = messages[index]
  if (current?.role !== 'user') return null

  const to = inferBackendFromModel(current.model)
  if (!to) return null

  for (let i = index - 1; i >= 0; i--) {
    const previous = messages[i]
    if (previous?.role !== 'user') continue

    const from = inferBackendFromModel(previous.model)
    if (!from || from === to) return null
    return {
      from,
      to,
      fromLabel:
        from === 'opencode'
          ? 'OpenCode'
          : from === 'codex'
            ? 'Codex'
            : 'Claude',
      toLabel:
        to === 'opencode' ? 'OpenCode' : to === 'codex' ? 'Codex' : 'Claude',
    }
  }

  return null
}
