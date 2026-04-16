import { ArrowDownToLine } from 'lucide-react'
import type { AppCommand } from './types'

export const gitCommands: AppCommand[] = [
  {
    id: 'git.pull-upstream',
    label: 'Update From Upstream Branch',
    description:
      'Fetch and merge the current branch upstream tracking branch into this worktree',
    icon: ArrowDownToLine,
    group: 'git',
    keywords: [
      'git',
      'pull',
      'upstream',
      'tracking',
      'remote',
      'branch',
      'sync',
      'update',
    ],

    isAvailable: context => context.hasActiveWorktree(),

    execute: context => {
      context.gitPullUpstream()
    },
  },
]
