import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { useDependabotAlerts, useRepositoryAdvisories } from '@/services/github'
import { ghCliQueryKeys } from '@/services/gh-cli'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import type { GhAuthStatus } from '@/types/gh-cli'
import { usePreferences } from '@/services/preferences'

const BADGE_STALE_TIME = 5 * 60 * 1000 // 5 minutes — background badge, not active UI

interface SecurityAlertsBadgeProps {
  projectPath: string
  projectId: string
  className?: string
}

export function SecurityAlertsBadge({
  projectPath,
  projectId,
  className,
}: SecurityAlertsBadgeProps) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const showIssueSources = preferences?.show_create_page_issue_sources ?? true
  const authData = queryClient.getQueryData<GhAuthStatus>(ghCliQueryKeys.auth())
  const isAuthenticated = authData?.authenticated ?? false

  const { data: alerts } = useDependabotAlerts(projectPath, 'open', {
    enabled: isAuthenticated && showIssueSources,
    staleTime: BADGE_STALE_TIME,
  })

  const { data: advisories } = useRepositoryAdvisories(projectPath, undefined, {
    enabled: isAuthenticated && showIssueSources,
    staleTime: BADGE_STALE_TIME,
  })

  const alertCount = alerts?.length ?? 0
  const advisoryCount =
    advisories?.filter(a => a.state === 'draft' || a.state === 'triage').length ?? 0
  const totalCount = alertCount + advisoryCount

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      useProjectsStore.getState().selectProject(projectId)
      const { setNewWorktreeModalDefaultTab, setNewWorktreeModalOpen } =
        useUIStore.getState()
      setNewWorktreeModalDefaultTab('security')
      setNewWorktreeModalOpen(true)
    },
    [projectId]
  )

  if (!showIssueSources || totalCount === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className={cn(
            'shrink-0 rounded bg-orange-500/10 px-1.5 py-0.5 text-[11px] font-medium text-orange-600 transition-colors hover:bg-orange-500/20',
            className
          )}
        >
          <span className="flex items-center gap-0.5">
            <ShieldAlert className="h-3 w-3" />
            {totalCount}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{`${totalCount} security alert${totalCount > 1 ? 's' : ''}`}</TooltipContent>
    </Tooltip>
  )
}
