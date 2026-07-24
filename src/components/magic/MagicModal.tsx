import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  GitCommitHorizontal,
  GitBranchPlus,
  GitMerge,
  GitPullRequest,
  GitPullRequestArrow,
  Eye,
  FileText,
  MessageSquare,
  Wand2,
  BookmarkPlus,
  FolderOpen,
  Bug,
  RefreshCw,
  Sparkles,
  Undo2,
  Link2,
  Megaphone,
  Bot,
  Shield,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useWorktree, useProjects } from '@/services/projects'
import { useLoadedIssueContexts, useLoadedPRContexts } from '@/services/github'
import { usePreferences } from '@/services/preferences'
import { invoke, listen } from '@/lib/transport'
import { generateId } from '@/lib/uuid'
import { openExternal } from '@/lib/platform'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  gitPush,
  triggerImmediateGitPoll,
  fetchWorktreesStatus,
  performGitPull,
  performGitPullUpstream,
} from '@/services/git-status'
import type {
  CreateCommitResponse,
  RevertCommitResponse,
  CreatePrResponse,
  DetectPrResponse,
  MergeConflictsResponse,
  MergePrResponse,
  ReviewJob,
  StartReviewJobResponse,
  Worktree,
} from '@/types/projects'
import type { Session } from '@/types/chat'
import type { PrDisplayStatus, PrStatusEvent } from '@/types/pr-status'
import {
  DEFAULT_AUTOMATE_GITHUB_BUGS_PROMPT,
  DEFAULT_AUTOMATE_SECURITY_ADVISORIES_PROMPT,
  DEFAULT_RESOLVE_CONFLICTS_PROMPT,
  resolveMagicPromptProvider,
} from '@/types/preferences'
import { useRemotePicker } from '@/hooks/useRemotePicker'
import { chatQueryKeys } from '@/services/chat'
import { agentBoardQueryKeys } from '@/services/agent-board'
import { prStatusQueryKeys } from '@/services/pr-status'
import { projectsQueryKeys } from '@/services/projects'
import { useQueryClient } from '@tanstack/react-query'
import { ReviewMethodModal } from '@/components/chat/ReviewMethodModal'

type MagicOption =
  | 'save-context'
  | 'load-context'
  | 'linked-projects'
  | 'fork-session'
  | 'create-recap'
  | 'commit'
  | 'commit-and-push'
  | 'pull'
  | 'pull-upstream'
  | 'push'
  | 'open-pr'
  | 'draft-pr'
  | 'update-pr'
  | 'ready-for-review'
  | 'review'
  | 'merge'
  | 'resolve-conflicts'
  | 'release-notes'
  | 'release-post'
  | 'investigate-issue'
  | 'investigate-pr'
  | 'automate-github-bugs'
  | 'automate-security-advisories'
  | 'merge-pr'
  | 'review-comments'
  | 'revert-last-commit'

type ReviewSource = 'ai' | 'coderabbit-cli' | 'coderabbit-pr'

interface TriggerCodeRabbitPrReviewResponse {
  pr_number: number
  pr_url: string
  comment_body: string
}

/** Options that work on canvas without an open session (git-only operations) */
const CANVAS_ALLOWED_OPTIONS = new Set<MagicOption>([
  'create-recap',
  'commit',
  'commit-and-push',
  'revert-last-commit',
  'pull',
  'pull-upstream',
  'push',
  'open-pr',
  'draft-pr',
  'update-pr',
  'review',
  'review-comments',
  'release-notes',
  'release-post',
  'merge',
  'merge-pr',
  'ready-for-review',
  'resolve-conflicts',
  'linked-projects',
  'automate-github-bugs',
  'automate-security-advisories',
])

/** Canvas options that navigate to worktree chat and dispatch a magic-command event */
const CANVAS_NAVIGATE_AND_DISPATCH_OPTIONS = new Set<MagicOption>(['merge'])

interface MagicOptionItem {
  id: MagicOption
  label: string
  icon: typeof GitCommitHorizontal
  key: string
}

interface MagicSection {
  header: string
  options: MagicOptionItem[]
}

interface MagicColumns {
  left: MagicSection[]
  right: MagicSection[]
  all: MagicSection[]
}

