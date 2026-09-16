import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

/** Shared measured viewport window for both chat layouts. Stable keys preserve prepend anchors. */
export function useMessageVirtualizer(
  keys: string[],
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
) {
  const listRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  // The viewport belongs to our parent; its ref attaches after child layout effects.
  useEffect(() => {
    setViewport(scrollContainerRef.current)
  }, [scrollContainerRef])
  const hasItems = keys.length > 0
  const [scrollMargin, setScrollMargin] = useState(0)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !viewport) return
    const update = () => {
      const margin =
        list.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop
      setScrollMargin(previous => (previous === margin ? previous : margin))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    if (list.parentElement) observer.observe(list.parentElement)
    // Sibling banners can change the list's position without resizing the viewport.
    if (list.parentElement?.parentElement)
      observer.observe(list.parentElement.parentElement)
    return () => observer.disconnect()
  }, [viewport, hasItems])
  const getItemKey = useCallback(
    (index: number) => keys[index] ?? index,
    [keys]
  )
  // TanStack Virtual uses mutable measurements; this hook must not be compiler-memoized.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: keys.length,
    getScrollElement: () => viewport,
    getItemKey,
    estimateSize: () => 240,
    overscan: 3,
    scrollMargin,
    anchorTo: 'end',
    followOnAppend: false, // useScrollManagement owns whether the user follows the tail.
  })
  const items = virtualizer.getVirtualItems()
  return { listRef, virtualizer, items, scrollMargin }
}
