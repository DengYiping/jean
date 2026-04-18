import { memo, useMemo, useState, useCallback, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import remend from 'remend'
import { Copy, Check, Table } from 'lucide-react'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { usePreferences } from '@/services/preferences'
import { isNativeApp } from '@/lib/environment'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

interface MarkdownProps {
  children: string
  /** Enable streaming mode with incomplete markdown handling */
  streaming?: boolean
  className?: string
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText(
      (node as { props: { children?: ReactNode } }).props.children
    )
  }
  return ''
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = extractText(children)
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  return (
    <div className="relative my-5">
      <pre className="overflow-x-auto rounded-lg bg-muted p-4 pr-10 text-sm">
        {children}
      </pre>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="absolute right-2 top-2 opacity-50 hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-background/80 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>Copy code</TooltipContent>
      </Tooltip>
    </div>
  )
}

function parseLocalEditorLink(
  href: string | undefined
): { path: string; lineNumber: number | null } | null {
  if (!href) return null
  if (href.startsWith('#')) return null
  if (/^(https?:|mailto:|tel:)/i.test(href)) return null

  const lineMatch = href.match(/#L?(\d+)$/)
  const lineNumber = lineMatch?.[1] ? Number.parseInt(lineMatch[1], 10) : null
  const path = lineMatch
    ? href.slice(0, href.length - lineMatch[0].length)
    : href

  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(path)
  const isUnixPath = path.startsWith('/')
  const isRelativePath =
    path.startsWith('./') || path.startsWith('../') || path.startsWith('~/')

  if (!isWindowsPath && !isUnixPath && !isRelativePath) return null
  if (!path) return null

  return { path, lineNumber }
}

/**
 * Memoized markdown renderer to prevent expensive re-parsing
 * ReactMarkdown is expensive, so we avoid re-renders when content hasn't changed
 */
const Markdown = memo(function Markdown({
  children,
  streaming = false,
  className,
}: MarkdownProps) {
  const { data: preferences } = usePreferences()
  // Apply remend preprocessing for streaming content to auto-close incomplete markdown
  const content = streaming ? remend(children) : children

  const handleLocalLinkOpen = useCallback(
    async (href: string) => {
      const parsed = parseLocalEditorLink(href)
      if (!parsed || !isNativeApp()) return false

      try {
        await invoke('open_file_in_default_app', {
          path: parsed.path,
          editor: preferences?.editor,
          lineNumber: parsed.lineNumber,
        })
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error(`Failed to open link: ${message}`)
        return true
      }
    },
    [preferences?.editor]
  )

  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => (
        <div className="mt-8 mb-5 text-3xl font-bold text-foreground first:mt-0">
          {children}
        </div>
      ),
      h2: ({ children }) => (
        <div className="mt-8 mb-4 text-2xl font-bold text-foreground first:mt-0">
          {children}
        </div>
      ),
      h3: ({ children }) => (
        <div className="mt-7 mb-3 text-xl font-semibold text-foreground first:mt-0">
          {children}
        </div>
      ),
      h4: ({ children }) => (
        <div className="mt-6 mb-2.5 text-lg font-semibold text-foreground first:mt-0">
          {children}
        </div>
      ),
      h5: ({ children }) => (
        <div className="mt-5 mb-2 text-base font-medium text-foreground first:mt-0">
          {children}
        </div>
      ),
      h6: ({ children }) => (
        <div className="mt-4 mb-1.5 text-sm font-medium text-muted-foreground first:mt-0">
          {children}
        </div>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold">{children}</strong>
      ),
      em: ({ children }) => <em className="italic">{children}</em>,
      code: ({ children, className }) => {
        const isBlock = className?.startsWith('language-')
        if (isBlock) {
          return <code className={className}>{children}</code>
        }
        return (
          <code className="rounded-md bg-muted px-1.5 py-0.5 text-[0.875em]">
            {children}
          </code>
        )
      },
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      img: ({ src, alt }) => (
        <img
          src={src}
          alt={alt || ''}
          className="max-w-full h-auto rounded-md my-4"
        />
      ),
      a: ({ href, children }) => {
        const localLink = parseLocalEditorLink(href)
        if (localLink && isNativeApp()) {
          return (
            <button
              type="button"
              className="inline cursor-pointer text-left underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                if (href) {
                  void handleLocalLinkOpen(href)
                }
              }}
            >
              {children}
            </button>
          )
        }

        return (
          <a
            href={href}
            className="underline underline-offset-2 hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        )
      },
      ul: ({ children }) => (
        <ul className="my-4 ml-6 list-disc list-outside space-y-2">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-4 ml-6 list-decimal list-outside space-y-2">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="my-5 border-l-2 border-muted-foreground/40 pl-4 py-1 italic">
          {children}
        </blockquote>
      ),
      p: ({ children }) => (
        <p className="my-3 leading-relaxed first:mt-0 last:mb-0">{children}</p>
      ),
      table: ({ children }) => (
        <div className="my-5 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-muted/50">{children}</thead>
      ),
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => (
        <tr className="border-b border-border">{children}</tr>
      ),
      th: ({ children }) => (
        <th className="px-4 py-2.5 text-left font-semibold">{children}</th>
      ),
      td: ({ children }) => <td className="px-4 py-2.5">{children}</td>,
    }),
    [handleLocalLinkOpen]
  )

  const renderComponents = useMemo<Components>(
    () =>
      streaming
        ? {
            ...components,
            p: ({ children }) => (
              <p className="my-0 leading-relaxed first:mt-0 last:mb-0">
                {children}
              </p>
            ),
          }
        : components,
    [components, streaming]
  )

  return (
    <div className={cn('markdown leading-relaxed break-words', className)}>
      <ReactMarkdown
        components={renderComponents}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

export { Markdown }
