import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsNativeApp, mockToastWarning, mockLoggerWarn } = vi.hoisted(
  () => ({
    mockIsNativeApp: vi.fn(),
    mockToastWarning: vi.fn(),
    mockLoggerWarn: vi.fn(),
  })
)

vi.mock('@/lib/build-info', () => ({
  CLIENT_BUILD_INFO: {
    webBuildId: 'client-build-1',
    appVersion: '0.2.0',
  },
  CLIENT_WEB_BUILD_ID: 'client-build-1',
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: mockIsNativeApp,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    warning: mockToastWarning,
  },
}))

describe('checkWebClientVersion', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockIsNativeApp.mockReturnValue(false)
  })

  it('does nothing when running in the native app', async () => {
    mockIsNativeApp.mockReturnValue(true)
    const { checkWebClientVersion } = await import('./web-client-version')

    expect(
      checkWebClientVersion({
        webBuildId: 'server-build-2',
        appVersion: '0.3.0',
      })
    ).toBe(false)
    expect(mockToastWarning).not.toHaveBeenCalled()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('does nothing when the client build matches the server build', async () => {
    const { checkWebClientVersion } = await import('./web-client-version')

    expect(
      checkWebClientVersion({
        webBuildId: 'client-build-1',
        appVersion: '0.2.0',
      })
    ).toBe(false)
    expect(mockToastWarning).not.toHaveBeenCalled()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('warns once when the loaded browser bundle is stale', async () => {
    const { checkWebClientVersion } = await import('./web-client-version')

    expect(
      checkWebClientVersion({
        webBuildId: 'server-build-2',
        appVersion: '0.3.0',
      })
    ).toBe(true)
    expect(
      checkWebClientVersion({
        webBuildId: 'server-build-2',
        appVersion: '0.3.0',
      })
    ).toBe(true)

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Stale web access client detected',
      expect.objectContaining({
        clientBuildId: 'client-build-1',
        serverBuildId: 'server-build-2',
        clientVersion: '0.2.0',
        serverVersion: '0.3.0',
      })
    )
    expect(mockToastWarning).toHaveBeenCalledTimes(1)
    expect(mockToastWarning).toHaveBeenCalledWith(
      'Jean was updated',
      expect.objectContaining({
        id: 'web-client-stale',
        description:
          'Reload Web Access to use Jean 0.3.0 and the latest features.',
        duration: Infinity,
        closeButton: false,
        action: expect.objectContaining({
          label: 'Reload',
          onClick: expect.any(Function),
        }),
      })
    )
  })
})
