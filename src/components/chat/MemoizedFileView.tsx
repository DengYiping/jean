import { useState, useMemo, memo, useTransition } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { File as PierreFile } from '@pierre/diffs/react'
import type { FileContents } from '@pierre/diffs'
import type { SyntaxTheme } from '@/types/preferences'

/** Props for the memoized File wrapper */
export interface MemoizedFileViewProps {
  fileContents: FileContents
  fileName: string
  themeType: 'dark' | 'light'
  syntaxThemeDark: SyntaxTheme
  syntaxThemeLight: SyntaxTheme
  touchedLines?: number[]
}

function buildTouchedLineStyles(touchedLines: number[]): string {
  if (touchedLines.length === 0) return ''

  const selectors = touchedLines
    .map(
      lineNumber => `
      [data-line="${lineNumber}"] [data-column-content] {
        background-color: light-dark(
          color-mix(in lab, var(--diffs-bg) 84%, var(--diffs-modified-base)),
          color-mix(in lab, var(--diffs-bg) 76%, var(--diffs-modified-base))
        ) !important;
        box-shadow: inset 3px 0 0 var(--diffs-modified-base);
      }

      [data-line="${lineNumber}"] [data-column-number] {
        color: var(--diffs-selection-number-fg);
        background-color: light-dark(
          color-mix(in lab, var(--diffs-bg) 76%, var(--diffs-modified-base)),
          color-mix(in lab, var(--diffs-bg) 62%, var(--diffs-modified-base))
        ) !important;
      }
    `
    )
    .join('\n')

  return `
    ${selectors}
  `
}

/** Memoized File wrapper to prevent unnecessary re-renders */
export const MemoizedFileView = memo(
  function MemoizedFileView({
    fileContents,
    fileName,
    themeType,
    syntaxThemeDark,
    syntaxThemeLight,
    touchedLines = [],
  }: MemoizedFileViewProps) {
    const [forceShow, setForceShow] = useState(false)
    const [isLoadingRender, startLoadingRender] = useTransition()

    const normalizedTouchedLines = useMemo(
      () =>
        Array.from(new Set(touchedLines))
          .filter(lineNumber => lineNumber > 0)
          .sort((a, b) => a - b),
      [touchedLines]
    )

    const options = useMemo(
      () => ({
        theme: {
          dark: syntaxThemeDark,
          light: syntaxThemeLight,
        },
        themeType,
        overflow: 'wrap' as const,
        disableFileHeader: true,
        unsafeCSS: `
      pre { font-family: var(--font-family-mono) !important; font-size: calc(var(--ui-font-size) * 0.85) !important; line-height: var(--ui-line-height) !important; }
      * { user-select: text !important; -webkit-user-select: text !important; cursor: text !important; }
      ${buildTouchedLineStyles(normalizedTouchedLines)}
    `,
      }),
      [themeType, syntaxThemeDark, syntaxThemeLight, normalizedTouchedLines]
    )

    const lineCount = useMemo(
      () => fileContents.contents.split('\n').length,
      [fileContents.contents]
    )

    const isEmpty = fileContents.contents.length === 0

    return (
      <div className="border border-border">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b border-border sticky top-0 z-10">
          <FileText className="h-[1em] w-[1em] shrink-0 text-blue-500" />
          <span className="truncate">{fileName}</span>
          <div className="ml-auto flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
            <span>Full file</span>
            <span>·</span>
            <span>{lineCount.toLocaleString()} lines</span>
            {normalizedTouchedLines.length > 0 && (
              <>
                <span>·</span>
                <span>
                  {normalizedTouchedLines.length.toLocaleString()} touched
                </span>
              </>
            )}
          </div>
        </div>
        {isEmpty ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            Empty file
          </div>
        ) : lineCount > 50000 && !forceShow ? (
          <div className="px-4 py-8 flex flex-col items-center gap-3 text-muted-foreground text-sm">
            {isLoadingRender ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Rendering file...</span>
              </>
            ) : (
              <>
                <span>Large file — {lineCount.toLocaleString()} lines</span>
                <button
                  type="button"
                  onClick={() => startLoadingRender(() => setForceShow(true))}
                  className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-accent transition-colors"
                >
                  Show file
                </button>
              </>
            )}
          </div>
        ) : (
          <PierreFile file={fileContents} options={options} />
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.fileContents === nextProps.fileContents &&
      prevProps.fileName === nextProps.fileName &&
      prevProps.themeType === nextProps.themeType &&
      prevProps.syntaxThemeDark === nextProps.syntaxThemeDark &&
      prevProps.syntaxThemeLight === nextProps.syntaxThemeLight &&
      prevProps.touchedLines === nextProps.touchedLines
    )
  }
)
