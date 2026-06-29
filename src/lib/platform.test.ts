import { beforeEach, describe, expect, it, vi } from 'vitest'

const openUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: openUrlMock,
}))

describe('server platform detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    openUrlMock.mockReset()
  })

  it('uses the Jean server platform instead of the browser platform when provided', async () => {
    vi.stubGlobal('window', { open: vi.fn() })
    vi.stubGlobal('navigator', { platform: 'Win32' })

    const { getServerPlatform, isServerWindows, setServerPlatform } =
      await import('./platform')

    setServerPlatform('linux')

    expect(getServerPlatform()).toBe('linux')
    expect(isServerWindows()).toBe(false)

    setServerPlatform('windows')
    expect(isServerWindows()).toBe(true)
  })
})
