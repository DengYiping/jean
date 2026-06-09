import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useUIStore } from '@/store/ui-store'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

interface ChatSearchBarProps {
  scrollContainerRef: RefObject<HTMLElement | null>
}

interface MatchInfo {
  node: Text
  index: number
  length: number
}

function rangeFromMatch(match: MatchInfo): Range | null {
  try {
    const range = new Range()
    range.setStart(match.node, match.index)
    range.setEnd(match.node, match.index + match.length)
    return range
  } catch {
    return null
  }
}

function scrollRangeIntoView(range: Range) {
  const element =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement

  element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function ChatSearchBar({ scrollContainerRef }: ChatSearchBarProps) {
  const chatSearchOpen = useUIStore(state => state.chatSearchOpen)
  const setChatSearchOpen = useUIStore(state => state.setChatSearchOpen)

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<MatchInfo[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supportsHighlightAPI = typeof CSS !== 'undefined' && 'highlights' in CSS

  const clearHighlights = useCallback(() => {
    if (!supportsHighlightAPI) return
    CSS.highlights.delete('chat-search')
    CSS.highlights.delete('chat-search-active')
  }, [supportsHighlightAPI])

  const highlightActiveMatch = useCallback(
    (index: number, allMatches: MatchInfo[]) => {
      const match = allMatches[index]
      if (!match) return

      const range = rangeFromMatch(match)
      if (!range) return

      if (supportsHighlightAPI) {
        CSS.highlights.set('chat-search-active', new Highlight(range))
      }
      scrollRangeIntoView(range)
    },
    [supportsHighlightAPI]
  )

  const performSearch = useCallback(
    (searchQuery: string) => {
      clearHighlights()

      if (!searchQuery || !scrollContainerRef.current) {
        setMatches([])
        setActiveIndex(0)
        return
      }

      const lowerQuery = searchQuery.toLowerCase()
      const found: MatchInfo[] = []
      const walker = document.createTreeWalker(
        scrollContainerRef.current,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (node.parentElement?.closest('[data-chat-search-bar]')) {
              return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
          },
        }
      )

      let textNode: Text | null
      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent?.toLowerCase() ?? ''
        let startPosition = 0
        let index: number
        while ((index = text.indexOf(lowerQuery, startPosition)) !== -1) {
          found.push({
            node: textNode,
            index,
            length: searchQuery.length,
          })
          startPosition = index + 1
        }
      }

      setMatches(found)
      setActiveIndex(0)

      if (found.length === 0) return

      if (supportsHighlightAPI) {
        const ranges = found
          .map(rangeFromMatch)
          .filter((range): range is Range => range !== null)

        if (ranges.length > 0) {
          CSS.highlights.set('chat-search', new Highlight(...ranges))
        }
      }
      highlightActiveMatch(0, found)
    },
    [
      clearHighlights,
      highlightActiveMatch,
      scrollContainerRef,
      supportsHighlightAPI,
    ]
  )

  const navigateToMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return
      const wrappedIndex =
        ((index % matches.length) + matches.length) % matches.length
      setActiveIndex(wrappedIndex)
      highlightActiveMatch(wrappedIndex, matches)
    },
    [highlightActiveMatch, matches]
  )

  const close = useCallback(() => {
    clearHighlights()
    setQuery('')
    setMatches([])
    setActiveIndex(0)
    setChatSearchOpen(false)
  }, [clearHighlights, setChatSearchOpen])

  useEffect(() => {
    if (!chatSearchOpen) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      performSearch(query)
    }, 150)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [chatSearchOpen, performSearch, query])

  useEffect(() => {
    if (!chatSearchOpen || !query || !scrollContainerRef.current) return

    const observer = new MutationObserver(() => {
      performSearch(query)
    })
    observer.observe(scrollContainerRef.current, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => observer.disconnect()
  }, [chatSearchOpen, performSearch, query, scrollContainerRef])

  useEffect(() => {
    if (chatSearchOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [chatSearchOpen])

  useEffect(() => {
    const handler = () => {
      if (!chatSearchOpen) return
      if (document.activeElement === inputRef.current) {
        close()
      } else {
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('chat-search-toggle', handler)
    return () => window.removeEventListener('chat-search-toggle', handler)
  }, [chatSearchOpen, close])

  useEffect(() => {
    return () => {
      clearHighlights()
    }
  }, [clearHighlights])

  if (!chatSearchOpen) return null

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      navigateToMatch(activeIndex - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      navigateToMatch(activeIndex + 1)
    }
  }

  return (
    <div
      data-chat-search-bar
      className="absolute top-2 right-4 z-30 flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 shadow-md"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in chat..."
        className="w-40 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-xs"
      />
      {query && (
        <span
          className="text-xs text-muted-foreground whitespace-nowrap"
          aria-live="polite"
        >
          {matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : '0/0'}
        </span>
      )}
      <button
        type="button"
        onClick={() => navigateToMatch(activeIndex - 1)}
        disabled={matches.length === 0}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        aria-label="Previous match"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => navigateToMatch(activeIndex + 1)}
        disabled={matches.length === 0}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        aria-label="Next match"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={close}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Close search"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
