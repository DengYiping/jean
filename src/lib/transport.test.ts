import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: MockWebSocket[] = []

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  closeFromServer() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

function okJson(data: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response
}

function neverResolvingFetch() {
  return new Promise<Response>(resolve => {
    void resolve
  })
}

async function importTransport() {
  vi.resetModules()
  MockWebSocket.instances = []
  return import('./transport')
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('browser WebSocket transport recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({})))
    vi.mocked(window.localStorage.getItem).mockReturnValue('token-1')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('reconnects immediately on pageshow instead of waiting for backoff', async () => {
    await importTransport()
    await flushMicrotasks()

    expect(MockWebSocket.instances).toHaveLength(1)
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('Expected initial socket')
    socket.open()
    socket.closeFromServer()

    expect(MockWebSocket.instances).toHaveLength(1)

    window.dispatchEvent(new Event('pageshow'))
    await flushMicrotasks()

    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('replaces a stale connecting socket when the page becomes visible', async () => {
    await importTransport()
    await flushMicrotasks()

    expect(MockWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(13_000)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushMicrotasks()

    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2)
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('Expected initial socket')
    expect(socket.close).toHaveBeenCalled()
  })

  it('returns null when reconnect initial data fetch hangs', async () => {
    vi.stubGlobal('fetch', vi.fn(neverResolvingFetch))
    const { refetchInitialData } = await importTransport()

    const result = refetchInitialData()
    await vi.advanceTimersByTimeAsync(13_000)

    await expect(result).resolves.toBeNull()
  })

  it('treats auth timeout as transient and retries without auth error', async () => {
    vi.stubGlobal('fetch', vi.fn(neverResolvingFetch))
    await importTransport()

    await vi.advanceTimersByTimeAsync(13_000)
    window.dispatchEvent(new Event('pageshow'))
    await flushMicrotasks()

    expect(MockWebSocket.instances).toHaveLength(0)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
