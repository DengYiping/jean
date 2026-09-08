import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

const COPIED_RESET_MS = 2000

interface FilePathCopyRowProps {
  filePath: string
  /** Extra classes for the visible path text. Ignored when `iconOnly`. */
  pathClassName?: string
  /** Render only the copy button (e.g. next to a filename). */
  iconOnly?: boolean
}

/**
 * Selectable file path plus a copy button. The success state is only shown
 * after the clipboard operation resolves and is cleared if the path changes.
 */
export function FilePathCopyRow({
  filePath,
  pathClassName,
  iconOnly = false,
}: FilePathCopyRowProps) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathRef = useRef(filePath)

  useEffect(() => {
    pathRef.current = filePath
    setCopied(false)
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [filePath])

  const handleCopy = useCallback(async () => {
    const path = filePath
    try {
      await copyToClipboard(path)
      toast.success('Copied file path to clipboard')
      if (pathRef.current !== path) return

      setCopied(true)
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        setCopied(false)
        timeoutRef.current = null
      }, COPIED_RESET_MS)
    } catch (err) {
      if (pathRef.current !== path) return
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to copy: ${message}`)
    }
  }, [filePath])

  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      onClick={handleCopy}
      title="Copy file path"
      aria-label="Copy file path"
    >
      {copied ? (
        <Check className="size-3 text-green-500" />
      ) : (
        <Copy className="size-3 text-muted-foreground" />
      )}
    </Button>
  )

  if (iconOnly) return button

  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span
        className={cn(
          'min-w-0 select-text text-xs font-normal text-muted-foreground',
          pathClassName
        )}
      >
        {filePath}
      </span>
      {button}
    </div>
  )
}
