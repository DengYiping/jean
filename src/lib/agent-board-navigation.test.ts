import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_BOARD_FOCUS_EVENT,
  openAgentBoardItem,
} from '@/lib/agent-board-navigation'
import { useUIStore } from '@/store/ui-store'

describe('openAgentBoardItem', () => {
  beforeEach(() => {
    useUIStore.getState().setActiveMainView('workspace')
  })

  it('switches to the board and emits the focused item id', () => {
    const listener = vi.fn()
    window.addEventListener(AGENT_BOARD_FOCUS_EVENT, listener)

    openAgentBoardItem('item-1')

    expect(useUIStore.getState().activeMainView).toBe('agent_board')
    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0]?.[0] as CustomEvent<{
      itemId: string
    }>
    expect(event.detail).toEqual({ itemId: 'item-1' })

    window.removeEventListener(AGENT_BOARD_FOCUS_EVENT, listener)
  })
})
