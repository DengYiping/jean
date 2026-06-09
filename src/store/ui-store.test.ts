import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './ui-store'

describe('UIStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useUIStore.setState({
      leftSidebarVisible: false,
      rightSidebarVisible: false,
      commandPaletteOpen: false,
      preferencesOpen: false,
      chatSearchOpen: false,
      sessionPrimarySurface: {},
      sessionTerminalIds: {},
      newSessionModeTarget: null,
    })
  })

  it('has correct initial state', () => {
    const state = useUIStore.getState()
    expect(state.leftSidebarVisible).toBe(false)
    expect(state.rightSidebarVisible).toBe(false)
    expect(state.commandPaletteOpen).toBe(false)
    expect(state.preferencesOpen).toBe(false)
    expect(state.chatSearchOpen).toBe(false)
  })

  it('toggles left sidebar visibility', () => {
    const { toggleLeftSidebar } = useUIStore.getState()

    toggleLeftSidebar()
    expect(useUIStore.getState().leftSidebarVisible).toBe(true)

    toggleLeftSidebar()
    expect(useUIStore.getState().leftSidebarVisible).toBe(false)
  })

  it('sets left sidebar visibility directly', () => {
    const { setLeftSidebarVisible } = useUIStore.getState()

    setLeftSidebarVisible(false)
    expect(useUIStore.getState().leftSidebarVisible).toBe(false)

    setLeftSidebarVisible(true)
    expect(useUIStore.getState().leftSidebarVisible).toBe(true)
  })

  it('toggles preferences dialog', () => {
    const { togglePreferences } = useUIStore.getState()

    togglePreferences()
    expect(useUIStore.getState().preferencesOpen).toBe(true)

    togglePreferences()
    expect(useUIStore.getState().preferencesOpen).toBe(false)
  })

  it('toggles command palette', () => {
    const { toggleCommandPalette } = useUIStore.getState()

    toggleCommandPalette()
    expect(useUIStore.getState().commandPaletteOpen).toBe(true)

    toggleCommandPalette()
    expect(useUIStore.getState().commandPaletteOpen).toBe(false)
  })

  it('opens and closes chat search', () => {
    const { setChatSearchOpen } = useUIStore.getState()

    setChatSearchOpen(true)
    expect(useUIStore.getState().chatSearchOpen).toBe(true)

    setChatSearchOpen(false)
    expect(useUIStore.getState().chatSearchOpen).toBe(false)
  })

  it('tracks and clears terminal-first session surface state', () => {
    const {
      setSessionPrimarySurface,
      setSessionTerminalId,
      clearSessionTerminalSurface,
    } = useUIStore.getState()

    setSessionPrimarySurface('session-1', 'terminal')
    setSessionTerminalId('session-1', 'terminal-1')

    expect(useUIStore.getState().sessionPrimarySurface['session-1']).toBe(
      'terminal'
    )
    expect(useUIStore.getState().sessionTerminalIds['session-1']).toBe(
      'terminal-1'
    )
    expect(clearSessionTerminalSurface('session-1')).toBe('terminal-1')
    expect(useUIStore.getState().sessionPrimarySurface['session-1']).toBe(
      undefined
    )
    expect(useUIStore.getState().sessionTerminalIds['session-1']).toBe(
      undefined
    )
  })

  it('opens and closes the new session mode target', () => {
    const { openNewSessionModeModal, closeNewSessionModeModal } =
      useUIStore.getState()

    openNewSessionModeModal({
      worktreeId: 'worktree-1',
      worktreePath: '/repo/worktree',
      origin: 'canvas',
    })

    expect(useUIStore.getState().newSessionModeTarget).toEqual({
      worktreeId: 'worktree-1',
      worktreePath: '/repo/worktree',
      origin: 'canvas',
    })

    closeNewSessionModeModal()
    expect(useUIStore.getState().newSessionModeTarget).toBeNull()
  })
})
