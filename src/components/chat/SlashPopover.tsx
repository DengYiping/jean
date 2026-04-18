import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Terminal, Wand2 } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { useSkills, useClaudeCommands } from '@/services/skills'
import type {
  Backend,
  ClaudeSkill,
  ClaudeCommand,
  PendingSkill,
} from '@/types/chat'
import { cn } from '@/lib/utils'
import { generateId } from '@/lib/uuid'
import { fuzzySearchItems } from '@/lib/fuzzy-search'
import { getBackendLabel } from '@/components/ui/backend-label'

export interface SlashPopoverHandle {
  moveUp: () => void
  moveDown: () => void
  selectCurrent: () => void
}

export type SlashPopoverMode = 'command' | 'skill'

interface SlashPopoverProps {
  open: boolean
  /** Which item set is currently active */
  mode: SlashPopoverMode
  /** Callback when popover should close */
  onOpenChange: (open: boolean) => void
  onSelectSkill: (skill: PendingSkill) => void
  onSelectCommand: (command: ClaudeCommand) => void
  /** Current search query (text after the active trigger) */
  searchQuery: string
  anchorPosition: { top: number; left: number } | null
  containerRef?: React.RefObject<HTMLElement | null>
  /** Active backend for this session */
  backend: Backend
  /** Active worktree path for repo-local Codex skills */
  worktreePath?: string | null
  handleRef?: React.RefObject<SlashPopoverHandle | null>
  installedBackends?: CliBackend[]
}

type ListItem =
  | {
      type: 'command'
      backend: CliBackend
      data: ClaudeCommand
      pluginName?: string
    }
  | {
      type: 'skill'
      backend: CliBackend
      data: ClaudeSkill
      pluginName?: string
    }

interface RenderGroup {
  key: string
  heading: string
  items: { item: ListItem; globalIndex: number }[]
}

