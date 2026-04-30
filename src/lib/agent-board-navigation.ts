import { useUIStore } from '@/store/ui-store'

export const AGENT_BOARD_FOCUS_EVENT = 'agent-board:focus-item'

export function openAgentBoardItem(itemId: string) {
  useUIStore.getState().setActiveMainView('agent_board')
  window.dispatchEvent(
    new CustomEvent(AGENT_BOARD_FOCUS_EVENT, { detail: { itemId } })
  )
}
