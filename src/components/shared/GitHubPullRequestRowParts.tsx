import { useState } from 'react'
import { ExternalLink, MessageSquare } from 'lucide-react'
import { openExternal } from '@/lib/platform'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { GitHubPullRequest } from '@/types/github'

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const diff = Date.now() - date.getTime()
  if (!Number.isFinite(diff) || diff < 0) return 'just now'

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  const years = Math.floor(months / 12)
  return `${years}y ago`
}

function getPullRequestCreatedAt(pr: GitHubPullRequest): string {
  return (
    pr.created_at || ((pr as unknown as { createdAt?: string }).createdAt ?? '')
  )
}

function AuthorAvatar({
  login,
  avatarUrl,
}: {
  login: string
  avatarUrl?: string | null
}) {
  const [hasImageError, setHasImageError] = useState(false)
  const initial = login[0]?.toUpperCase() ?? '?'

  if (avatarUrl && !hasImageError) {
    return (
      <img
        src={avatarUrl}
        alt={`${login} avatar`}
        className="h-4 w-4 rounded-full bg-muted object-cover"
        onError={() => setHasImageError(true)}
      />
    )
  }

  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] font-medium text-muted-foreground">
      {initial}
    </span>
  )
}

export function PullRequestMeta({ pr }: { pr: GitHubPullRequest }) {
  const createdAt = getPullRequestCreatedAt(pr)

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <AuthorAvatar login={pr.author.login} avatarUrl={pr.author.avatarUrl} />
        <span className="truncate">{pr.author.login}</span>
      </span>
      {createdAt && <span>opened {formatRelativeDate(createdAt)}</span>}
      <span className="font-medium text-emerald-600">+{pr.additions}</span>
      <span className="font-medium text-red-600">-{pr.deletions}</span>
    </div>
  )
}

export function OpenPullRequestButton({
  isCreating,
  url,
}: {
  isCreating: boolean
  url: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Open PR on GitHub"
          onClick={e => {
            e.stopPropagation()
            void openExternal(url)
          }}
          disabled={isCreating}
          className="inline-flex h-6 w-6 items-center justify-center rounded px-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Open PR on GitHub</TooltipContent>
    </Tooltip>
  )
}

export function OpenPullRequestReviewButton({
  onClick,
  disabled = false,
}: {
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Review PR diff and comments"
          onClick={event => {
            event.stopPropagation()
            onClick(event)
          }}
          disabled={disabled}
          className="inline-flex h-6 w-6 items-center justify-center rounded px-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Review PR diff and comments</TooltipContent>
    </Tooltip>
  )
}