export function SlashPopover({
  open,
  mode,
  onOpenChange,
  onSelectSkill,
  onSelectCommand,
  searchQuery,
  anchorPosition,
  containerRef,
  backend,
  worktreePath,
  handleRef,
  installedBackends,
}: SlashPopoverProps) {
  const { data: skills = [] } = useSkills(backend, worktreePath)
  const { data: commands = [] } = useClaudeCommands(worktreePath)
  const listRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filteredItems = useMemo(() => {
    const items: ListItem[] = []

    if (mode === 'command' && backend === 'claude') {
      fuzzySearchItems(commands, searchQuery, 10).forEach(cmd => {
        items.push({ type: 'command', data: cmd })
      })
    }

    if (mode === 'skill') {
      fuzzySearchItems(skills, searchQuery, 10).forEach(skill => {
        items.push({ type: 'skill', data: skill })
      })
    }

    return items.slice(0, 15) // Limit total to 15
  }, [backend, commands, mode, searchQuery, skills])

  const clampedSelectedIndex = Math.min(
    selectedIndex,
    Math.max(0, filteredItems.length - 1)
  )

  const handleSelectSkill = useCallback(
    (skill: ClaudeSkill) => {
      const pendingSkill: PendingSkill = {
        id: generateId(),
        name: skill.name,
        path: skill.path,
      }
      onSelectSkill(pendingSkill)
      onOpenChange(false)
    },
    [onSelectSkill, onOpenChange]
  )

  const handleSelectCommand = useCallback(
    (command: ClaudeCommand) => {
      onSelectCommand(command)
      onOpenChange(false)
    },
    [onSelectCommand, onOpenChange]
  )

  const selectHighlighted = useCallback(() => {
    const item = filteredItems[clampedSelectedIndex]
    if (!item) return

    if (item.type === 'command') {
      handleSelectCommand(item.data)
    } else {
      handleSelectSkill(item.data)
    }
  }, [
    filteredItems,
    clampedSelectedIndex,
    handleSelectCommand,
    handleSelectSkill,
  ])

  useImperativeHandle(handleRef, () => {
    return {
      moveUp: () => {
        setSelectedIndex(i => Math.max(i - 1, 0))
      },
      moveDown: () => {
        setSelectedIndex(i => Math.min(i + 1, filteredItems.length - 1))
      },
      selectCurrent: () => {
        selectHighlighted()
      },
    }
  }, [filteredItems.length, selectHighlighted])

  useEffect(() => {
    const list = listRef.current
    if (!list) return

    const selectedItem = list.querySelector(
      `[data-index="${clampedSelectedIndex}"]`
    )
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [clampedSelectedIndex])

  const anchorRef = useRef<HTMLDivElement>(null)
  const [stableAnchorTop, setStableAnchorTop] = useState(0)

  useEffect(() => {
    if (
      !open ||
      !anchorPosition ||
      !containerRef?.current ||
      !anchorRef.current
    ) {
      return
    }
    const formRect = containerRef.current.getBoundingClientRect()
    const wrapperRect = anchorRef.current.parentElement?.getBoundingClientRect()
    if (wrapperRect) {
      setStableAnchorTop(formRect.top - wrapperRect.top)
    }
  }, [open, anchorPosition, containerRef])

  if (!open || !anchorPosition) return null

  const resolvedTop = containerRef ? stableAnchorTop : anchorPosition.top

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor
        ref={anchorRef}
        style={{
          position: 'absolute',
          top: resolvedTop,
          left: anchorPosition.left,
          pointerEvents: 'none',
        }}
      />
      <PopoverContent
        className="w-80 p-0"
        align="start"
        side="top"
        sideOffset={12}
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList ref={listRef} className="max-h-[250px]">
            {filteredItems.length === 0 ? (
              <CommandEmpty>
                {mode === 'command' ? 'No commands found' : 'No skills found'}
              </CommandEmpty>
            ) : (
              <>
                {renderGroups.map(group => (
                  <CommandGroup key={group.key} heading={group.heading}>
                    {group.items.map(({ item, globalIndex }) => {
                      const isSelected = globalIndex === clampedSelectedIndex
                      const isCommand = item.type === 'command'
                      return (
                        <CommandItem
                          key={`${item.type}-${item.backend}-${item.data.name}`}
                          data-index={globalIndex}
                          value={`${item.type}-${item.backend}-${item.data.name}`}
                          onSelect={() =>
                            isCommand
                              ? handleSelectCommand(item.data as ClaudeCommand)
                              : handleSelectSkill(item.data)
                          }
                          className={cn(
                            'flex items-center gap-2 cursor-pointer',
                            'data-[selected=true]:bg-transparent data-[selected=true]:text-foreground',
                            isSelected && '!bg-accent !text-accent-foreground'
                          )}
                        >
                          {isCommand ? (
                            <Terminal className="h-4 w-4 shrink-0 text-blue-500" />
                          ) : (
                            <Wand2 className="h-4 w-4 shrink-0 text-purple-500" />
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm font-medium">
                              /{item.data.name}
                            </span>
                            {item.data.description && (
                              <span className="truncate text-xs text-muted-foreground">
                                {item.data.description}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                )}
                {skillItems.length > 0 && (
                  <CommandGroup heading="Skills">
                    {skillItems.map((item, localIndex) => {
                      // Skills come after commands, so globalIndex = commandItems.length + localIndex
                      const globalIndex = commandItems.length + localIndex
                      const isSelected = globalIndex === clampedSelectedIndex
                      return (
                        <CommandItem
                          key={`skill-${item.data.path}`}
                          data-index={globalIndex}
                          value={`skill-${item.data.path}`}
                          onSelect={() => handleSelectSkill(item.data)}
                          className={cn(
                            'flex items-center gap-2 cursor-pointer',
                            // Override cmdk's internal selection styling - we manage selection ourselves
                            'data-[selected=true]:bg-transparent data-[selected=true]:text-foreground',
                            isSelected && '!bg-accent !text-accent-foreground'
                          )}
                        >
                          <Wand2 className="h-4 w-4 shrink-0 text-purple-500" />
                          <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm font-medium">
                              ${item.data.name}
                            </span>
                            {item.data.description && (
                              <span className="truncate text-xs text-muted-foreground">
                                {item.data.description}
                              </span>
                            )}
                          </div>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
