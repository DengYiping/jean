import { Kanban, Plus } from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import type { AppCommand } from './types'

export const agentBoardCommands: AppCommand[] = [
  {
    id: 'open-agent-board',
    label: 'Toggle Agent Board',
    description: 'Switch between the workspace and global agent kanban board',
    icon: Kanban,
    group: 'navigation',
    shortcut: 'mod+shift+a',
    execute: () => {
      const { activeMainView, setActiveMainView } = useUIStore.getState()
      setActiveMainView(
        activeMainView === 'agent_board' ? 'workspace' : 'agent_board'
      )
    },
  },
  {
    id: 'new-agent-todo',
    label: 'New Agent Todo',
    description: 'Create a new agent board todo',
    icon: Plus,
    group: 'navigation',
    shortcut: 'mod+alt+a',
    execute: () => {
      useUIStore.getState().requestNewAgentTodoDialog()
      window.dispatchEvent(new CustomEvent('agent-board:new-todo'))
    },
  },
]
