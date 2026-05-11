import { useEffect, useMemo, useState } from 'react'
import { GitBranch, GitBranchPlus, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  useProjectBranches,
  useSwitchWorktreeBaseBranch,
} from '@/services/projects'
import type { Worktree } from '@/types/projects'

interface SwitchBaseBranchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  worktree: Worktree
  projectId: string
  defaultBranch: string
}

export function SwitchBaseBranchDialog({
  open,
  onOpenChange,
  worktree,
  projectId,
  defaultBranch,
}: SwitchBaseBranchDialogProps) {
  const [query, setQuery] = useState('')
  const [selectedBranch, setSelectedBranch] = useState('')
  const [mode, setMode] = useState<'metadata' | 'rebase'>('metadata')
  const {
    data: branches = [],
    isLoading,
    isRefetching,
    refetch,
  } = useProjectBranches(open ? projectId : null)
  const switchBaseBranch = useSwitchWorktreeBaseBranch()

  const currentBaseBranch = worktree.base_branch ?? defaultBranch

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedBranch('')
    setMode('metadata')
  }, [open])

  const branchOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return branches
      .filter(branch => branch !== worktree.branch)
      .filter(branch =>
        normalizedQuery ? branch.toLowerCase().includes(normalizedQuery) : true
      )
  }, [branches, query, worktree.branch])

  const canSubmit =
    selectedBranch.length > 0 &&
    selectedBranch !== currentBaseBranch &&
    !switchBaseBranch.isPending

  const handleSubmit = async () => {
    if (!canSubmit) return
    await switchBaseBranch.mutateAsync({
      worktreeId: worktree.id,
      projectId,
      baseBranch: selectedBranch,
      rebase: mode === 'rebase',
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranchPlus className="h-4 w-4" />
            Switch Base Branch
          </DialogTitle>
          <DialogDescription>
            Current base: {currentBaseBranch}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 p-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search branches..."
              className="h-8"
              autoFocus
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              aria-label="Refresh branches"
            >
              <RefreshCw
                className={cn('h-4 w-4', isRefetching && 'animate-spin')}
              />
            </Button>
          </div>

          <ScrollArea className="h-48 rounded-md border">
            {isLoading ? (
              <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading branches...
              </div>
            ) : branchOptions.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No branches found
              </div>
            ) : (
              <div className="p-1">
                {branchOptions.map(branch => {
                  const isCurrent = branch === currentBaseBranch
                  const isSelected = branch === selectedBranch
                  return (
                    <button
                      key={branch}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => setSelectedBranch(branch)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm transition-colors',
                        isSelected && 'bg-accent text-accent-foreground',
                        isCurrent
                          ? 'cursor-default text-muted-foreground opacity-60'
                          : 'hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{branch}</span>
                      {isCurrent && (
                        <span className="text-xs text-muted-foreground">
                          Current
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          <RadioGroup
            value={mode}
            onValueChange={value => setMode(value as 'metadata' | 'rebase')}
            className="grid gap-2"
          >
            <Label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <RadioGroupItem value="metadata" className="mt-0.5" />
              <span className="grid gap-1">
                <span className="text-sm font-medium">Update base</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Update comparisons, pulls, and PR target without rewriting
                  commits.
                </span>
              </span>
            </Label>
            <Label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <RadioGroupItem value="rebase" className="mt-0.5" />
              <span className="grid gap-1">
                <span className="text-sm font-medium">Update and rebase</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Rebase this branch onto the selected base and force-push with
                  lease.
                </span>
              </span>
            </Label>
          </RadioGroup>
        </div>

        <DialogFooter className="border-t px-4 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {switchBaseBranch.isPending ? 'Switching...' : 'Switch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
