import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  AlertCircle,
  Check,
  Columns2,
  GitPullRequest,
  ListCollapse,
  ListPlus,
  Loader2,
  MessageSquare,
  RefreshCw,
  Reply,
  Rows3,
  Send,
  Search,
  X,
} from 'lucide-react'
import { FileDiff } from '@pierre/diffs/react'
import {
  parsePatchFiles,
  type DiffLineAnnotation,
  type SelectedLineRange,
} from '@pierre/diffs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Markdown } from '@/components/ui/markdown'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useUIStore } from '@/store/ui-store'
import {
  useCreatePullRequestInlineComment,
  usePullRequestReviewDiff,
  usePullRequestReviewFileContents,
  usePullRequestReviewSummary,
  useReplyToPullRequestReviewComment,
  useSubmitPullRequestReview,
} from '@/services/github'
import { useTheme } from '@/hooks/use-theme'
import { usePreferences } from '@/services/preferences'
import { cn } from '@/lib/utils'
import { splitDiffFileLines } from '@/lib/diff-lines'
import { getFilename } from '@/lib/path-utils'
import type {
  GitHubReviewThread,
  SubmitPullRequestReviewInput,
} from '@/types/github'
import type { SyntaxTheme } from '@/types/preferences'
import { toast } from 'sonner'

const EMPTY_ANNOTATIONS: DiffLineAnnotation<GitHubReviewThread>[] = []

type DiffStyle = 'split' | 'unified'

function resolveThemeType(theme: string): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return theme === 'dark' ? 'dark' : 'light'
}

function getThreadLineNumber(thread: GitHubReviewThread): number | null {
  return (
    thread.line ??
    thread.startLine ??
    thread.originalLine ??
    thread.originalStartLine ??
    null
  )
}

function mapGitHubSideToDiffSide(
  side?: 'LEFT' | 'RIGHT' | null
): 'deletions' | 'additions' {
  return side === 'LEFT' ? 'deletions' : 'additions'
}

function mapSelectedRangeSideToGitHubSide(
  side?: 'deletions' | 'additions' | null
): 'LEFT' | 'RIGHT' {
  return side === 'deletions' ? 'LEFT' : 'RIGHT'
}

