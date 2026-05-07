import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SlashPopover } from './SlashPopover'

const { mockUseSkills, mockUseClaudeCommands } = vi.hoisted(() => ({
  mockUseSkills: vi.fn(() => ({ data: [] })),
  mockUseClaudeCommands: vi.fn(() => ({ data: [] })),
}))

vi.mock('@/services/skills', () => ({
  useSkills: mockUseSkills,
  useClaudeCommands: mockUseClaudeCommands,
}))

describe('SlashPopover', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {
        return undefined
      }
      unobserve() {
        return undefined
      }
      disconnect() {
        return undefined
      }
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('scrollIntoView', vi.fn())
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('shows builtin /compact and /goal for Codex sessions', () => {
    render(
      <SlashPopover
        open
        mode="command"
        onOpenChange={vi.fn()}
        onSelectSkill={vi.fn()}
        onSelectCommand={vi.fn()}
        searchQuery=""
        anchorPosition={{ top: 0, left: 0 }}
        containerRef={createRef<HTMLDivElement>()}
        backend="codex"
        worktreePath="/tmp/worktree-1"
      />
    )

    expect(screen.getByText('/compact')).toBeInTheDocument()
    expect(
      screen.getByText('Summarize history and free up context')
    ).toBeInTheDocument()
    expect(screen.getByText('/goal')).toBeInTheDocument()
    expect(
      screen.getByText('Set, view, or clear the current Codex goal')
    ).toBeInTheDocument()
  })
})
