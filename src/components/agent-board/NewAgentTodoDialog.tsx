import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateAgentBoardItem } from '@/services/agent-board'
import type { Backend, EffortLevel } from '@/types/chat'
import type { Project } from '@/types/projects'

interface NewAgentTodoDialogProps {
  open: boolean
  projects: Project[]
  onOpenChange: (open: boolean) => void
}

export function NewAgentTodoDialog({
  open,
  projects,
  onOpenChange,
}: NewAgentTodoDialogProps) {
  const createItem = useCreateAgentBoardItem()
  const realProjects = projects.filter(project => !project.is_folder)
  const [projectId, setProjectId] = useState('')
  const [backend, setBackend] = useState<Backend>('codex')
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (open && !projectId && realProjects[0]) {
      setProjectId(realProjects[0].id)
    }
  }, [open, projectId, realProjects])

  const handleSubmit = useCallback(async () => {
    if (!projectId || !prompt.trim() || createItem.isPending) return
    try {
      await createItem.mutateAsync({
        project_id: projectId,
        prompt: prompt.trim(),
        backend,
        effort_level: effortLevel,
      })
      setPrompt('')
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to create todo: ${error}`)
    }
  }, [backend, createItem, effortLevel, onOpenChange, projectId, prompt])

  const handlePromptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New agent todo</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Textarea
            className="min-h-32 resize-none"
            placeholder="Describe the work..."
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
          />
          <div className="grid grid-cols-3 gap-2">
            <NativeSelect
              value={projectId}
              onChange={event => setProjectId(event.target.value)}
            >
              {realProjects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={backend}
              onChange={event => setBackend(event.target.value as Backend)}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
              <option value="opencode">OpenCode</option>
            </NativeSelect>
            <NativeSelect
              value={effortLevel}
              onChange={event =>
                setEffortLevel(event.target.value as EffortLevel)
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!projectId || !prompt.trim() || createItem.isPending}
          >
            {createItem.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