function formatRelativeDate(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  if (!Number.isFinite(diff) || diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function ReviewThreadCard({
  thread,
  replyValue,
  isReplying,
  onReplyValueChange,
  onReply,
}: {
  thread: GitHubReviewThread
  replyValue: string
  isReplying: boolean
  onReplyValueChange: (value: string) => void
  onReply: () => void
}) {
  const renderAuthorAvatar = (
    login: string,
    avatarUrl?: string | null,
    key?: string | number
  ) => {
    const initial = login[0]?.toUpperCase() ?? '?'

    if (avatarUrl) {
      return (
        <img
          key={key}
          src={avatarUrl}
          alt={`${login} avatar`}
          className="h-6 w-6 shrink-0 rounded-full bg-muted object-cover"
        />
      )
    }

    return (
      <span
        key={key}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
      >
        {initial}
      </span>
    )
  }

  return (
    <div className="my-2 rounded-md border border-border bg-background/95 font-sans shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <div className="min-w-0 truncate">
          {thread.path}
          {getThreadLineNumber(thread) ? `:${getThreadLineNumber(thread)}` : ''}
        </div>
        <div className="shrink-0">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
              thread.isResolved
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
            )}
          >
            {thread.isResolved ? 'Resolved' : 'Unresolved'}
          </span>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        {thread.comments.map(comment => (
          <div
            key={comment.id}
            className="rounded-md border border-border/70 bg-muted/20 px-3 py-3"
          >
            <div className="flex items-start gap-3">
              {renderAuthorAvatar(
                comment.author.login,
                comment.author.avatarUrl,
                comment.id
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {comment.author.login}
                  </span>
                  <span>{formatRelativeDate(comment.createdAt)}</span>
                </div>
                <Markdown className="font-sans text-sm">
                  {comment.body}
                </Markdown>
              </div>
            </div>
          </div>
        ))}
        <div className="space-y-2 border-t border-border pt-2">
          <Textarea
            value={replyValue}
            onChange={e => onReplyValueChange(e.target.value)}
            placeholder="Reply to this thread"
            className="min-h-20 text-sm"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={onReply}
              disabled={isReplying || !replyValue.trim()}
            >
              {isReplying ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Reply className="mr-1.5 h-3.5 w-3.5" />
              )}
              Reply
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NewInlineCommentBar({
  fileName,
  selectedRange,
  value,
  isSubmitting,
  onChange,
  onCancel,
  onSubmit,
}: {
  fileName: string | null
  selectedRange: SelectedLineRange | null
  value: string
  isSubmitting: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  if (!selectedRange) return null

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-3 py-3">
      <MessageSquare className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-xs text-muted-foreground">
          New comment on {fileName ? getFilename(fileName) : 'file'}:
          {Math.min(selectedRange.start, selectedRange.end)}
          {selectedRange.start !== selectedRange.end &&
            `-${Math.max(selectedRange.start, selectedRange.end)}`}
        </div>
        <Textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Leave an inline comment"
          className="min-h-24 text-sm"
        />
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={isSubmitting || !value.trim()}
        >
          {isSubmitting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          Comment
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1.5 h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ReviewActionButton({
  label,
  event,
  disabled,
  isSubmitting,
  onClick,
}: {
  label: string
  event: SubmitPullRequestReviewInput['event']
  disabled: boolean
  isSubmitting: boolean
  onClick: (event: SubmitPullRequestReviewInput['event']) => void
}) {
  return (
    <Button
      size="sm"
      variant={event === 'REQUEST_CHANGES' ? 'destructive' : 'default'}
      disabled={disabled || isSubmitting}
      onClick={() => onClick(event)}
    >
      {isSubmitting ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : event === 'APPROVE' ? (
        <Check className="mr-1.5 h-3.5 w-3.5" />
      ) : null}
      {label}
    </Button>
  )
}

export function PullRequestReviewDialog() {
  const dialogRequest = useUIStore(state => state.pullRequestReviewDialog)
  const closeDialog = useUIStore(state => state.closePullRequestReviewDialog)
  const { data: preferences } = usePreferences()
  const { theme } = useTheme()

  const projectPath = dialogRequest?.projectPath ?? null
  const prNumber = dialogRequest?.prNumber ?? null

  const {
    data: reviewSummary,
    isLoading: isLoadingSummary,
    error: summaryError,
    refetch: refetchSummary,
    isRefetching: isRefetchingSummary,
  } = usePullRequestReviewSummary(projectPath, prNumber)
  const {
    data: reviewDiff,
    isLoading: isLoadingDiff,
    error: diffError,
    refetch: refetchDiff,
    isRefetching: isRefetchingDiff,
  } = usePullRequestReviewDiff(projectPath, prNumber)

  const createInlineComment = useCreatePullRequestInlineComment()
  const replyToComment = useReplyToPullRequestReviewComment()
  const submitReview = useSubmitPullRequestReview()

  const [diffStyle, setDiffStyle] = useState<DiffStyle>(
    window.innerWidth < 768 ? 'unified' : 'split'
  )
  const [fileFilter, setFileFilter] = useState('')
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    null
  )
  const [activeFileName, setActiveFileName] = useState<string | null>(null)
  const [newCommentBody, setNewCommentBody] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({})
  const [replyingThreadId, setReplyingThreadId] = useState<number | null>(null)
  const [reviewBody, setReviewBody] = useState('')
  const [submittingReviewEvent, setSubmittingReviewEvent] = useState<
    SubmitPullRequestReviewInput['event'] | null
  >(null)
  const [expandUnchanged, setExpandUnchanged] = useState(false)
  const lineSelectedCallbacksRef = useRef<
    Map<string, (range: SelectedLineRange | null) => void>
  >(new Map())

  useEffect(() => {
    if (!dialogRequest) {
      setFileFilter('')
      setSelectedFileIndex(0)
      setSelectedRange(null)
      setActiveFileName(null)
      setNewCommentBody('')
      setReplyDrafts({})
      setReplyingThreadId(null)
      setReviewBody('')
      setSubmittingReviewEvent(null)
      setExpandUnchanged(false)
      lineSelectedCallbacksRef.current.clear()
    }
  }, [dialogRequest])

  const parsedFiles = useMemo(() => {
    if (!reviewDiff?.diff) return []
    try {
      return parsePatchFiles(reviewDiff.diff)
    } catch {
      return []
    }
  }, [reviewDiff?.diff])

  const flattenedFiles = useMemo(
    () =>
      parsedFiles.flatMap((patch, patchIndex) =>
        patch.files.map((fileDiff, fileIndex) => {
          let additions = 0
          let deletions = 0
          for (const hunk of fileDiff.hunks) {
            additions += hunk.additionCount
            deletions += hunk.deletionCount
          }
          return {
            key: `${patchIndex}-${fileIndex}`,
            fileDiff,
            fileName: fileDiff.name || fileDiff.prevName || 'unknown',
            additions,
            deletions,
          }
        })
      ),
    [parsedFiles]
  )

  const filteredFiles = useMemo(() => {
    if (!fileFilter.trim()) return flattenedFiles
    const lowerFilter = fileFilter.toLowerCase()
    return flattenedFiles.filter(file =>
      file.fileName.toLowerCase().includes(lowerFilter)
    )
  }, [fileFilter, flattenedFiles])

  useEffect(() => {
    if (selectedFileIndex >= filteredFiles.length) {
      setSelectedFileIndex(0)
    }
  }, [filteredFiles.length, selectedFileIndex])

  const selectedFile =
    filteredFiles.length > 0 && selectedFileIndex < filteredFiles.length
      ? filteredFiles[selectedFileIndex]
      : null

  const resolvedThemeType = useMemo(() => resolveThemeType(theme), [theme])

  const annotationsByFile = useMemo(() => {
    const map = new Map<string, DiffLineAnnotation<GitHubReviewThread>[]>()

    for (const thread of reviewSummary?.threads ?? []) {
      const lineNumber = getThreadLineNumber(thread)
      if (!thread.path || !lineNumber) continue

      const existing = map.get(thread.path) ?? []
      existing.push({
        side: mapGitHubSideToDiffSide(thread.side),
        lineNumber,
        metadata: thread,
      })
      map.set(thread.path, existing)
    }

    return map
  }, [reviewSummary?.threads])

  const getAnnotationsForFile = useCallback(
    (fileName: string) => annotationsByFile.get(fileName) ?? EMPTY_ANNOTATIONS,
    [annotationsByFile]
  )

  const getLineSelectedCallback = useCallback((fileName: string) => {
    let callback = lineSelectedCallbacksRef.current.get(fileName)
    if (!callback) {
      callback = (range: SelectedLineRange | null) => {
        setSelectedRange(range)
        setActiveFileName(range ? fileName : null)
      }
      lineSelectedCallbacksRef.current.set(fileName, callback)
    }
    return callback
  }, [])

  const handleReplyDraftChange = useCallback(
    (threadId: number, value: string) => {
      setReplyDrafts(prev => ({ ...prev, [threadId]: value }))
    },
    []
  )

  const handleSubmitReply = useCallback(
    async (thread: GitHubReviewThread) => {
      if (!projectPath || !prNumber) return

      const replyBody = replyDrafts[thread.id]?.trim()
      const commentId = thread.id
      if (!replyBody || !commentId) return

      setReplyingThreadId(thread.id)
      try {
        await replyToComment.mutateAsync({
          projectPath,
          prNumber,
          commentId,
          body: replyBody,
        })
        setReplyDrafts(prev => ({ ...prev, [thread.id]: '' }))
        toast.success('Reply posted')
        await refetchSummary()
      } catch (replyError) {
        toast.error(`Failed to post reply: ${replyError}`)
      } finally {
        setReplyingThreadId(null)
      }
    },
    [projectPath, prNumber, replyDrafts, replyToComment, refetchSummary]
  )

  const handleSubmitInlineComment = useCallback(async () => {
    if (
      !projectPath ||
      !prNumber ||
      !reviewSummary?.headCommitSha ||
      !selectedRange ||
      !activeFileName
    ) {
      return
    }

    const trimmedBody = newCommentBody.trim()
    if (!trimmedBody) return

    const startLine = Math.min(selectedRange.start, selectedRange.end)
    const endLine = Math.max(selectedRange.start, selectedRange.end)
    const side = mapSelectedRangeSideToGitHubSide(selectedRange.side ?? null)

    try {
      await createInlineComment.mutateAsync({
        projectPath,
        prNumber,
        body: trimmedBody,
        path: activeFileName,
        line: endLine,
        side,
        headCommitSha: reviewSummary.headCommitSha,
        startLine: startLine !== endLine ? startLine : undefined,
        startSide: startLine !== endLine ? side : undefined,
      })
      setNewCommentBody('')
      setSelectedRange(null)
      setActiveFileName(null)
      toast.success('Inline comment posted')
      await refetchSummary()
    } catch (commentError) {
      toast.error(`Failed to post comment: ${commentError}`)
    }
  }, [
    projectPath,
    prNumber,
    reviewSummary?.headCommitSha,
    selectedRange,
    activeFileName,
    newCommentBody,
    createInlineComment,
    refetchSummary,
  ])

  const handleSubmitReview = useCallback(
    async (event: SubmitPullRequestReviewInput['event']) => {
      if (!projectPath || !prNumber) return

      setSubmittingReviewEvent(event)
      try {
        await submitReview.mutateAsync({
          projectPath,
          prNumber,
          body: reviewBody.trim() || undefined,
          event,
        })
        setReviewBody('')
        toast.success(
          event === 'APPROVE'
            ? 'Review submitted and approved'
            : event === 'REQUEST_CHANGES'
              ? 'Review submitted with requested changes'
              : 'Review submitted'
        )
        await refetchSummary()
      } catch (reviewError) {
        toast.error(`Failed to submit review: ${reviewError}`)
      } finally {
        setSubmittingReviewEvent(null)
      }
    },
    [projectPath, prNumber, reviewBody, submitReview, refetchSummary]
  )

  const handleReviewTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSubmitReview('COMMENT')
      }
    },
    [handleSubmitReview]
  )

  const selectedFileAnnotations = selectedFile
    ? getAnnotationsForFile(selectedFile.fileName)
    : EMPTY_ANNOTATIONS
  const selectedFileContents = usePullRequestReviewFileContents(
    projectPath,
    prNumber,
    selectedFile?.fileName ?? null,
    { enabled: expandUnchanged && !!selectedFile }
  )
  const selectedFileDiff = useMemo(() => {
    if (!selectedFile) return null
    if (!expandUnchanged || !selectedFileContents.data) {
      return selectedFile.fileDiff
    }

    return {
      ...selectedFile.fileDiff,
      oldLines: splitDiffFileLines(selectedFileContents.data.oldContents),
      newLines: splitDiffFileLines(selectedFileContents.data.newContents),
    }
  }, [expandUnchanged, selectedFile, selectedFileContents.data])
  const isExpandedDiffLoading =
    expandUnchanged && selectedFileContents.isLoading
  const hasViewerApproved = reviewSummary?.viewerApproved === true
  const hasOtherReviewerApproved = reviewSummary?.otherReviewerApproved === true
  const approvalIndicatorLabel = hasViewerApproved
    ? hasOtherReviewerApproved
      ? 'Approved by you and reviewer'
      : 'Approved by you'
    : hasOtherReviewerApproved
      ? 'Approved by reviewer'
      : null

  return (
    <Dialog
      open={dialogRequest !== null}
      onOpenChange={open => !open && closeDialog()}
    >
      <DialogContent
        className="!fixed !inset-0 !translate-x-0 !translate-y-0 !w-screen !h-[100dvh] !max-w-none !max-h-none !rounded-none sm:!inset-auto sm:!top-[50%] sm:!left-[50%] sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:!w-[96vw] sm:!max-w-[96vw] sm:!h-[92vh] sm:!max-h-[92vh] sm:!rounded-lg flex flex-col overflow-hidden z-[85] [&>[data-slot=dialog-close]]:right-4 [&>[data-slot=dialog-close]]:top-4"
        aria-describedby={undefined}
      >
        <DialogHeader className="shrink-0 border-b border-border pb-3 pr-20">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <GitPullRequest className="h-4 w-4 text-green-500" />
                {reviewSummary ? (
                  <>
                    #{reviewSummary.pullRequest.number}
                    <span className="truncate">
                      {reviewSummary.pullRequest.title}
                    </span>
                  </>
                ) : prNumber ? (
                  <>PR #{prNumber}</>
                ) : (
                  'PR Review'
                )}
              </DialogTitle>
              {reviewSummary && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{reviewSummary.pullRequest.headRefName}</span>
                  <span>→</span>
                  <span>{reviewSummary.pullRequest.baseRefName}</span>
                  <span className="text-emerald-600">
                    +{reviewSummary.pullRequest.additions}
                  </span>
                  <span className="text-red-600">
                    -{reviewSummary.pullRequest.deletions}
                  </span>
                  {approvalIndicatorLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600">
                      <Check className="h-3 w-3" />
                      {approvalIndicatorLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                aria-label={
                  expandUnchanged
                    ? 'Collapse unchanged lines'
                    : 'Expand unchanged lines'
                }
                onClick={() => setExpandUnchanged(current => !current)}
                title={
                  expandUnchanged
                    ? 'Collapse unchanged lines'
                    : 'Expand unchanged lines'
                }
              >
                {expandUnchanged ? (
                  <ListCollapse className="h-4 w-4" />
                ) : (
                  <ListPlus className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setDiffStyle(current =>
                    current === 'split' ? 'unified' : 'split'
                  )
                }
                title={
                  diffStyle === 'split'
                    ? 'Switch to unified diff'
                    : 'Switch to split diff'
                }
              >
                {diffStyle === 'split' ? (
                  <Rows3 className="h-4 w-4" />
                ) : (
                  <Columns2 className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  void refetchSummary()
                  void refetchDiff()
                }}
                disabled={isRefetchingSummary || isRefetchingDiff}
                title="Refresh review data"
              >
                {isRefetchingSummary || isRefetchingDiff ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isLoadingSummary ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : summaryError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div className="text-sm text-muted-foreground">
              {String(summaryError)}
            </div>
            <Button variant="outline" onClick={() => void refetchSummary()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-4 p-4 sm:grid-cols-[340px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col rounded-lg border border-border">
                <div className="border-b border-border p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={fileFilter}
                      onChange={e => setFileFilter(e.target.value)}
                      placeholder="Filter files"
                      className="pl-9"
                    />
                  </div>
                </div>
                <TooltipProvider delayDuration={600}>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="py-1">
                      {filteredFiles.map((file, index) => (
                        <Tooltip key={file.key}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              title={file.fileName}
                              onClick={() => {
                                setSelectedFileIndex(index)
                                setSelectedRange(null)
                                setActiveFileName(null)
                              }}
                              className={cn(
                                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                                selectedFile?.key === file.key && 'bg-accent'
                              )}
                            >
                              {annotationsByFile.has(file.fileName) && (
                                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                              )}
                              <span className="min-w-0 flex-1 truncate">
                                {getFilename(file.fileName)}
                              </span>
                              <span className="shrink-0 text-xs">
                                <span className="text-emerald-600">
                                  +{file.additions}
                                </span>
                                {' / '}
                                <span className="text-red-600">
                                  -{file.deletions}
                                </span>
                              </span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="z-[120] max-w-sm break-all"
                          >
                            {file.fileName}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                      {filteredFiles.length === 0 && (
                        <div className="px-3 py-6 text-sm text-muted-foreground">
                          No files match your filter.
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </TooltipProvider>
              </div>

              <div className="flex min-h-0 flex-col gap-3">
                <NewInlineCommentBar
                  fileName={activeFileName}
                  selectedRange={selectedRange}
                  value={newCommentBody}
                  isSubmitting={createInlineComment.isPending}
                  onChange={setNewCommentBody}
                  onCancel={() => {
                    setSelectedRange(null)
                    setActiveFileName(null)
                    setNewCommentBody('')
                  }}
                  onSubmit={() => void handleSubmitInlineComment()}
                />

                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
                  {isLoadingDiff ? (
                    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading diff...
                    </div>
                  ) : diffError ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                      <AlertCircle className="h-5 w-5 text-destructive" />
                      <div className="text-sm text-muted-foreground">
                        {String(diffError)}
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => void refetchDiff()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : selectedFile && selectedFileDiff ? (
                    <div className="h-full overflow-y-auto">
                      <div className="p-1">
                        {isExpandedDiffLoading && (
                          <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading expanded context...
                          </div>
                        )}
                        <FileDiff
                          key={selectedFile.key}
                          fileDiff={selectedFileDiff}
                          lineAnnotations={selectedFileAnnotations}
                          selectedLines={
                            activeFileName === selectedFile.fileName
                              ? selectedRange
                              : null
                          }
                          options={{
                            theme: {
                              dark: (preferences?.syntax_theme_dark ??
                                'vitesse-black') as SyntaxTheme,
                              light: (preferences?.syntax_theme_light ??
                                'github-light') as SyntaxTheme,
                            },
                            themeType: resolvedThemeType,
                            diffStyle,
                            overflow: 'wrap',
                            enableLineSelection: true,
                            expandUnchanged,
                            expansionLineCount: 200,
                            onLineSelected: getLineSelectedCallback(
                              selectedFile.fileName
                            ),
                            disableFileHeader: false,
                          }}
                          renderAnnotation={annotation => {
                            const thread = annotation.metadata
                            if (!thread) return null

                            return (
                              <ReviewThreadCard
                                thread={thread}
                                replyValue={replyDrafts[thread.id] ?? ''}
                                isReplying={replyingThreadId === thread.id}
                                onReplyValueChange={value =>
                                  handleReplyDraftChange(thread.id, value)
                                }
                                onReply={() => void handleSubmitReply(thread)}
                              />
                            )
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Select a file to review its diff
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-border bg-muted/20 px-4 py-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Submit review</div>
                  <Textarea
                    value={reviewBody}
                    onChange={e => setReviewBody(e.target.value)}
                    onKeyDown={handleReviewTextareaKeyDown}
                    placeholder="Add an overall review comment"
                    className="min-h-24 bg-background text-sm"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <ReviewActionButton
                    label="Comment"
                    event="COMMENT"
                    disabled={submitReview.isPending}
                    isSubmitting={submittingReviewEvent === 'COMMENT'}
                    onClick={handleSubmitReview}
                  />
                  <ReviewActionButton
                    label={hasViewerApproved ? 'Approved by you' : 'Approve'}
                    event="APPROVE"
                    disabled={submitReview.isPending || hasViewerApproved}
                    isSubmitting={submittingReviewEvent === 'APPROVE'}
                    onClick={handleSubmitReview}
                  />
                  <ReviewActionButton
                    label="Request changes"
                    event="REQUEST_CHANGES"
                    disabled={submitReview.isPending}
                    isSubmitting={submittingReviewEvent === 'REQUEST_CHANGES'}
                    onClick={handleSubmitReview}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
