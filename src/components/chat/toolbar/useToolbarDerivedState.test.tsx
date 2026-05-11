import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useToolbarDerivedState } from './useToolbarDerivedState'

describe('useToolbarDerivedState', () => {
  it('deduplicates fast variants into one desktop picker row and exposes remembered state', () => {
    const { result } = renderHook(() =>
      useToolbarDerivedState({
        selectedBackend: 'codex',
        selectedProvider: null,
        selectedModel: 'gpt-5.4-fast',
        opencodeModelOptions: undefined,
        customCliProfiles: [],
        favoriteModels: ['codex:gpt-5.4'],
        fastModeModels: ['codex:gpt-5.4'],
        availableMcpServers: [],
        enabledMcpServers: [],
      })
    )

    expect(result.current.selectedBaseModel).toBe('gpt-5.4')
    expect(result.current.selectedModelLabel).toBe('GPT 5.4')
    expect(result.current.selectedModelIsFast).toBe(true)

    const gpt54Option = result.current.desktopModelOptions.find(
      option => option.value === 'gpt-5.4'
    )
    expect(gpt54Option).toMatchObject({
      isFavorite: true,
      supportsFast: true,
      isFastEnabled: true,
    })
    expect(
      result.current.desktopModelOptions.filter(
        option => option.value === 'gpt-5.4'
      )
    ).toHaveLength(1)
  })
})