function buildMagicColumns(
  hasOpenPr: boolean,
  hasDraftPr: boolean
): MagicColumns {
  const left: MagicSection[] = [
    {
      header: 'Context',
      options: [
        {
          id: 'save-context',
          label: 'Save Context',
          icon: BookmarkPlus,
          key: 'S',
        },
        {
          id: 'load-context',
          label: 'Load Context',
          icon: FolderOpen,
          key: 'L',
        },
        {
          id: 'linked-projects',
          label: 'Linked Projects',
          icon: Link2,
          key: 'K',
        },
        {
          id: 'fork-session',
          label: 'Fork Session',
          icon: GitBranchPlus,
          key: 'B',
        },
        {
          id: 'create-recap',
          label: 'Create Recap',
          icon: Sparkles,
          key: 'T',
        },
      ],
    },
    {
      header: 'Commit',
      options: [
        { id: 'commit', label: 'Commit', icon: GitCommitHorizontal, key: 'C' },
        {
          id: 'commit-and-push',
          label: 'Commit & Push',
          icon: GitCommitHorizontal,
          key: 'P',
        },
        {
          id: 'revert-last-commit',
          label: 'Revert Commit',
          icon: Undo2,
          key: 'Z',
        },
      ],
    },
    {
      header: 'Sync',
      options: [
        { id: 'pull', label: 'Pull', icon: ArrowDownToLine, key: 'D' },
        {
          id: 'pull-upstream',
          label: 'Upstream Pull',
          icon: ArrowDownToLine,
          key: 'H',
        },
        { id: 'push', label: 'Push', icon: ArrowUpToLine, key: 'U' },
      ],
    },
  ]

  const right: MagicSection[] = [
    {
      header: 'Pull Request',
      options: [
        {
          id: 'open-pr',
          label: hasOpenPr ? 'Open' : 'Create',
          icon: GitPullRequest,
          key: 'O',
        },
        ...(!hasOpenPr
          ? [
              {
                id: 'draft-pr' as const,
                label: 'Create Draft',
                icon: GitPullRequest,
                key: 'Y',
              },
            ]
          : []),
        ...(hasDraftPr
          ? [
              {
                id: 'ready-for-review' as const,
                label: 'Ready for Review',
                icon: GitPullRequestArrow,
                key: 'W',
              },
            ]
          : []),
        { id: 'review', label: 'Review', icon: Eye, key: 'R' },
        {
          id: 'review-comments',
          label: 'PR Comments',
          icon: MessageSquare,
          key: 'V',
        },
        { id: 'merge-pr', label: 'Merge', icon: GitMerge, key: 'N' },
      ],
    },
    {
      header: 'Release',
      options: [
        {
          id: 'release-notes',
          label: 'Generate Release Notes',
          icon: FileText,
          key: 'G',
        },
        {
          id: 'release-post',
          label: 'Generate Release Post',
          icon: Megaphone,
          key: 'X',
        },
        {
          id: 'update-pr',
          label: 'Generate PR Description',
          icon: RefreshCw,
          key: 'E',
        },
      ],
    },
    {
      header: 'Automation',
      options: [
        {
          id: 'automate-github-bugs',
          label: 'GitHub Bugs',
          icon: Bot,
          key: 'J',
        },
        {
          id: 'automate-security-advisories',
          label: 'Security Advisories',
          icon: Shield,
          key: 'Q',
        },
      ],
    },
    {
      header: 'Investigate',
      options: [
        { id: 'investigate-issue', label: 'Issue', icon: Bug, key: 'I' },
        {
          id: 'investigate-pr',
          label: 'PR',
          icon: GitPullRequestArrow,
          key: 'A',
        },
      ],
    },
    {
      header: 'Branch',
      options: [
        { id: 'merge', label: 'Merge to Base', icon: GitMerge, key: 'M' },
        {
          id: 'resolve-conflicts',
          label: 'Resolve Conflicts',
          icon: GitMerge,
          key: 'F',
        },
      ],
    },
  ]

  return { left, right, all: [...left, ...right] }
}

/** Keyboard shortcut to option ID mapping */
const KEY_TO_OPTION: Record<string, MagicOption> = {
  s: 'save-context',
  l: 'load-context',
  k: 'linked-projects',
  b: 'fork-session',
  t: 'create-recap',
  c: 'commit',
  p: 'commit-and-push',
  d: 'pull',
  h: 'pull-upstream',
  u: 'push',
  o: 'open-pr',
  y: 'draft-pr',
  e: 'update-pr',
  w: 'ready-for-review',
  r: 'review',
  v: 'review-comments',
  m: 'merge',
  f: 'resolve-conflicts',
  g: 'release-notes',
  x: 'release-post',
  i: 'investigate-issue',
  a: 'investigate-pr',
  j: 'automate-github-bugs',
  q: 'automate-security-advisories',
  n: 'merge-pr',
  z: 'revert-last-commit',
}

