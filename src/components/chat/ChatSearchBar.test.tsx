import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSearchBar } from './ChatSearchBar'
import { useUIStore } from '@/store/ui-store'

function TestHost() {
  return (
    <div>
      <div ref={scrollContainerRef}>
        <p>Alpha beta gamma.</p>
        <p>Another beta result.</p>
      </div>
      <ChatSearchBar scrollContainerRef={scrollContainerRef} />
    </div>
  )
}

const scrollContainerRef = { current: null as HTMLDivElement | null }

describe('ChatSearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUIStore.setState({ chatSearchOpen: true })
    Element.prototype.scrollIntoView = vi.fn()
    window.requestAnimationFrame = vi.fn(callback => {
      callback(0)
      return 0
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    useUIStore.setState({ chatSearchOpen: false })
  })

  it('searches visible chat text and navigates matches', async () => {
    render(<TestHost />)

    const input = screen.getByPlaceholderText('Find in chat...')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'beta' } })
    })

    await act(async () => {
      vi.advanceTimersByTime(150)
    })

    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    })
    expect(screen.getByText('2/2')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    })
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    render(<TestHost />)

    const input = screen.getByPlaceholderText('Find in chat...')
    input.focus()
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' })
    })

    expect(useUIStore.getState().chatSearchOpen).toBe(false)
  })

  it('toggles closed when already focused', async () => {
    render(<TestHost />)

    screen.getByPlaceholderText('Find in chat...').focus()
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chat-search-toggle'))
    })

    expect(useUIStore.getState().chatSearchOpen).toBe(false)
  })
})
