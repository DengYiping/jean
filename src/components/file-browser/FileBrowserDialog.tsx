import { useMemo, useState } from 'react'
import { File, FolderTree } from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useWorktree } from '@/services/projects'
import { useWorktreeFiles } from '@/services/files'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileContentModal } from '@/components/chat/FileContentModal'

export function FileBrowserDialog() {
  const open = useUIStore(state => state.fileBrowserOpen)
  const setOpen = useUIStore(state => state.setFileBrowserOpen)
  const worktreeId = useProjectsStore(state => state.selectedWorktreeId)
  const { data: worktree } = useWorktree(worktreeId)
  const { data: files = [] } = useWorktreeFiles(worktree?.path ?? null)
  const [query, setQuery] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const matchingFiles = useMemo(
    () =>
      files.filter(file =>
        file.relative_path.toLowerCase().includes(query.toLowerCase())
      ),
    [files, query]
  )

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderTree className="size-4" />
              Files
            </DialogTitle>
          </DialogHeader>
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Filter files"
            autoFocus
          />
          <ScrollArea className="h-[60vh]">
            <div className="space-y-1 pr-3">
              {matchingFiles.map(file => (
                <button
                  key={file.relative_path}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() =>
                    setFilePath(`${worktree?.path}/${file.relative_path}`)
                  }
                >
                  <File className="size-3.5 shrink-0 text-muted-foreground" />
                  {file.relative_path}
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <FileContentModal filePath={filePath} onClose={() => setFilePath(null)} />
    </>
  )
}
