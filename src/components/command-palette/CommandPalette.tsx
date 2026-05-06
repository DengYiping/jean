import { useEffect, useState, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/store/ui-store'
import { useCommandContext } from '@/hooks/use-command-context'
import { usePreferences } from '@/services/preferences'
import {
  useProjects,
  useAppDataDir,
  useWorktrees,
  projectsQueryKeys,
} from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { convertFileSrc, invoke } from '@/lib/transport'
import { getAllCommands, executeCommand } from '@/lib/commands'
import { formatShortcutDisplay } from '@/types/keybindings'
import type { Project, Worktree } from '@/types/projects'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'

interface ProjectCommand {
  id: string
  label: string
  description?: string
  avatarUrl: string | null
  avatarFallback: string
  group: string
  keywords: string[]
  execute: () => void | Promise<void>
}

interface WorktreeCommand {
  id: string
  label: string
  description?: string
  projectId: string
  worktree: Worktree
  keywords: string[]
  execute: () => void
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore()
  const { data: preferences } = usePreferences()
  const commandContext = useCommandContext(preferences)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [focusedProjectId, setFocusedProjectId] = useState<string | null>(null)

  // Fetch projects for dynamic commands
  const { data: projects = [] } = useProjects()
  const { data: appDataDir } = useAppDataDir()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const activeProjectId = focusedProjectId ?? selectedProjectId
  const { data: activeProjectWorktrees = [] } = useWorktrees(activeProjectId)

  // Get project access timestamps for recency sorting
  const projectAccessTimestamps = useProjectsStore(
    state => state.projectAccessTimestamps
  )

  const focusedProject = useMemo(
    () => projects.find(project => project.id === focusedProjectId) ?? null,
    [focusedProjectId, projects]
  )

  const openProjectCanvas = useCallback(
    (projectId: string) => {
      useChatStore.getState().clearActiveWorktree()
      useProjectsStore.getState().selectProject(projectId)
      setCommandPaletteOpen(false)
      setSearch('')
      setFocusedProjectId(null)
    },
    [setCommandPaletteOpen]
  )

  const openWorktree = useCallback(
    (projectId: string, worktree: Worktree) => {
      const projectsStore = useProjectsStore.getState()
      const chatStore = useChatStore.getState()

      projectsStore.selectProject(projectId)
      projectsStore.selectWorktree(worktree.id)
      chatStore.clearActiveWorktree()
      chatStore.registerWorktreePath(worktree.id, worktree.path)

      setCommandPaletteOpen(false)
      setSearch('')
      setFocusedProjectId(null)

      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('open-session-modal', {
            detail: {
              projectId,
              sessionId: '',
              worktreeId: worktree.id,
              worktreePath: worktree.path,
            },
          })
        )
      }, 50)
    },
    [setCommandPaletteOpen]
  )

  const getReadyWorktreesForProject = useCallback(
    async (projectId: string): Promise<Worktree[]> => {
      try {
        const worktrees = await queryClient.fetchQuery({
          queryKey: projectsQueryKeys.worktrees(projectId),
          queryFn: () =>
            invoke<Worktree[]>('list_worktrees', {
              projectId,
            }),
          staleTime: 1000 * 60,
        })
        return worktrees.filter(isOpenableWorktree)
      } catch {
        return []
      }
    },
    [queryClient]
  )

  const focusProjectWorktrees = useCallback((project: Project) => {
    useChatStore.getState().clearActiveWorktree()
    useProjectsStore.getState().selectProject(project.id)
    setFocusedProjectId(project.id)
    setSearch('')
  }, [])

  // Create dynamic project commands (sorted by last-accessed, most recent first)
  // Current project is excluded so the previous project is first (quick CMD+K → Enter switching)
  const projectCommands = useMemo((): ProjectCommand[] => {
    return projects
      .filter(p => !p.is_folder && p.id !== selectedProjectId)
      .sort((a, b) => {
        const aTime = projectAccessTimestamps[a.id] ?? 0
        const bTime = projectAccessTimestamps[b.id] ?? 0
        return bTime - aTime
      })
      .map(project => ({
        id: `goto-project-${project.id}`,
        label: project.name,
        description: 'Switch project',
        avatarUrl:
          project.avatar_path && appDataDir
            ? convertFileSrc(`${appDataDir}/${project.avatar_path}`)
            : null,
        avatarFallback: project.name[0]?.toUpperCase() ?? '?',
        group: 'projects',
        keywords: ['project', 'switch', 'open', project.name.toLowerCase()],
        execute: async () => {
          const readyWorktrees = await getReadyWorktreesForProject(project.id)
          const onlyWorktree = readyWorktrees[0]
          if (readyWorktrees.length === 1 && onlyWorktree) {
            openWorktree(project.id, onlyWorktree)
            return
          }
          if (readyWorktrees.length > 1) {
            focusProjectWorktrees(project)
            return
          }
          openProjectCanvas(project.id)
        },
      }))
  }, [
    projects,
    appDataDir,
    projectAccessTimestamps,
    selectedProjectId,
    getReadyWorktreesForProject,
    openWorktree,
    focusProjectWorktrees,
    openProjectCanvas,
  ])

  const worktreeCommands = useMemo((): WorktreeCommand[] => {
    if (!activeProjectId) return []

    return activeProjectWorktrees
      .filter(isOpenableWorktree)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order
        return b.created_at - a.created_at
      })
      .map(worktree => ({
        id: `open-worktree-${worktree.id}`,
        label: worktree.name,
        description:
          worktree.branch && worktree.branch !== worktree.name
            ? worktree.branch
            : 'Open worktree',
        projectId: activeProjectId,
        worktree,
        keywords: [
          'worktree',
          'open',
          worktree.name.toLowerCase(),
          worktree.branch.toLowerCase(),
        ],
        execute: () => openWorktree(activeProjectId, worktree),
      }))
  }, [activeProjectId, activeProjectWorktrees, openWorktree])

  // Get all available commands (memoized to prevent re-filtering on every render)
  const commandGroups = useMemo(() => {
    const searchLower = search.toLowerCase().trim()
    const filteredWorktreeCommands = searchLower
      ? worktreeCommands.filter(
          cmd =>
            cmd.label.toLowerCase().includes(searchLower) ||
            cmd.description?.toLowerCase().includes(searchLower) ||
            cmd.keywords.some(kw => kw.includes(searchLower))
        )
      : worktreeCommands

    if (focusedProjectId) {
      return {
        staticGroups: {},
        projectCommands: [],
        worktreeCommands: filteredWorktreeCommands,
      }
    }

    const staticCommands = getAllCommands(commandContext, search)

    // Filter project commands by search
    const filteredProjectCommands = searchLower
      ? projectCommands.filter(
          cmd =>
            cmd.label.toLowerCase().includes(searchLower) ||
            cmd.description?.toLowerCase().includes(searchLower) ||
            cmd.keywords.some(kw => kw.includes(searchLower))
        )
      : projectCommands

    // Group static commands
    const staticGroups = staticCommands.reduce(
      (acc, command) => {
        const group = command.group || 'other'
        if (!acc[group]) acc[group] = []
        acc[group].push(command)
        return acc
      },
      {} as Record<string, typeof staticCommands>
    )

    return {
      staticGroups,
      projectCommands: filteredProjectCommands,
      worktreeCommands: filteredWorktreeCommands,
    }
  }, [
    commandContext,
    search,
    projectCommands,
    worktreeCommands,
    focusedProjectId,
  ])

  // Handle command execution
  const handleCommandSelect = useCallback(
    async (commandId: string) => {
      // Check for dynamic project command first
      const projectCmd = projectCommands.find(c => c.id === commandId)
      if (projectCmd) {
        await projectCmd.execute()
        return
      }

      const worktreeCmd = worktreeCommands.find(c => c.id === commandId)
      if (worktreeCmd) {
        worktreeCmd.execute()
        return
      }

      setCommandPaletteOpen(false)
      setSearch('') // Clear search when closing
      setFocusedProjectId(null)

      const result = await executeCommand(commandId, commandContext)

      if (!result.success && result.error) {
        commandContext.showToast(result.error, 'error')
      }
    },
    [commandContext, setCommandPaletteOpen, projectCommands, worktreeCommands]
  )

  // Handle dialog open/close with search clearing
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setCommandPaletteOpen(open)
      if (!open) {
        setSearch('') // Clear search when closing
        setFocusedProjectId(null)
      }
    },
    [setCommandPaletteOpen]
  )

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, setCommandPaletteOpen])

  return (
    <CommandDialog
      open={commandPaletteOpen}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Type a command or search..."
      className="top-4 translate-y-0 sm:top-[50%] sm:translate-y-[-50%] sm:max-w-2xl"
      disablePointerSelection
    >
      <CommandInput
        placeholder={
          focusedProject
            ? `Search worktrees in ${focusedProject.name}...`
            : 'Type a command or search...'
        }
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {commandGroups.worktreeCommands.length > 0 && (
          <CommandGroup
            heading={focusedProject ? 'Worktrees' : 'Current Project'}
          >
            {commandGroups.worktreeCommands.map(cmd => (
              <CommandItem
                key={cmd.id}
                value={`${cmd.label} ${cmd.description ?? ''} ${cmd.keywords.join(' ')}`}
                onSelect={() => handleCommandSelect(cmd.id)}
              >
                <div className="mr-2 flex size-4 shrink-0 items-center justify-center rounded bg-muted-foreground/20">
                  <span className="text-[10px] font-medium uppercase">
                    {cmd.label[0]?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <span>{cmd.label}</span>
                {cmd.description && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {cmd.description}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {focusedProject && (
          <CommandGroup heading={focusedProject.name}>
            <CommandItem
              value="back projects commands"
              onSelect={() => {
                setFocusedProjectId(null)
                setSearch('')
              }}
            >
              <span className="text-muted-foreground">Back to projects</span>
            </CommandItem>
          </CommandGroup>
        )}

        {/* Projects group first (near top) */}
        {!focusedProject && commandGroups.projectCommands.length > 0 && (
          <CommandGroup heading="Projects">
            {commandGroups.projectCommands.map(cmd => (
              <CommandItem
                key={cmd.id}
                value={`${cmd.label} ${cmd.description ?? ''}`}
                onSelect={() => handleCommandSelect(cmd.id)}
              >
                {cmd.avatarUrl ? (
                  <img
                    src={cmd.avatarUrl}
                    alt={cmd.label}
                    className="mr-2 size-4 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="mr-2 flex size-4 shrink-0 items-center justify-center rounded bg-muted-foreground/20">
                    <span className="text-[10px] font-medium uppercase">
                      {cmd.avatarFallback}
                    </span>
                  </div>
                )}
                <span>{cmd.label}</span>
                {cmd.description && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {cmd.description}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Static command groups */}
        {!focusedProject &&
          Object.entries(commandGroups.staticGroups).map(
            ([groupName, groupCommands]) => (
              <CommandGroup key={groupName} heading={getGroupLabel(groupName)}>
                {groupCommands.map(command => (
                  <CommandItem
                    key={command.id}
                    value={`${command.id} ${command.label} ${command.description ?? ''} ${command.keywords?.join(' ') ?? ''}`}
                    onSelect={() => handleCommandSelect(command.id)}
                  >
                    {command.icon && <command.icon className="mr-2 h-4 w-4" />}
                    <span>{command.label}</span>
                    {command.description && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {command.description}
                      </span>
                    )}
                    {command.shortcut && (
                      <CommandShortcut>
                        {formatShortcutDisplay(command.shortcut)}
                      </CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          )}
      </CommandList>
    </CommandDialog>
  )
}

function isOpenableWorktree(worktree: Worktree): boolean {
  return (
    !worktree.status ||
    worktree.status === 'ready' ||
    worktree.status === 'error'
  )
}

// Helper function to get readable group labels
function getGroupLabel(groupName: string): string {
  switch (groupName) {
    case 'navigation':
      return 'Navigation'
    case 'settings':
      return 'Settings'
    case 'window':
      return 'Window'
    case 'notification':
      return 'Notifications'
    case 'github':
      return 'GitHub'
    case 'sessions':
      return 'Sessions'
    case 'other':
      return 'Other'
    default:
      return groupName.charAt(0).toUpperCase() + groupName.slice(1)
  }
}

export default CommandPalette