export function MagicModal() {
  const { magicModalOpen, setMagicModalOpen, sessionChatModalWorktreeId } =
    useUIStore()
  const selectedWorktreeIdFromProjects = useProjectsStore(
    state => state.selectedWorktreeId
  )
  const activeWorktreeId = useChatStore(state => state.activeWorktreeId)
  // Fall back chain: projects store → chat store → session modal worktree
  // Session modal worktree is set when user opens a session from canvas view
  const selectedWorktreeId =
    selectedWorktreeIdFromProjects ??
    activeWorktreeId ??
    sessionChatModalWorktreeId
  const { data: worktree } = useWorktree(selectedWorktreeId)
  const contentRef = useRef<HTMLDivElement>(null)
  const hasInitializedRef = useRef(false)
  const [selectedOption, setSelectedOption] =
    useState<MagicOption>('save-context')
  const [reviewMethodDialogOpen, setReviewMethodDialogOpen] = useState(false)

  const hasOpenPr = Boolean(worktree?.pr_url)
  const prDisplayStatus = worktree?.cached_pr_status as
    | PrDisplayStatus
    | undefined
  const hasDraftPr = prDisplayStatus === 'draft'

  // Check if worktree has loaded issue/PR contexts (for enabling investigate options)
  // Contexts may be registered under session ID (Load Context) or worktree ID (create_worktree)
  const activeSessionId = useChatStore(state =>
    selectedWorktreeId ? state.activeSessionIds[selectedWorktreeId] : undefined
  )
  const { data: issueContexts } = useLoadedIssueContexts(
    activeSessionId ?? selectedWorktreeId,
    selectedWorktreeId
  )
  const { data: prContexts } = useLoadedPRContexts(
    activeSessionId ?? selectedWorktreeId,
    selectedWorktreeId
  )
  const hasIssueContexts = (issueContexts?.length ?? 0) > 0
  const hasPrContexts = (prContexts?.length ?? 0) > 0

  const sessionModalOpen = useUIStore(state => state.sessionChatModalOpen)
  // Whether MagicModal was opened from ProjectCanvasView (no active chat session)
  const isOnCanvas =
    !useChatStore(state => state.activeWorktreePath) && !sessionModalOpen
  const pickRemoteOrRun = useRemotePicker(worktree?.path)

  // Build columns dynamically based on PR state
  const magicColumns = useMemo(
    () => buildMagicColumns(hasOpenPr, hasDraftPr),
    [hasOpenPr, hasDraftPr]
  )

  // Flatten all options for arrow key navigation
  const allOptions = useMemo(
    () =>
      magicColumns.all.flatMap(section => section.options.map(opt => opt.id)),
    [magicColumns]
  )

  // Reset selection tracking when modal closes
  useEffect(() => {
    if (!magicModalOpen) {
      hasInitializedRef.current = false
    }
  }, [magicModalOpen])

  // Initialize selection when modal opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !hasInitializedRef.current) {
        setSelectedOption(isOnCanvas ? 'commit' : 'save-context')
        hasInitializedRef.current = true
      }
      setMagicModalOpen(open)
    },
    [setMagicModalOpen, isOnCanvas]
  )

  const queryClient = useQueryClient()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const { data: preferences } = usePreferences()
  const { data: projects } = useProjects()
  const project = worktree
    ? projects?.find(p => p.id === worktree.project_id)
    : null

  const syncLocalPrState = useCallback(
    (
      prNumber: number,
      prUrl: string,
      status: Extract<PrDisplayStatus, 'draft' | 'open'>
    ) => {
      if (!selectedWorktreeId || !worktree) return

      queryClient.setQueryData<Worktree | null>(
        [...projectsQueryKeys.all, 'worktree', selectedWorktreeId],
        current =>
          current
            ? {
                ...current,
                pr_number: prNumber,
                pr_url: prUrl,
                cached_pr_status: status,
              }
            : current
      )

      queryClient.setQueryData<Worktree[]>(
        projectsQueryKeys.worktrees(worktree.project_id),
        current =>
          current?.map(item =>
            item.id === selectedWorktreeId
              ? {
                  ...item,
                  pr_number: prNumber,
                  pr_url: prUrl,
                  cached_pr_status: status,
                }
              : item
          ) ?? current
      )

      queryClient.setQueryData<PrStatusEvent | null>(
        prStatusQueryKeys.worktree(selectedWorktreeId),
        current => ({
          worktree_id: selectedWorktreeId,
          pr_number: prNumber,
          pr_url: prUrl,
          state: 'open',
          is_draft: status === 'draft',
          review_decision: current?.review_decision ?? null,
          check_status: current?.check_status ?? null,
          display_status: status,
          mergeable: current?.mergeable ?? null,
          checked_at: Math.floor(Date.now() / 1000),
        })
      )
    },
    [queryClient, selectedWorktreeId, worktree]
  )

  // Direct git execution for when ChatWindow isn't rendered (project canvas)
  const executeGitDirectly = useCallback(
    async (option: MagicOption, reviewSource: ReviewSource = 'ai') => {
      if (!selectedWorktreeId || !worktree?.path) return

      const { setWorktreeLoading, clearWorktreeLoading } =
        useChatStore.getState()

      const doCreatePr = async (draft: boolean) => {
        setWorktreeLoading(selectedWorktreeId, 'pr')
        const branch = worktree.branch ?? ''
        const toastId = toast.loading(
          `${draft ? 'Creating draft PR' : 'Creating PR'} for ${branch}...`
        )

        try {
          const result = await invoke<CreatePrResponse>(
            'create_pr_with_ai_content',
            {
              worktreePath: worktree.path,
              sessionId: activeSessionId,
              customPrompt: preferences?.magic_prompts?.pr_content,
              model: preferences?.magic_prompt_models?.pr_content_model,
              customProfileName: resolveMagicPromptProvider(
                preferences?.magic_prompt_providers,
                'pr_content_provider',
                preferences?.default_provider
              ),
              reasoningEffort:
                preferences?.magic_prompt_efforts?.pr_content_effort ?? null,
              draft,
            }
          )

          syncLocalPrState(
            result.pr_number,
            result.pr_url,
            result.is_draft ? 'draft' : 'open'
          )
          queryClient.invalidateQueries({
            queryKey: projectsQueryKeys.worktrees(worktree.project_id),
          })
          queryClient.invalidateQueries({
            queryKey: [
              ...projectsQueryKeys.all,
              'worktree',
              selectedWorktreeId,
            ],
          })
          queryClient.invalidateQueries({ queryKey: agentBoardQueryKeys.all })
          triggerImmediateGitPoll()
          if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
          toast.success(
            result.existing
              ? `PR linked: ${result.title}`
              : `${result.is_draft ? 'Draft PR' : 'PR'} created: ${result.title}`,
            {
              id: toastId,
              action: {
                label: 'Open',
                onClick: () => openExternal(result.pr_url),
              },
            }
          )
        } catch (error) {
          toast.error(`Failed to create ${draft ? 'draft ' : ''}PR: ${error}`, {
            id: toastId,
          })
        } finally {
          clearWorktreeLoading(selectedWorktreeId)
        }
      }

      const doCommit = async (isPush: boolean, remote?: string) => {
        setWorktreeLoading(selectedWorktreeId, 'commit')
        const branch = worktree.branch ?? ''
        const { gitDiffSelectedFiles, clearGitDiffSelectedFiles } =
          useUIStore.getState()
        const specificFiles =
          gitDiffSelectedFiles.size > 0
            ? Array.from(gitDiffSelectedFiles)
            : null
        const toastId = toast.loading(
          isPush
            ? `Committing and pushing on ${branch}...`
            : `Creating commit on ${branch}...`
        )
        try {
          const result = await invoke<CreateCommitResponse>(
            'create_commit_with_ai',
            {
              worktreePath: worktree.path,
              customPrompt: preferences?.magic_prompts?.commit_message,
              push: isPush,
              remote: remote ?? null,
              prNumber: isPush ? (worktree.pr_number ?? null) : null,
              model: preferences?.magic_prompt_models?.commit_message_model,
              customProfileName: resolveMagicPromptProvider(
                preferences?.magic_prompt_providers,
                'commit_message_provider',
                preferences?.default_provider
              ),
              reasoningEffort:
                preferences?.magic_prompt_efforts?.commit_message_effort ??
                null,
              specificFiles,
            }
          )
          clearGitDiffSelectedFiles()
          triggerImmediateGitPoll()
          window.dispatchEvent(new CustomEvent('git-commit-completed'))
          if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
          if (result.push_fell_back) {
            toast.warning(
              'Could not push to PR branch, pushed to new branch instead',
              {
                id: toastId,
              }
            )
          } else if (result.commit_hash) {
            const prefix = isPush ? 'Committed and pushed' : 'Committed'
            toast.success(`${prefix}: ${result.message.split('\n')[0]}`, {
              id: toastId,
            })
          } else {
            toast.success('Pushed to remote', { id: toastId })
          }
        } catch (error) {
          toast.error(`Failed: ${error}`, { id: toastId })
        } finally {
          clearWorktreeLoading(selectedWorktreeId)
        }
      }

      switch (option) {
        case 'commit': {
          await doCommit(false)
          break
        }
        case 'commit-and-push': {
          if (worktree.pr_number) {
            await doCommit(true)
          } else {
            await pickRemoteOrRun(remote => doCommit(true, remote))
          }
          break
        }
        case 'revert-last-commit': {
          const revertToastId = toast.loading('Reverting last commit...')
          try {
            const result = await invoke<RevertCommitResponse>(
              'revert_last_local_commit',
              { worktreePath: worktree.path }
            )
            triggerImmediateGitPoll()
            if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
            toast.success(`Reverted: ${result.commit_message}`, {
              id: revertToastId,
            })
          } catch (error) {
            toast.error(`Failed to revert: ${error}`, { id: revertToastId })
          }
          break
        }
        case 'pull': {
          await pickRemoteOrRun(async remote => {
            await performGitPull({
              worktreeId: selectedWorktreeId,
              worktreePath: worktree.path,
              baseBranch:
                worktree.base_branch ?? project?.default_branch ?? 'main',
              branchLabel: worktree.branch,
              projectId: worktree.project_id ?? undefined,
              remote,
              onMergeConflict: () => executeGitDirectly('resolve-conflicts'),
            })
          })
          break
        }
        case 'pull-upstream': {
          await performGitPullUpstream({
            worktreeId: selectedWorktreeId,
            worktreePath: worktree.path,
            branchLabel: worktree.branch,
            projectId: worktree.project_id ?? undefined,
            onMergeConflict: () => executeGitDirectly('resolve-conflicts'),
          })
          break
        }
        case 'push': {
          const doPush = async (remote?: string) => {
            const toastId = toast.loading(`Pushing ${worktree.branch}...`)
            try {
              const result = await gitPush(
                worktree.path,
                worktree.pr_number,
                remote
              )
              triggerImmediateGitPoll()
              if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
              if (result.fellBack) {
                toast.warning(
                  'Could not push to PR branch, pushed to new branch instead',
                  { id: toastId }
                )
              } else {
                toast.success('Changes pushed', { id: toastId })
              }
            } catch (error) {
              toast.error(`Push failed: ${error}`, { id: toastId })
            }
          }
          if (worktree.pr_number) {
            await doPush()
          } else {
            await pickRemoteOrRun(doPush)
          }
          break
        }
        case 'open-pr': {
          if (worktree.pr_url) {
            await openExternal(worktree.pr_url)
            return
          }
          await doCreatePr(false)
          break
        }
        case 'draft-pr': {
          if (worktree.pr_url) {
            toast.error('A PR is already linked to this worktree')
            return
          }
          await doCreatePr(true)
          break
        }
        case 'ready-for-review': {
          if (!worktree.pr_number || !hasDraftPr) {
            toast.error('No draft PR linked to this worktree')
            return
          }
          setWorktreeLoading(selectedWorktreeId, 'pr')
          const toastId = toast.loading('Marking draft PR ready for review...')
          try {
            await invoke('mark_pr_ready_for_review', {
              worktreeId: selectedWorktreeId,
            })
            if (worktree.pr_url) {
              syncLocalPrState(worktree.pr_number, worktree.pr_url, 'open')
            }
            queryClient.invalidateQueries({
              queryKey: projectsQueryKeys.worktrees(worktree.project_id),
            })
            queryClient.invalidateQueries({
              queryKey: [
                ...projectsQueryKeys.all,
                'worktree',
                selectedWorktreeId,
              ],
            })
            toast.success('PR marked ready for review', { id: toastId })
          } catch (error) {
            toast.error(`Failed to mark PR ready for review: ${error}`, {
              id: toastId,
            })
          } finally {
            clearWorktreeLoading(selectedWorktreeId)
          }
          break
        }
        case 'merge-pr': {
          if (!worktree.pr_number) {
            toast.error('No PR open for this worktree')
            return
          }
          const mergePrToastId = toast.loading('Merging PR...')
          try {
            const result = await invoke<MergePrResponse>('merge_github_pr', {
              worktreePath: worktree.path,
            })
            toast.success(result.message, { id: mergePrToastId })

            // Archive or delete the worktree (same as auto-archive on merge)
            const shouldDelete = preferences?.removal_behavior === 'delete'
            const action = shouldDelete ? 'Deleting' : 'Archiving'
            const cleanupToastId = toast.loading(`${action} worktree...`)
            try {
              await invoke(
                shouldDelete ? 'delete_worktree' : 'archive_worktree',
                {
                  worktreeId: selectedWorktreeId,
                }
              )
              queryClient.invalidateQueries({
                queryKey: projectsQueryKeys.worktrees(worktree.project_id),
              })
              triggerImmediateGitPoll()
              if (worktree.project_id) fetchWorktreesStatus(worktree.project_id)
              const pastAction = shouldDelete ? 'Deleted' : 'Archived'
              toast.success(`${pastAction} "${worktree.name}"`, {
                id: cleanupToastId,
              })
            } catch (cleanupError) {
              toast.error(
                `Failed to ${action.toLowerCase()} worktree: ${cleanupError}`,
                {
                  id: cleanupToastId,
                }
              )
            }
          } catch (error) {
            toast.error(`Failed to merge PR: ${error}`, { id: mergePrToastId })
          }
          break
        }
        case 'resolve-conflicts': {
          const toastId = toast.loading('Checking for merge conflicts...')
          try {
            const result = await invoke<MergeConflictsResponse>(
              'get_merge_conflicts',
              { worktreeId: selectedWorktreeId }
            )

            let conflictsResult = result
            let sessionName = 'Resolve conflicts'
            let promptIntro = 'I have merge conflicts that need to be resolved.'

            if (
              !conflictsResult.has_conflicts &&
              (worktree.pr_number || worktree.pr_url)
            ) {
              const prResult = await invoke<MergeConflictsResponse>(
                'fetch_and_merge_base',
                { worktreeId: selectedWorktreeId }
              )

              if (!prResult.has_conflicts) {
                toast.success('No conflicts - base branch merged cleanly', {
                  id: toastId,
                })
                triggerImmediateGitPoll()
                return
              }

              conflictsResult = prResult
              sessionName = 'PR: resolve conflicts'
              const baseBranch =
                worktree.base_branch ?? project?.default_branch ?? 'main'
              promptIntro = `I merged \`origin/${baseBranch}\` into this branch to resolve PR conflicts, but there are merge conflicts.`
            }

            if (!conflictsResult.has_conflicts) {
              toast.info('No merge conflicts detected', { id: toastId })
              return
            }

            toast.warning(
              `Found conflicts in ${conflictsResult.conflicts.length} file(s)`,
              {
                id: toastId,
                description: 'Opening conflict resolution session...',
              }
            )

            const {
              registerWorktreePath,
              setActiveSession,
              setInputDraft,
              copySessionSettings,
              activeSessionIds,
            } = useChatStore.getState()
            const currentSessionId = activeSessionIds[selectedWorktreeId]

            const newSession = await invoke<Session>('create_session', {
              worktreeId: selectedWorktreeId,
              worktreePath: worktree.path,
              name: sessionName,
            })

            // Inherit model/mode/thinking settings from current session
            if (currentSessionId)
              copySessionSettings(currentSessionId, newSession.id)

            // Open in SessionChatModal on canvas (not full ChatWindow)
            registerWorktreePath(selectedWorktreeId, worktree.path)
            setActiveSession(selectedWorktreeId, newSession.id)
            window.dispatchEvent(
              new CustomEvent('open-worktree-modal', {
                detail: {
                  worktreeId: selectedWorktreeId,
                  worktreePath: worktree.path,
                },
              })
            )

            // Build conflict resolution prompt
            const conflictFiles = conflictsResult.conflicts.join('\n- ')
            const diffSection = conflictsResult.conflict_diff
              ? `\n\nHere is the diff showing the conflict details:\n\n\`\`\`diff\n${conflictsResult.conflict_diff}\n\`\`\``
              : ''
            const resolveInstructions =
              preferences?.magic_prompts?.resolve_conflicts ??
              DEFAULT_RESOLVE_CONFLICTS_PROMPT

            const conflictPrompt = `${promptIntro}

Conflicts in these files:
- ${conflictFiles}${diffSection}

${resolveInstructions}`

            setInputDraft(newSession.id, conflictPrompt)

            queryClient.invalidateQueries({
              queryKey: chatQueryKeys.sessions(selectedWorktreeId),
            })
          } catch (error) {
            toast.error(`Failed to check conflicts: ${error}`, { id: toastId })
          }
          break
        }
        case 'review': {
          setWorktreeLoading(selectedWorktreeId, 'review')
          const projectName = project?.name ?? 'project'
          const worktreeName = worktree.name ?? worktree.branch ?? ''
          const reviewTarget = `${projectName}/${worktreeName}`
          if (reviewSource === 'coderabbit-pr') {
            const toastId = toast.loading(
              `Triggering CodeRabbit review for ${reviewTarget}...`
            )

            try {
              if (!worktree.pr_number) {
                throw new Error('Open or link a PR in Jean first')
              }

              const result = await invoke<TriggerCodeRabbitPrReviewResponse>(
                'trigger_coderabbit_pr_review',
                {
                  worktreeId: selectedWorktreeId,
                  worktreePath: worktree.path,
                  prNumber: worktree.pr_number,
                }
              )

              if (worktree.project_id) {
                queryClient.invalidateQueries({
                  queryKey: projectsQueryKeys.worktrees(worktree.project_id),
                })
                queryClient.invalidateQueries({
                  queryKey: [
                    ...projectsQueryKeys.all,
                    'worktree',
                    selectedWorktreeId,
                  ],
                })
              }

              toast.success(
                `CodeRabbit review triggered on PR #${result.pr_number}`,
                {
                  id: toastId,
                  action: result.pr_url
                    ? {
                        label: 'Open',
                        onClick: () => openExternal(result.pr_url),
                      }
                    : undefined,
                }
              )
            } catch (error) {
              toast.error(`Failed to trigger CodeRabbit review: ${error}`, {
                id: toastId,
              })
            } finally {
              clearWorktreeLoading(selectedWorktreeId)
            }
            break
          }

          const reviewRunId = generateId()
          const reviewLabel =
            reviewSource === 'coderabbit-cli'
              ? 'CodeRabbit CLI review'
              : 'Review'
          const toastId = toast.loading(
            `Starting ${reviewLabel} for ${reviewTarget}...`
          )

          // Fire-and-forget: detect and link PR if not already linked
          if (!worktree.pr_number) {
            invoke<DetectPrResponse | null>('detect_and_link_pr', {
              worktreeId: selectedWorktreeId,
              worktreePath: worktree.path,
            })
              .then(result => {
                if (result && worktree.project_id) {
                  queryClient.invalidateQueries({
                    queryKey: projectsQueryKeys.worktrees(worktree.project_id),
                  })
                  queryClient.invalidateQueries({
                    queryKey: [
                      ...projectsQueryKeys.all,
                      'worktree',
                      selectedWorktreeId,
                    ],
                  })
                }
              })
              .catch(() => {
                /* noop - PR detection is best-effort */
              })
          }

          try {
            const { job } = await invoke<StartReviewJobResponse>(
              'start_review_job',
              {
                worktreeId: selectedWorktreeId,
                worktreePath: worktree.path,
                source: reviewSource,
                customPrompt: preferences?.magic_prompts?.code_review,
                model: preferences?.magic_prompt_models?.code_review_model,
                customProfileName: resolveMagicPromptProvider(
                  preferences?.magic_prompt_providers,
                  'code_review_provider',
                  preferences?.default_provider
                ),
                reasoningEffort:
                  preferences?.magic_prompt_efforts?.code_review_effort ?? null,
                reviewRunId,
                reviewType: reviewSource === 'coderabbit-cli' ? 'all' : null,
              }
            )

            if (job.sessionId) {
              const { setActiveSession, clearActiveWorktree } =
                useChatStore.getState()
              setActiveSession(selectedWorktreeId, job.sessionId)
              useProjectsStore.getState().selectWorktree(selectedWorktreeId)
              clearActiveWorktree()
              useUIStore
                .getState()
                .markWorktreeForAutoOpenSession(
                  selectedWorktreeId,
                  job.sessionId
                )
              queryClient.invalidateQueries({
                queryKey: chatQueryKeys.sessions(selectedWorktreeId),
              })
              queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
            }

            toast.loading(`${reviewLabel} running for ${reviewTarget}...`, {
              id: toastId,
              cancel: {
                label: 'Cancel',
                onClick: () => {
                  toast.loading(`Cancelling review for ${reviewTarget}...`, {
                    id: toastId,
                  })
                  invoke<boolean>('cancel_review_job', { jobId: job.id }).catch(
                    error => {
                      toast.error(`Failed to cancel review: ${error}`, {
                        id: toastId,
                      })
                    }
                  )
                },
              },
            })

            let unlistenReviewJob: (() => void) | null = null
            let handledTerminalReviewJob = false
            const handleTerminalReviewJob = (reviewJob: ReviewJob) => {
              if (reviewJob.id !== job.id) return
              if (reviewJob.status === 'running') return
              if (handledTerminalReviewJob) return

              handledTerminalReviewJob = true
              unlistenReviewJob?.()
              queryClient.invalidateQueries({
                queryKey: chatQueryKeys.sessions(selectedWorktreeId),
              })
              queryClient.invalidateQueries({ queryKey: ['all-sessions'] })

              if (reviewJob.status === 'completed') {
                const completedSessionId = reviewJob.sessionId
                toast.success(
                  `${reviewLabel} done on ${reviewTarget} (${reviewJob.findingCount ?? 0} findings)`,
                  {
                    id: toastId,
                    action: completedSessionId
                      ? {
                          label: 'Open',
                          onClick: () => {
                            const { setActiveSession, clearActiveWorktree } =
                              useChatStore.getState()
                            useProjectsStore
                              .getState()
                              .selectWorktree(selectedWorktreeId)
                            clearActiveWorktree()
                            setActiveSession(
                              selectedWorktreeId,
                              completedSessionId
                            )
                            setTimeout(() => {
                              window.dispatchEvent(
                                new CustomEvent('open-session-modal', {
                                  detail: {
                                    sessionId: completedSessionId,
                                    worktreeId: selectedWorktreeId,
                                    worktreePath: worktree.path,
                                  },
                                })
                              )
                            }, 50)
                          },
                        }
                      : undefined,
                  }
                )
              } else if (reviewJob.status === 'cancelled') {
                toast.info(`Review cancelled for ${reviewTarget}`, {
                  id: toastId,
                })
              } else {
                toast.error(
                  `Review failed: ${reviewJob.error ?? 'Unknown error'}`,
                  { id: toastId }
                )
              }
            }

            unlistenReviewJob = await listen<ReviewJob>(
              'review-job:updated',
              event => handleTerminalReviewJob(event.payload)
            )
            if (handledTerminalReviewJob) {
              unlistenReviewJob()
            } else {
              const currentJob = await invoke<ReviewJob | null>(
                'get_review_job',
                { jobId: job.id }
              ).catch(() => null)
              if (currentJob) handleTerminalReviewJob(currentJob)
            }
          } catch (error) {
            toast.error(`Failed to start review: ${error}`, { id: toastId })
          } finally {
            clearWorktreeLoading(selectedWorktreeId)
          }
          break
        }
      }
    },
    [
      selectedWorktreeId,
      worktree,
      activeSessionId,
      preferences,
      project,
      queryClient,
      pickRemoteOrRun,
      syncLocalPrState,
      hasDraftPr,
    ]
  )

  const executeAction = useCallback(
    async (option: MagicOption) => {
      // Block disabled options on canvas
      if (isOnCanvas && !CANVAS_ALLOWED_OPTIONS.has(option)) {
        return
      }

      if (option === 'review') {
        if (!selectedWorktreeId || !worktree?.path) {
          notify('No worktree selected', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        setMagicModalOpen(false)
        setReviewMethodDialogOpen(true)
        return
      }

      // Release generation only needs a project selected, not a worktree
      if (option === 'release-notes' || option === 'release-post') {
        if (!selectedProjectId) {
          notify('No project selected', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        useUIStore
          .getState()
          .setReleaseNotesModalMode(
            option === 'release-post' ? 'post' : 'notes'
          )
        useUIStore.getState().setReleaseNotesModalOpen(true)
        setMagicModalOpen(false)
        return
      }

      // linked-projects only needs a project selected, not a worktree
      if (option === 'linked-projects') {
        if (!selectedProjectId) {
          notify('No project selected', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        useUIStore.getState().setLinkedProjectsModalOpen(true)
        setMagicModalOpen(false)
        return
      }

      if (!selectedWorktreeId) {
        notify('No worktree selected', undefined, { type: 'error' })
        setMagicModalOpen(false)
        return
      }

      if (
        option === 'automate-github-bugs' ||
        option === 'automate-security-advisories'
      ) {
        if (!worktree?.path || !worktree.project_id) {
          notify('No worktree selected', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }

        const isBugs = option === 'automate-github-bugs'
        const prompt = (
          isBugs
            ? (preferences?.magic_prompts?.automate_github_bugs ??
              DEFAULT_AUTOMATE_GITHUB_BUGS_PROMPT)
            : (preferences?.magic_prompts?.automate_security_advisories ??
              DEFAULT_AUTOMATE_SECURITY_ADVISORIES_PROMPT)
        ).replaceAll('{projectId}', worktree.project_id)
        const newSession = await invoke<Session>('create_session', {
          worktreeId: selectedWorktreeId,
          worktreePath: worktree.path,
          name: isBugs
            ? 'Automate GitHub bugs'
            : 'Automate security advisories',
        })
        const store = useChatStore.getState()
        store.registerWorktreePath(selectedWorktreeId, worktree.path)
        store.setActiveSession(selectedWorktreeId, newSession.id)
        await invoke('send_chat_message', {
          sessionId: newSession.id,
          worktreeId: selectedWorktreeId,
          worktreePath: worktree.path,
          message: prompt,
          model: isBugs
            ? preferences?.magic_prompt_models.automate_github_bugs_model
            : preferences?.magic_prompt_models
                .automate_security_advisories_model,
          executionMode: 'yolo',
          effortLevel: isBugs
            ? (preferences?.magic_prompt_efforts.automate_github_bugs_effort ??
              undefined)
            : (preferences?.magic_prompt_efforts
                .automate_security_advisories_effort ?? undefined),
          customProfileName: resolveMagicPromptProvider(
            preferences?.magic_prompt_providers,
            isBugs
              ? 'automate_github_bugs_provider'
              : 'automate_security_advisories_provider',
            preferences?.default_provider
          ),
          backend: isBugs
            ? (preferences?.magic_prompt_backends
                ?.automate_github_bugs_backend ?? undefined)
            : (preferences?.magic_prompt_backends
                ?.automate_security_advisories_backend ?? undefined),
        })
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(selectedWorktreeId),
        })
        setMagicModalOpen(false)
        return
      }

      // Create recap: dispatch open-recap event (handled by ChatWindow or canvas hooks)
      if (option === 'create-recap') {
        if (!activeSessionId) {
          toast.info('No active session to create a recap for')
          setMagicModalOpen(false)
          return
        }
        setMagicModalOpen(false)
        window.dispatchEvent(new CustomEvent('open-recap'))
        return
      }

      // Investigate options: guard against missing contexts
      if (option === 'investigate-issue' || option === 'investigate-pr') {
        const type = option === 'investigate-issue' ? 'issue' : 'pr'
        const hasContexts = type === 'issue' ? hasIssueContexts : hasPrContexts
        if (!hasContexts) {
          notify(
            `No ${type === 'issue' ? 'issue' : 'PR'} context loaded for this worktree`,
            undefined,
            { type: 'error' }
          )
          setMagicModalOpen(false)
          return
        }
        window.dispatchEvent(
          new CustomEvent('magic-command', {
            detail: { command: 'investigate', type },
          })
        )
        setMagicModalOpen(false)
        return
      }

      // Update PR description: open the update dialog (requires open PR)
      if (option === 'update-pr') {
        if (!worktree?.pr_number) {
          notify('No PR open for this worktree', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        useUIStore.getState().setUpdatePrModalOpen(true)
        setMagicModalOpen(false)
        return
      }

      // Review Comments: open the review comments dialog (requires open PR)
      if (option === 'review-comments') {
        if (!worktree?.pr_number) {
          notify('No PR linked to this worktree', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        useUIStore.getState().setReviewCommentsModalOpen(true)
        setMagicModalOpen(false)
        return
      }

      // Merge PR on GitHub (requires open PR)
      if (option === 'merge-pr') {
        if (!worktree?.pr_number) {
          notify('No PR open for this worktree', undefined, { type: 'error' })
          setMagicModalOpen(false)
          return
        }
        setMagicModalOpen(false)
        executeGitDirectly('merge-pr')
        return
      }

      if (option === 'draft-pr') {
        if (worktree?.pr_url) {
          notify('A PR is already linked to this worktree', undefined, {
            type: 'error',
          })
          setMagicModalOpen(false)
          return
        }
      }

      if (option === 'ready-for-review') {
        if (!worktree?.pr_number || !hasDraftPr) {
          notify('No draft PR linked to this worktree', undefined, {
            type: 'error',
          })
          setMagicModalOpen(false)
          return
        }
      }

      if (option === 'draft-pr' || option === 'ready-for-review') {
        setMagicModalOpen(false)
        await executeGitDirectly(option)
        return
      }

      // If PR already exists, open it in the browser instead of creating a new one
      if (option === 'open-pr' && worktree?.pr_url) {
        await openExternal(worktree.pr_url)
        setMagicModalOpen(false)
        return
      }

      // Commands that need ChatWindow: navigate to worktree first, then set pending command
      if (
        isOnCanvas &&
        CANVAS_NAVIGATE_AND_DISPATCH_OPTIONS.has(option) &&
        worktree?.path
      ) {
        setMagicModalOpen(false)
        const { setActiveWorktree, setPendingMagicCommand } =
          useChatStore.getState()
        // Navigate to worktree chat view
        useProjectsStore.getState().selectWorktree(selectedWorktreeId)
        setActiveWorktree(selectedWorktreeId, worktree.path)
        // Store pending command — ChatWindow picks it up on mount/update (no fragile timeout)
        setPendingMagicCommand({ command: option })
        return
      }

      // For canvas-allowed git ops: if no ChatWindow rendered, execute directly
      // Exclude CANVAS_NAVIGATE_AND_DISPATCH_OPTIONS to prevent silent no-ops
      if (
        CANVAS_ALLOWED_OPTIONS.has(option) &&
        !CANVAS_NAVIGATE_AND_DISPATCH_OPTIONS.has(option) &&
        !useChatStore.getState().activeWorktreePath
      ) {
        setMagicModalOpen(false)
        executeGitDirectly(option)
        return
      }

      // Dispatch magic command for ChatWindow to handle
      window.dispatchEvent(
        new CustomEvent('magic-command', { detail: { command: option } })
      )

      setMagicModalOpen(false)
    },
    [
      selectedWorktreeId,
      selectedProjectId,
      setMagicModalOpen,
      worktree?.pr_url,
      isOnCanvas,
      executeGitDirectly,
      hasIssueContexts,
      hasPrContexts,
      activeSessionId,
      worktree?.path,
      worktree?.pr_number,
      hasDraftPr,
    ]
  )

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Check for direct key shortcuts (s, l, c, p, r)
      const mappedOption = KEY_TO_OPTION[key]
      if (mappedOption) {
        e.preventDefault()
        executeAction(mappedOption)
        return
      }

      if (key === 'enter') {
        e.preventDefault()
        executeAction(selectedOption)
      } else if (key === 'arrowdown' || key === 'arrowup') {
        e.preventDefault()
        const currentIndex = allOptions.indexOf(selectedOption)
        const newIndex =
          key === 'arrowdown'
            ? (currentIndex + 1) % allOptions.length
            : (currentIndex - 1 + allOptions.length) % allOptions.length
        const newOptionId = allOptions[newIndex]
        if (newOptionId) {
          setSelectedOption(newOptionId)
        }
      }
    },
    [executeAction, selectedOption, allOptions]
  )

  return (
    <>
      <ReviewMethodModal
        open={reviewMethodDialogOpen}
        onOpenChange={setReviewMethodDialogOpen}
        onAiReview={() => executeGitDirectly('review', 'ai')}
        onCodeRabbitCliReview={() =>
          executeGitDirectly('review', 'coderabbit-cli')
        }
        onCodeRabbitPrReview={() =>
          executeGitDirectly('review', 'coderabbit-pr')
        }
        codeRabbitPrAvailable={Boolean(worktree?.pr_number)}
      />
      <Dialog open={magicModalOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          ref={contentRef}
          tabIndex={-1}
          className="sm:max-w-[560px] p-0 outline-none"
          onOpenAutoFocus={e => {
            e.preventDefault()
            contentRef.current?.focus()
          }}
          onKeyDown={handleKeyDown}
        >
          <DialogHeader className="px-4 pt-5 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              Magic
            </DialogTitle>
          </DialogHeader>

          <div className="pb-2 grid grid-cols-2">
            {[magicColumns.left, magicColumns.right].map(
              (columnSections, colIndex) => (
                <div
                  key={colIndex}
                  className={cn(colIndex === 0 && 'border-r border-border')}
                >
                  {columnSections.map((section, sectionIndex) => (
                    <div key={section.header}>
                      {/* Section header */}
                      <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {section.header}
                      </div>

                      {/* Section options */}
                      {section.options.map(option => {
                        const Icon = option.icon
                        const isSelected = selectedOption === option.id
                        const isDisabled =
                          (isOnCanvas &&
                            !CANVAS_ALLOWED_OPTIONS.has(option.id)) ||
                          (option.id === 'create-recap' && !activeSessionId) ||
                          (option.id === 'investigate-issue' &&
                            !hasIssueContexts) ||
                          (option.id === 'investigate-pr' && !hasPrContexts) ||
                          (option.id === 'draft-pr' && hasOpenPr) ||
                          (option.id === 'update-pr' && !hasOpenPr) ||
                          (option.id === 'ready-for-review' && !hasDraftPr) ||
                          (option.id === 'review-comments' && !hasOpenPr) ||
                          (option.id === 'merge-pr' && !hasOpenPr)

                        return (
                          <button
                            key={option.id}
                            onClick={() =>
                              !isDisabled && executeAction(option.id)
                            }
                            onMouseEnter={() => setSelectedOption(option.id)}
                            className={cn(
                              'w-full flex items-center justify-between px-4 py-2 text-sm transition-colors',
                              'focus:outline-none',
                              isDisabled
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-accent',
                              isSelected && !isDisabled && 'bg-accent'
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span>{option.label}</span>
                            </div>
                            <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {option.key}
                            </kbd>
                          </button>
                        )
                      })}

                      {/* Separator between sections within column (not after last) */}
                      {sectionIndex < columnSections.length - 1 && (
                        <div className="my-1 mx-4 border-t border-border" />
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default MagicModal
