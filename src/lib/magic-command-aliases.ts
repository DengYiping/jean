import type { QueueableMagicCommand } from '@/types/chat'

interface MagicCommandAlias {
  command: QueueableMagicCommand
  label: string
}

const SLASH_MAGIC_COMMAND_ALIASES = new Map<string, MagicCommandAlias>([
  ['/commit', { command: 'commit', label: 'Commit' }],
  [
    '/commit-and-push',
    { command: 'commit-and-push', label: 'Commit and push' },
  ],
  [
    '/commit and push',
    { command: 'commit-and-push', label: 'Commit and push' },
  ],
  ['/create-pr', { command: 'open-pr', label: 'Create PR' }],
  ['/create pr', { command: 'open-pr', label: 'Create PR' }],
  ['/create-draft-pr', { command: 'draft-pr', label: 'Create draft PR' }],
  ['/create draft pr', { command: 'draft-pr', label: 'Create draft PR' }],
])

export function parseSlashMagicCommand(
  input: string
): MagicCommandAlias | null {
  const normalized = input.trim().replace(/\s+/g, ' ').toLowerCase()
  return SLASH_MAGIC_COMMAND_ALIASES.get(normalized) ?? null
}
