import React, { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  useCodexSkillInventory,
  useSetCodexSkillEnabled,
} from '@/services/skills'
import { useChatStore } from '@/store/chat-store'
import type { ClaudeSkill } from '@/types/chat'

const SettingsSection: React.FC<{
  title: string
  children: React.ReactNode
}> = ({ title, children }) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <Separator className="mt-2" />
    </div>
    {children}
  </div>
)

function getSkillSourceLabel(skill: ClaudeSkill): string {
  if (skill.path.includes('/.agents/skills/')) return '.agents/skills'
  if (skill.path.includes('/.codex/skills/')) return '.codex/skills'
  if (skill.scope === 'repo') return 'Repo skills'
  if (skill.scope === 'system') return 'System skills'
  if (skill.scope === 'admin') return 'Admin skills'
  return 'Other skills'
}

function getSkillSourceDescription(activeWorktreePath?: string): string {
  if (activeWorktreePath) {
    return 'Showing skills for the active worktree and global Codex skills.'
  }

  return 'Showing global Codex skills. Open a worktree to also inspect repo skills.'
}

const SOURCE_ORDER = [
  '.codex/skills',
  '.agents/skills',
  'Repo skills',
  'System skills',
  'Admin skills',
  'Other skills',
]

export const CodexSkillsPane: React.FC = () => {
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const { data: skills = [], isLoading } =
    useCodexSkillInventory(activeWorktreePath)
  const setCodexSkillEnabled = useSetCodexSkillEnabled()

  const groupedSkills = useMemo(() => {
    const groups = new Map<string, ClaudeSkill[]>()

    for (const skill of skills) {
      const key = getSkillSourceLabel(skill)
      const current = groups.get(key) ?? []
      current.push(skill)
      groups.set(key, current)
    }

    return SOURCE_ORDER.map(source => ({
      source,
      skills: (groups.get(source) ?? []).sort(
        (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
      ),
    })).filter(group => group.skills.length > 0)
  }, [skills])

  const handleToggle = (skill: ClaudeSkill, enabled: boolean) => {
    setCodexSkillEnabled.mutate({
      path: skill.path,
      enabled,
    })
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Codex skills">
        <p className="text-sm text-muted-foreground">
          Enable or disable Codex skills from the app-server source of truth.
          {` ${getSkillSourceDescription(activeWorktreePath ?? undefined)}`}
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading skills...
          </div>
        ) : groupedSkills.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">
            No Codex skills found.
          </div>
        ) : (
          <div className="space-y-4">
            {groupedSkills.map(group => (
              <div key={group.source} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {group.source}
                  </span>
                  <Separator className="flex-1" />
                </div>
                {group.skills.map(skill => {
                  const isPending =
                    setCodexSkillEnabled.isPending &&
                    setCodexSkillEnabled.variables?.path === skill.path

                  return (
                    <div
                      key={skill.path}
                      className={cn(
                        'flex items-start gap-3 rounded-md border px-4 py-3',
                        isPending && 'opacity-70'
                      )}
                    >
                      <Switch
                        checked={skill.enabled !== false}
                        onCheckedChange={checked =>
                          handleToggle(skill, checked)
                        }
                        disabled={isPending}
                        aria-label={`Toggle ${skill.name}`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm font-medium text-foreground">
                            {skill.name}
                          </Label>
                          {skill.scope && (
                            <span className="text-xs text-muted-foreground">
                              {skill.scope}
                            </span>
                          )}
                        </div>
                        {skill.description && (
                          <p className="text-sm text-muted-foreground">
                            {skill.description}
                          </p>
                        )}
                        <p className="truncate text-xs text-muted-foreground">
                          {skill.path}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
