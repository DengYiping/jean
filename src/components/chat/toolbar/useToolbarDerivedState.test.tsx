import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useToolbarDerivedState } from './useToolbarDerivedState'
import type * as ModelCatalog from '@/services/model-catalog'

vi.mock('@/services/model-catalog', async importOriginal => {
  const actual = await importOriginal<typeof ModelCatalog>()
  return {
    ...actual,
    useModelCatalog: () => ({
      data: {
        version: 1,
        updated_at: 'test',
        defaults: { claude: 'claude-fable-5', codex: 'gpt-5.5' },
        backends: {
          claude: {
            models: [
              {
                id: 'claude-fable-5',
                label: 'Claude Fable 5',
              },
            ],
          },
          codex: {
            models: [
              {
                id: 'gpt-5.5',
                label: 'GPT 5.5',
                fast_id: 'gpt-5.5-fast',
              },
              {
                id: 'gpt-5.4',
                label: 'GPT 5.4',
                fast_id: 'gpt-5.4-fast',
              },
            ],
          },
        },
      },
    }),
  }
})

describe('useToolbarDerivedState', () => {
  it('deduplicates fast variants into one desktop picker row and exposes remembered state', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () =>
        useToolbarDerivedState({
          selectedBackend: 'codex',
          selectedProvider: null,
          selectedModel: 'gpt-5.4-fast',
          opencodeModelOptions: undefined,
          customCliProfiles: [],
          customCodexModels: [],
          favoriteModels: ['codex:gpt-5.4'],
          fastModeModels: ['codex:gpt-5.4'],
          availableMcpServers: [],
          enabledMcpServers: [],
        }),
      { wrapper }
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

  it('keeps fork legacy Claude aliases when the remote catalog omits them', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () =>
        useToolbarDerivedState({
          selectedBackend: 'claude',
          selectedProvider: null,
          selectedModel: 'sonnet',
          opencodeModelOptions: undefined,
          customCliProfiles: [],
          customCodexModels: [],
          favoriteModels: [],
          fastModeModels: [],
          availableMcpServers: [],
          enabledMcpServers: [],
        }),
      { wrapper }
    )

    expect(result.current.selectedModelLabel).toBe('Sonnet 4.6')
    expect(result.current.desktopModelOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'claude-fable-5', label: 'Fable 5' }),
        expect.objectContaining({ value: 'sonnet', label: 'Sonnet 4.6' }),
        expect.objectContaining({
          value: 'claude-opus-4-7',
          label: 'Opus 4.7',
        }),
      ])
    )
  })

  it('formats future Claude model ids when no picker option exists yet', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () =>
        useToolbarDerivedState({
          selectedBackend: 'claude',
          selectedProvider: null,
          selectedModel: 'claude-sonnet-6-1',
          opencodeModelOptions: undefined,
          customCliProfiles: [],
          customCodexModels: [],
          favoriteModels: [],
          fastModeModels: [],
          availableMcpServers: [],
          enabledMcpServers: [],
        }),
      { wrapper }
    )

    expect(result.current.selectedModelLabel).toBe('Sonnet 6 1')
  })

  it('shows custom Codex model display names in the desktop picker', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () =>
        useToolbarDerivedState({
          selectedBackend: 'codex',
          selectedProvider: null,
          selectedModel: 'o3',
          opencodeModelOptions: undefined,
          customCliProfiles: [],
          customCodexModels: [{ model_id: 'o3', display_name: 'O3' }],
          favoriteModels: [],
          fastModeModels: [],
          availableMcpServers: [],
          enabledMcpServers: [],
        }),
      { wrapper }
    )

    expect(result.current.selectedModelLabel).toBe('O3')
    expect(result.current.desktopModelOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'o3', label: 'O3' }),
      ])
    )
  })
})
