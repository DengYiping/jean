import { Kanban, Plus } from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import type { AppCommand } from './types'

export const agentBoardCommands: AppCommand[] = [
  {
    id: 'open-agent-board',
    label: 'Open Agent Board',
    description: 'Open the global agent kanban board',
    icon: Kanban,
    group: 'navigation',
    shortcut: 'mod+shift+k',
    execute: () => {
      useUIStore.getState().setActiveMainView('agent_board')
    },
  },
  {
    id: 'new-agent-todo',
    label: 'New Agent Todo',
    description: 'Create a new agent board todo',
    icon: Plus,
    group: 'navigation',
    shortcut: 'mod+shift+a',
    execute: () => {
      useUIStore.getState().setActiveMainView('agent_board')
      window.dispatchEvent(new CustomEvent('agent-board:new-todo'))
    },
  },
]
