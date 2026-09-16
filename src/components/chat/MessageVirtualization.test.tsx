import { createRef, useRef, type ComponentProps } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VirtualizedMessageList,
  type VirtualizedMessageListHandle,
} from './VirtualizedMessageList'
import { CompactMessageList } from './CompactMessageList'
import type { ChatMessage } from '@/types/chat'

vi.mock('./MessageItem', () => ({
  MessageItem: ({ message }: { message: ChatMessage }) => (
    <div data-testid="message">{message.content}</div>
  ),
}))
const messages: ChatMessage[] = Array.from({ length: 200 }, (_, index) => ({
  id: `message-${index}`,
  session_id: 'session',
  role: 'user',
  content: `Prompt ${index}`,
  timestamp: index,
  tool_calls: [],
}))
const callbacks = {
  onPlanApproval: vi.fn(),
  onQuestionAnswer: vi.fn(),
  onQuestionSkip: vi.fn(),
  onFileClick: vi.fn(),
  onFixFinding: vi.fn(),
  onFixAllFindings: vi.fn(),
  isQuestionAnswered: () => false,
  getSubmittedAnswers: () => undefined,
  areQuestionsSkipped: () => false,
  isFindingFixed: () => false,
}
const listRef = createRef<VirtualizedMessageListHandle>()
function Host({
  compact,
  data = messages,
}: {
  compact: boolean
  data?: ChatMessage[]
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const Component = compact ? CompactMessageList : VirtualizedMessageList
  const props: ComponentProps<typeof VirtualizedMessageList> = {
    ...callbacks,
    messages: data,
    scrollContainerRef: viewport,
    totalMessages: data.length,
    sessionId: 'session',
    worktreePath: '/tmp',
    approveShortcut: '',
    isSending: false,
  }
  return (
    <div ref={viewport} data-testid="viewport">
      <Component ref={listRef} {...props} />
    </div>
  )
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* no browser layout in jsdom */
      }
      unobserve() {
        /* no browser layout in jsdom */
      }
      disconnect() {
        /* no browser layout in jsdom */
      }
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.testid === 'viewport' ? 600 : 240
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(48000)
  Element.prototype.scrollTo = vi.fn(function (
    this: Element,
    options?: ScrollToOptions | number
  ) {
    if (typeof options === 'object') this.scrollTop = options.top ?? 0
    this.dispatchEvent(new Event('scroll'))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
for (const compact of [false, true])
  describe(compact ? 'compact viewport' : 'standard viewport', () => {
    it('keeps mounted rows bounded when scrolling in both directions', () => {
      render(<Host compact={compact} />)
      const viewport = screen.getByTestId('viewport')
      expect(screen.getAllByTestId('message').length).toBeLessThan(15)
      expect(screen.getByText('Prompt 0')).toBeInTheDocument()
      act(() => {
        viewport.scrollTop = 24000
        fireEvent.scroll(viewport)
      })
      expect(screen.queryByText('Prompt 0')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('message').length).toBeLessThan(15)
      act(() => {
        viewport.scrollTop = 0
        fireEvent.scroll(viewport)
      })
      expect(screen.getByText('Prompt 0')).toBeInTheDocument()
      expect(screen.getAllByTestId('message').length).toBeLessThan(15)
    })
    it('navigates to an unmounted message without mounting intervening history', () => {
      render(<Host compact={compact} />)
      act(() => listRef.current?.scrollToIndex(150))
      expect(screen.getByText('Prompt 150')).toBeInTheDocument()
      expect(screen.getAllByTestId('message').length).toBeLessThan(15)
    })
    it('preserves the visible message when a page is prepended', () => {
      const view = render(<Host compact={compact} data={messages.slice(20)} />)
      const viewport = screen.getByTestId('viewport')
      act(() => {
        viewport.scrollTop = 2400
        fireEvent.scroll(viewport)
      })
      view.rerender(<Host compact={compact} data={messages} />)
      expect(screen.getByText('Prompt 30')).toBeInTheDocument()
      expect(screen.getAllByTestId('message').length).toBeLessThan(15)
    })
  })
