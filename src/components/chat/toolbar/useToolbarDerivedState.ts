import { useMemo } from 'react'
import {
  getModelFastInfo,
  getModelPreferenceKey,
  type ClaudeModel,
  type CustomCliProfile,
} from '@/types/preferences'
import {
  CODEX_MODEL_OPTIONS,
  MODEL_OPTIONS,
  OPENCODE_MODEL_OPTIONS,
} from '@/components/chat/toolbar/toolbar-options'

export interface DesktopModelPickerOption {
  value: string
  label: string
  favoriteKey: string
  isFavorite: boolean
  supportsFast: boolean
  isFastEnabled: boolean
  searchText: string
}

interface UseToolbarDerivedStateArgs {
  selectedBackend: 'claude' | 'codex' | 'opencode'
  selectedProvider: string | null
  selectedModel: string
  opencodeModelOptions?: { value: string; label: string }[]
  customCliProfiles: CustomCliProfile[]
  favoriteModels: string[]
  fastModeModels: string[]
  availableMcpServers: { name: string; disabled?: boolean }[]
  enabledMcpServers: string[]
}

export function useToolbarDerivedState({
  selectedBackend,
  selectedProvider,
  selectedModel,
  opencodeModelOptions,
  customCliProfiles,
  favoriteModels,
  fastModeModels,
  availableMcpServers,
  enabledMcpServers,
}: UseToolbarDerivedStateArgs) {
  const isCodex = selectedBackend === 'codex'
  const isOpencode = selectedBackend === 'opencode'
  const fastModelSelectionEnabled =
    selectedBackend === 'codex' ||
    (selectedBackend === 'claude' &&
      (!selectedProvider || selectedProvider === '__anthropic__'))

  const activeMcpCount = useMemo(() => {
    const availableNames = new Set(
      availableMcpServers.filter(s => !s.disabled).map(s => s.name)
    )
    return enabledMcpServers.filter(name => availableNames.has(name)).length
  }, [availableMcpServers, enabledMcpServers])

  const filteredModelOptions = useMemo(() => {
    if (isCodex)
      return CODEX_MODEL_OPTIONS as { value: string; label: string }[]
    if (isOpencode) return opencodeModelOptions ?? OPENCODE_MODEL_OPTIONS
    if (!selectedProvider || selectedProvider === '__anthropic__') {
      return MODEL_OPTIONS
    }

    const profile = customCliProfiles.find(p => p.name === selectedProvider)
    let opusModel: string | undefined
    let sonnetModel: string | undefined
    let haikuModel: string | undefined
    if (profile?.settings_json) {
      try {
        const settings = JSON.parse(profile.settings_json)
        const env = settings?.env
        if (env) {
          opusModel = env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_MODEL
          sonnetModel =
            env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_MODEL
          haikuModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_MODEL
        }
      } catch {
        // ignore parse errors
      }
    }

    const suffix = (model?: string) => (model ? ` (${model})` : '')
    return [
      { value: 'opus' as ClaudeModel, label: `Opus${suffix(opusModel)}` },
      { value: 'sonnet' as ClaudeModel, label: `Sonnet${suffix(sonnetModel)}` },
      { value: 'haiku' as ClaudeModel, label: `Haiku${suffix(haikuModel)}` },
    ]
  }, [
    selectedProvider,
    customCliProfiles,
    isCodex,
    isOpencode,
    opencodeModelOptions,
  ])

  const selectedFastInfo = useMemo(
    () =>
      fastModelSelectionEnabled
        ? getModelFastInfo(selectedBackend, selectedModel)
        : {
            supportsFast: false,
            isFast: false,
            baseModel: selectedModel,
          },
    [fastModelSelectionEnabled, selectedBackend, selectedModel]
  )

  const desktopModelOptions = useMemo<DesktopModelPickerOption[]>(() => {
    const favoriteModelKeys = new Set(favoriteModels)
    const rememberedFastModelKeys = new Set(fastModeModels)
    const seenModels = new Set<string>()

    return filteredModelOptions.flatMap(option => {
      const fastInfo = fastModelSelectionEnabled
        ? getModelFastInfo(selectedBackend, option.value)
        : {
            supportsFast: false,
            isFast: false,
            baseModel: option.value,
          }
      const value = fastInfo.baseModel
      if (seenModels.has(value)) return []

      seenModels.add(value)

      const favoriteKey = getModelPreferenceKey(selectedBackend, option.value)
      const isSelectedFastModel =
        selectedFastInfo.isFast && selectedFastInfo.baseModel === value

      return [
        {
          value,
          label: option.label,
          favoriteKey,
          isFavorite: favoriteModelKeys.has(favoriteKey),
          supportsFast: fastInfo.supportsFast,
          isFastEnabled:
            fastInfo.supportsFast &&
            (rememberedFastModelKeys.has(favoriteKey) || isSelectedFastModel),
          searchText: `${option.label} ${option.value}${
            fastInfo.supportsFast ? ' fast' : ''
          }`.toLowerCase(),
        },
      ]
    })
  }, [
    favoriteModels,
    fastModeModels,
    filteredModelOptions,
    fastModelSelectionEnabled,
    selectedBackend,
    selectedFastInfo.baseModel,
    selectedFastInfo.isFast,
  ])

  const selectedBaseModel = selectedFastInfo.baseModel
  const selectedModelLabel =
    desktopModelOptions.find(option => option.value === selectedBaseModel)
      ?.label ?? selectedBaseModel

  return {
    isCodex,
    isOpencode,
    activeMcpCount,
    filteredModelOptions,
    desktopModelOptions,
    selectedBaseModel,
    selectedModelIsFast: selectedFastInfo.isFast,
    selectedModelLabel,
  }
}
