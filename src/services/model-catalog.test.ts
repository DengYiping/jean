import { describe, expect, it, vi } from 'vitest'
import {
  MODEL_CATALOG_URL,
  clearCachedModelCatalog,
  fetchModelCatalog,
  getCatalogModelFastInfo,
  getCatalogModelOptions,
  getCodexModelOptions,
  readCachedModelCatalog,
  resolveRememberedCatalogFastModel,
} from './model-catalog'

function createStorage() {
  const store = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
  } satisfies Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

describe('model catalog', () => {
  it('fetches the remote catalog and caches Claude/Codex models', async () => {
    const storage = createStorage()
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url)).toBe(MODEL_CATALOG_URL)
      return new Response(
        JSON.stringify({
          version: 1,
          updated_at: '2026-06-09T00:00:00Z',
          defaults: { claude: 'claude-fable-5', codex: 'gpt-5.5' },
          backends: {
            claude: {
              models: [
                {
                  id: 'claude-fable-5',
                  label: 'Claude Fable 5',
                  supports_fast: false,
                },
              ],
            },
            codex: {
              models: [
                {
                  id: 'gpt-5.5',
                  label: 'GPT 5.5',
                  fast_id: 'gpt-5.5-fast',
                  supports_fast: true,
                },
              ],
            },
          },
        }),
        { status: 200 }
      )
    })

    const catalog = await fetchModelCatalog({ fetchImpl, storage })

    expect(getCatalogModelOptions(catalog, 'claude')).toEqual([
      { value: 'claude-fable-5', label: 'Claude Fable 5' },
    ])
    expect(getCatalogModelFastInfo(catalog, 'codex', 'gpt-5.5')).toEqual({
      supportsFast: true,
      isFast: false,
      baseModel: 'gpt-5.5',
      fastModel: 'gpt-5.5-fast',
    })
    expect(
      resolveRememberedCatalogFastModel(catalog, 'codex', 'gpt-5.5', [
        'codex:gpt-5.5',
      ])
    ).toBe('gpt-5.5-fast')
    expect(readCachedModelCatalog(storage)?.defaults.claude).toBe(
      'claude-fable-5'
    )
  })

  it('returns the cached catalog when fetch fails', async () => {
    const storage = createStorage()
    await fetchModelCatalog({
      storage,
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              updated_at: '2026-06-09T00:00:00Z',
              defaults: { claude: 'claude-fable-5', codex: 'gpt-5.5' },
              backends: {
                claude: {
                  models: [{ id: 'claude-fable-5', label: 'Claude Fable 5' }],
                },
                codex: { models: [{ id: 'gpt-5.5', label: 'GPT 5.5' }] },
              },
            }),
            { status: 200 }
          )
      ),
    })

    const catalog = await fetchModelCatalog({
      storage,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline')
      }),
    })

    expect(getCatalogModelOptions(catalog, 'claude')[0]).toEqual({
      value: 'claude-fable-5',
      label: 'Claude Fable 5',
    })
  })

  it('falls back to bundled models when fetch and cache are unavailable', async () => {
    const storage = createStorage()
    clearCachedModelCatalog(storage)

    const catalog = await fetchModelCatalog({
      storage,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline')
      }),
    })

    expect(getCatalogModelOptions(catalog, 'claude')).toContainEqual({
      value: 'claude-fable-5',
      label: 'Claude Fable 5',
    })
    expect(getCatalogModelOptions(catalog, 'codex')).toContainEqual({
      value: 'gpt-5.5',
      label: 'GPT 5.5',
    })
    expect(getCatalogModelOptions(catalog, 'codex').slice(0, 3)).toEqual([
      { value: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
      { value: 'gpt-5.6-terra', label: 'GPT 5.6 Terra' },
      { value: 'gpt-5.6-luna', label: 'GPT 5.6 Luna' },
    ])
    expect(getCatalogModelFastInfo(catalog, 'codex', 'gpt-5.6-sol')).toEqual({
      supportsFast: true,
      isFast: false,
      baseModel: 'gpt-5.6-sol',
      fastModel: 'gpt-5.6-sol-fast',
    })
    expect(
      getCatalogModelFastInfo(catalog, 'codex', 'gpt-5.6-sol-fast')
    ).toEqual({
      supportsFast: true,
      isFast: true,
      baseModel: 'gpt-5.6-sol',
      fastModel: 'gpt-5.6-sol-fast',
    })
  })

  it('merges custom Codex models after catalog models without duplicate rows', async () => {
    const catalog = await fetchModelCatalog({
      storage: createStorage(),
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: 1,
              updated_at: '2026-06-09T00:00:00Z',
              defaults: { claude: 'claude-fable-5', codex: 'gpt-5.5' },
              backends: {
                claude: {
                  models: [{ id: 'claude-fable-5', label: 'Claude Fable 5' }],
                },
                codex: { models: [{ id: 'gpt-5.5', label: 'GPT 5.5' }] },
              },
            }),
            { status: 200 }
          )
      ),
    })

    expect(
      getCodexModelOptions(
        catalog,
        [
          { model_id: 'o3', display_name: 'O3' },
          { model_id: 'gpt-5.5', display_name: 'Duplicate' },
        ],
        'legacy-codex'
      )
    ).toEqual([
      { value: 'gpt-5.5', label: 'GPT 5.5' },
      { value: 'o3', label: 'O3' },
      { value: 'legacy-codex', label: 'legacy-codex' },
    ])
  })
})
