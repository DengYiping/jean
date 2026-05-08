import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import { useDragAndDropImages } from './useDragAndDropImages'

type DragDropHandler = (event: {
  payload:
    | { type: 'enter' }
    | { type: 'drop'; paths: string[] }
    | { type: 'leave' }
}) => void

const { mockInvoke, mockToastError, mockOnDragDropEvent, mockUnlisten } =
  vi.hoisted(() => ({
    mockInvoke: vi.fn(),
    mockToastError: vi.fn(),
    mockOnDragDropEvent: vi.fn(),
    mockUnlisten: vi.fn(),
  }))

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: mockOnDragDropEvent,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
    warning: vi.fn(),
  },
}))

describe('useDragAndDropImages', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockToastError.mockClear()
    mockOnDragDropEvent.mockReset()
    mockUnlisten.mockClear()
    mockOnDragDropEvent.mockResolvedValue(mockUnlisten)
    mockInvoke.mockResolvedValue({
      id: 'image-1',
      path: '/tmp/pasted-images/image-1.png',
      filename: 'image-1.png',
    })

    // isNativeApp() checks this marker before registering native drop listeners.
    Object.assign(window, { __TAURI_INTERNALS__: {} })

    useChatStore.setState({
      pendingImages: {},
      pendingTextFiles: {},
    })
  })

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__
  })

  it('registers native image drops on the current webview', async () => {
    renderHook(() => useDragAndDropImages('session-1'))

    await waitFor(() => {
      expect(mockOnDragDropEvent).toHaveBeenCalledTimes(1)
    })

    const handler = mockOnDragDropEvent.mock.calls[0]?.[0] as
      | DragDropHandler
      | undefined
    expect(handler).toBeDefined()

    await act(async () => {
      handler?.({ payload: { type: 'drop', paths: ['/tmp/screenshot.png'] } })
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('save_dropped_image', {
        sourcePath: '/tmp/screenshot.png',
      })
      expect(useChatStore.getState().pendingImages['session-1']).toEqual([
        {
          id: 'image-1',
          path: '/tmp/pasted-images/image-1.png',
          filename: 'image-1.png',
          loading: false,
        },
      ])
    })
  })

  it('rejects unsupported dropped files before invoking the backend', async () => {
    renderHook(() => useDragAndDropImages('session-1'))

    await waitFor(() => {
      expect(mockOnDragDropEvent).toHaveBeenCalledTimes(1)
    })

    const handler = mockOnDragDropEvent.mock.calls[0]?.[0] as DragDropHandler

    await act(async () => {
      handler({ payload: { type: 'drop', paths: ['/tmp/notes.txt'] } })
    })

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('No image detected', {
      description: 'Only PNG, JPEG, GIF, WebP, SVG files are accepted',
    })
    expect(useChatStore.getState().pendingImages['session-1']).toBeUndefined()
  })
})
