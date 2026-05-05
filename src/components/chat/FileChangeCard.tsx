import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RefObject } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ToolCall } from '@/types/chat'
import { cn } from '@/lib/utils'
import {
  collectFileChanges,
  formatWorktreeRelativePath,
  getFileChangeTotals,
  type ParsedFileChange,
} from './file-change-utils'

interface FileChangeCardProps {
  toolCalls: ToolCall[] | undefined
  className?: string
  viewportRef?: RefObject<HTMLDivElement | null>
  worktreePath?: string | null
}

const COLLAPSE_THRESHOLD = 5
const SHOW_MORE_THRESHOLD = 15
const INITIAL_VISIBLE = 10

function getKindColor(kind: string): string {
  switch (kind) {
    case 'add':
    case 'create':
      return 'text-emerald-400'
    case 'delete':
      return 'text-rose-400'
    case 'move':
    case 'rename':
      return 'text-amber-400'
    default:
      return 'text-sky-400'
  }
}

function getKindLetter(kind: string): string {
  switch (kind) {
    case 'add':
    case 'create':
      return 'A'
    case 'delete':
      return 'D'
    case 'move':
    case 'rename':
      return 'R'
    default:
      return 'M'
  }
}

function FileChangeRow({
  change,
  displayName,
  displayPath,
  viewportRef,
}: {
  change: ParsedFileChange
  displayName: string
  displayPath: string
  viewportRef?: RefObject<HTMLDivElement | null>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const anchorTopRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const correctionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (correctionTimeoutRef.current) {
        clearTimeout(correctionTimeoutRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (anchorTopRef.current == null) return

    const viewport = viewportRef?.current
    const button = buttonRef.current
    if (!viewport || !button) {
      anchorTopRef.current = null
      return
    }

    const correctViewport = () => {
      const anchorTop = anchorTopRef.current
      if (anchorTop == null) return

      const viewportTop = viewport.getBoundingClientRect().top
      const currentTop = button.getBoundingClientRect().top - viewportTop
      const delta = currentTop - anchorTop

      if (Math.abs(delta) > 0.5) {
        viewport.scrollTop += delta
      }
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      correctViewport()
      animationFrameRef.current = null
    })

    correctionTimeoutRef.current = setTimeout(() => {
      correctViewport()
      correctionTimeoutRef.current = null
      anchorTopRef.current = null
    }, 170)

    return () => {
      if (animationFrameRef.current != null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      if (correctionTimeoutRef.current) {
        clearTimeout(correctionTimeoutRef.current)
        correctionTimeoutRef.current = null
      }
    }
  }, [isOpen, viewportRef])

  const handleToggle = () => {
    const viewport = viewportRef?.current
    const button = buttonRef.current

    if (viewport && button) {
      const viewportTop = viewport.getBoundingClientRect().top
      anchorTopRef.current = button.getBoundingClientRect().top - viewportTop
    } else {
      anchorTopRef.current = null
    }

    setIsOpen(open => !open)
  }

  return (
    <div className="border-t border-white/[0.04] first:border-t-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title={displayPath}
        className="flex w-full items-center gap-2 px-3 py-[5px] text-left transition-colors hover:bg-white/[0.04]"
      >
        <span
          className={cn(
            'w-4 shrink-0 text-center text-[10px] font-bold',
            getKindColor(change.kind)
          )}
        >
          {getKindLetter(change.kind)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-300">
          {displayName}
        </span>
        {(change.added > 0 || change.removed > 0) && (
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
            {change.added > 0 && (
              <span className="text-emerald-400/70">+{change.added}</span>
            )}
            {change.added > 0 && change.removed > 0 && (
              <span className="px-0.5">/</span>
            )}
            {change.removed > 0 && (
              <span className="text-rose-400/70">-{change.removed}</span>
            )}
          </span>
        )}
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-150',
            isOpen && 'rotate-90'
          )}
        />
      </button>

      {isOpen && (
        <div className="border-t border-white/[0.04] bg-black/30">
          {change.lines.length > 0 ? (
            <div className="max-h-56 overflow-auto font-mono text-[10px] leading-[18px]">
              {change.lines.map((line, index) => {
                if (line.kind === 'hunk') {
                  return (
                    <div
                      key={`h-${index}`}
                      className="bg-sky-500/8 px-3 py-0.5 text-sky-400/60"
                    >
                      {line.text}
                    </div>
                  )
                }

                if (line.kind === 'meta') {
                  return (
                    <div
                      key={`m-${index}`}
                      className="px-3 py-0.5 text-zinc-600"
                    >
                      {line.text}
                    </div>
                  )
                }

                const sign =
                  line.kind === 'added'
                    ? '+'
                    : line.kind === 'removed'
                      ? '-'
                      : ' '

                return (
                  <div
                    key={`l-${index}`}
                    className={cn(
                      'grid grid-cols-[2.5rem_2.5rem_0.75rem_minmax(0,1fr)]',
                      line.kind === 'added' && 'bg-emerald-500/8',
                      line.kind === 'removed' && 'bg-rose-500/8'
                    )}
                  >
                    <span className="select-none px-1 text-right text-zinc-600">
                      {line.oldLineNumber ?? ''}
                    </span>
                    <span className="select-none px-1 text-right text-zinc-600">
                      {line.newLineNumber ?? ''}
                    </span>
                    <span
                      className={cn(
                        'select-none',
                        line.kind === 'added' && 'text-emerald-400/60',
                        line.kind === 'removed' && 'text-rose-400/60',
                        line.kind === 'context' && 'text-zinc-700'
                      )}
                    >
                      {sign}
                    </span>
                    <span className="overflow-x-auto whitespace-pre text-zinc-300">
                      {line.text || ' '}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-3 py-2 text-[11px] text-zinc-600">
              No diff available
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const FileChangeCard = memo(function FileChangeCard({
  toolCalls,
  className,
  viewportRef,
  worktreePath,
}: FileChangeCardProps) {
  const changes = collectFileChanges(toolCalls)
  const [isListOpen, setIsListOpen] = useState(
    () => changes.length <= COLLAPSE_THRESHOLD
  )
  const [showAll, setShowAll] = useState(false)

  const displayPathMap = useMemo(
    () =>
      new Map(
        changes.map(change => [
          change.path,
          formatWorktreeRelativePath(change.path, worktreePath),
        ])
      ),
    [changes, worktreePath]
  )

  if (changes.length === 0) return null

  const totals = getFileChangeTotals(changes)
  const needsShowMore =
    isListOpen && !showAll && changes.length > SHOW_MORE_THRESHOLD
  const visibleChanges = needsShowMore
    ? changes.slice(0, INITIAL_VISIBLE)
    : changes
  const remainingCount = changes.length - INITIAL_VISIBLE

  return (
    <div
      className={cn(
        'mt-3 overflow-hidden rounded-xl border border-white/[0.06] bg-[linear-gradient(180deg,rgba(30,30,30,0.97),rgba(22,22,22,0.99))]',
        className
      )}
    >
      <button
        type="button"
        onClick={() => {
          if (changes.length > COLLAPSE_THRESHOLD) {
            setIsListOpen(open => !open)
          }
        }}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2',
          changes.length > COLLAPSE_THRESHOLD &&
            'cursor-pointer transition-colors hover:bg-white/[0.03]'
        )}
      >
        {changes.length > COLLAPSE_THRESHOLD && (
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-zinc-500 transition-transform duration-150',
              isListOpen && 'rotate-90'
            )}
          />
        )}
        <span className="text-[12px] font-semibold text-zinc-300">
          {changes.length} file{changes.length === 1 ? '' : 's'} changed
        </span>
        <span className="text-[12px] font-semibold text-emerald-400/80">
          +{totals.added}
        </span>
        <span className="text-[12px] font-semibold text-rose-400/80">
          -{totals.removed}
        </span>
      </button>

      {isListOpen && (
        <div className="border-t border-white/[0.04]">
          {visibleChanges.map(change => {
            const displayPath = displayPathMap.get(change.path) ?? change.path
            return (
              <FileChangeRow
                key={`${change.path}:${change.previousPath ?? ''}:${change.kind}`}
                change={change}
                displayName={displayPath}
                displayPath={displayPath}
                viewportRef={viewportRef}
              />
            )
          })}
          {needsShowMore && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full border-t border-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-500 transition-colors hover:bg-white/[0.03] hover:text-zinc-400"
            >
              Show {remainingCount} more file{remainingCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  )
})
