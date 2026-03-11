import { memo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ToolCall } from '@/types/chat'
import { cn } from '@/lib/utils'
import {
  collectFileChanges,
  formatFileChangeKind,
  getFileChangeTotals,
  type ParsedFileChange,
} from './file-change-utils'

interface FileChangeCardProps {
  toolCalls: ToolCall[] | undefined
  className?: string
}

function getKindBadgeClass(kind: string): string {
  switch (kind) {
    case 'add':
    case 'create':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    case 'delete':
      return 'border-rose-500/20 bg-rose-500/10 text-rose-300'
    case 'move':
    case 'rename':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-300'
    default:
      return 'border-sky-500/20 bg-sky-500/10 text-sky-300'
  }
}

function FileChangeRow({ change }: { change: ParsedFileChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const kindLabel = formatFileChangeKind(change.kind)

  return (
    <div className="border-t border-white/6 first:border-t-0">
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.035]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[13px] font-medium text-zinc-100">
              {change.path}
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]',
                getKindBadgeClass(change.kind)
              )}
            >
              {kindLabel}
            </span>
          </div>
          {change.previousPath && (
            <div className="truncate pt-0.5 text-[10px] text-zinc-500">
              from {change.previousPath}
            </div>
          )}
        </div>
        <div className="shrink-0 text-[12px] font-semibold">
          <span className="text-emerald-400">+{change.added}</span>
          <span className="px-1 text-zinc-700">·</span>
          <span className="text-rose-400">-{change.removed}</span>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {isOpen && (
        <div className="border-t border-white/6 bg-black/20">
          <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span>{kindLabel}</span>
          </div>
          {change.lines.length > 0 ? (
            <div className="max-h-80 overflow-auto font-mono text-[11px]">
              {change.lines.map((line, index) => {
                if (line.kind === 'hunk') {
                  return (
                    <div
                      key={`${change.path}-hunk-${index}`}
                      className="border-t border-white/6 bg-sky-500/10 px-4 py-1 text-sky-300"
                    >
                      {line.text}
                    </div>
                  )
                }

                if (line.kind === 'meta') {
                  return (
                    <div
                      key={`${change.path}-meta-${index}`}
                      className="border-t border-white/6 px-4 py-1 text-zinc-500"
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
                    key={`${change.path}-line-${index}`}
                    className={cn(
                      'grid grid-cols-[3.25rem_3.25rem_1rem_minmax(0,1fr)] items-start border-t border-white/6',
                      line.kind === 'added' && 'bg-emerald-500/10',
                      line.kind === 'removed' && 'bg-rose-500/10'
                    )}
                  >
                    <span className="px-2 py-0.5 text-right text-zinc-500">
                      {line.oldLineNumber ?? ''}
                    </span>
                    <span className="px-2 py-0.5 text-right text-zinc-500">
                      {line.newLineNumber ?? ''}
                    </span>
                    <span
                      className={cn(
                        'px-1 py-0.5',
                        line.kind === 'added' && 'text-emerald-300',
                        line.kind === 'removed' && 'text-rose-300',
                        line.kind === 'context' && 'text-zinc-600'
                      )}
                    >
                      {sign}
                    </span>
                    <span className="overflow-x-auto whitespace-pre px-1 py-0.5 text-zinc-200">
                      {line.text || ' '}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="px-4 py-2.5 text-[12px] text-zinc-500">
              No textual diff available.
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
}: FileChangeCardProps) {
  const changes = collectFileChanges(toolCalls)

  if (changes.length === 0) return null

  const totals = getFileChangeTotals(changes)

  return (
    <div
      className={cn(
        'mt-3 overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(34,34,34,0.96),rgba(23,23,23,0.98))] text-zinc-50 shadow-[0_14px_40px_rgba(0,0,0,0.24)]',
        className
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-3">
        <span className="text-[14px] font-semibold tracking-[-0.02em] text-zinc-100">
          {changes.length} file{changes.length === 1 ? '' : 's'} changed
        </span>
        <span className="text-[14px] font-semibold tracking-[-0.02em] text-emerald-400">
          +{totals.added}
        </span>
        <span className="text-[14px] font-semibold tracking-[-0.02em] text-rose-400">
          -{totals.removed}
        </span>
      </div>

      <div>
        {changes.map(change => (
          <FileChangeRow
            key={`${change.path}:${change.previousPath ?? ''}:${change.kind}`}
            change={change}
          />
        ))}
      </div>
    </div>
  )
})
