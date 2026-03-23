import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleDot } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { useGitHubIssues } from '@/services/github'
import { ghCliQueryKeys } from '@/services/gh-cli'
import { useProjects } from '@/services/projects'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import type { GhAuthStatus } from '@/types/gh-cli'
import { usePreferences } from '@/services/preferences'
import { hideGitHubIssuesAndPRs } from '@/types/projects'

const BADGE_STALE_TIME = 5 * 60 * 1000 // 5 minutes — background badge, not active UI

interface NewIssuesBadgeProps {
  projectPath: string
  projectId: string
  className?: string
}

export function NewIssuesBadge({
  projectPath,
  projectId,
  className,
}: NewIssuesBadgeProps) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const { data: projects } = useProjects()
  const showIssueSources = preferences?.show_create_page_issue_sources ?? true
  const authData = queryClient.getQueryData<GhAuthStatus>(ghCliQueryKeys.auth())
  const isAuthenticated = authData?.authenticated ?? false
  const project = projects?.find(candidate => candidate.id === projectId)
  const isHidden = hideGitHubIssuesAndPRs(project)

  const { data: issueResult } = useGitHubIssues(projectPath, 'open', {
    enabled: isAuthenticated && showIssueSources && !isHidden,
    staleTime: BADGE_STALE_TIME,
  })

  const totalCount = issueResult?.totalCount ?? 0

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      useProjectsStore.getState().selectProject(projectId)
      const { setNewWorktreeModalDefaultTab, setNewWorktreeModalOpen } =
        useUIStore.getState()
      setNewWorktreeModalDefaultTab('issues')
      setNewWorktreeModalOpen(true)
    },
    [projectId]
  )

  if (!showIssueSources || isHidden || totalCount === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            'shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium text-green-600 transition-colors hover:bg-green-500/20',
            className
          )}
        >
          <span className="flex items-center gap-0.5">
            <CircleDot className="h-3 w-3" />
            {totalCount}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{`${totalCount} open issue${totalCount > 1 ? 's' : ''}`}</TooltipContent>
    </Tooltip>
  )
}
