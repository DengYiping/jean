import { memo, useCallback, useState, type CSSProperties } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Check,
  GripVertical,
  Pencil,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MessageSettingsBadges } from '@/components/chat/MessageSettingsBadges'
import type { QueuedMessage } from '@/types/chat'

interface SortableQueuedMessageItemProps {
  message: QueuedMessage
  index: number
  sessionId: string
  onRemove: (sessionId: string, messageId: string) => void
  onEdit: (sessionId: string, messageId: string, message: string) => void
  onSteer: (sessionId: string, messageId: string) => void
}

const SortableQueuedMessageItem = memo(function SortableQueuedMessageItem({
  message,
  index,
  sessionId,
  onRemove,
  onEdit,
  onSteer,
}: SortableQueuedMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(message.message)
  const skillCount =
    message.skills?.length ?? message.pendingSkills?.length ?? 0
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: message.id,
  })

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 2 : 0,
  }

  const handleRemove = useCallback(() => {
    onRemove(sessionId, message.id)
  }, [message.id, onRemove, sessionId])

  const handleSteer = useCallback(() => {
    onSteer(sessionId, message.id)
  }, [message.id, onSteer, sessionId])

  const handleStartEdit = useCallback(() => {
    setDraft(message.message)
    setIsEditing(true)
  }, [message.message])

  const handleCancelEdit = useCallback(() => {
    setDraft(message.message)
    setIsEditing(false)
  }, [message.message])

  const handleSaveEdit = useCallback(() => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (trimmed !== message.message) {
      onEdit(sessionId, message.id, trimmed)
    }
    setIsEditing(false)
  }, [draft, message.id, message.message, onEdit, sessionId])

  const isMagicCommand = message.kind === 'magic_command'
  const displayMessage = isMagicCommand
    ? `Magic: ${message.magicCommandLabel ?? message.message}`
    : message.message

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          'rounded-xl border border-border/70 bg-background/85 px-2.5 py-1.5 shadow-sm transition-shadow',
          isDragging && 'shadow-lg'
        )}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Reorder queued message ${index + 1}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>

          <div className="min-w-0 flex-1">
            {isEditing ? (
              <textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                className="min-h-16 w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                aria-label={`Edit queued message ${index + 1}`}
                autoFocus
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="truncate text-sm">
                  {displayMessage.length > 120
                    ? `${displayMessage.slice(0, 120)}...`
                    : displayMessage}
                </span>

                {message.pendingImages.length > 0 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {message.pendingImages.length} img
                  </span>
                )}

                {(message.pendingFiles.length > 0 ||
                  skillCount > 0 ||
                  message.pendingTextFiles.length > 0) && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {message.pendingFiles.length +
                      skillCount +
                      message.pendingTextFiles.length}{' '}
                    file(s)
                  </span>
                )}
              </div>
            )}

            {!isMagicCommand && !isEditing && (
              <div className="mt-1">
                <MessageSettingsBadges
                  model={message.model}
                  executionMode={message.executionMode}
                  thinkingLevel={message.thinkingLevel}
                  effortLevel={message.effortLevel}
                  isCursor={message.model.startsWith('cursor/')}
                />
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {isEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                  aria-label={`Save queued message ${index + 1}`}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`Cancel editing queued message ${index + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                {!isMagicCommand && (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`Edit queued message ${index + 1}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {!isMagicCommand && (
                  <button
                    type="button"
                    onClick={handleSteer}
                    className="rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <span className="inline-flex items-center gap-1">
                      <WandSparkles className="h-3 w-3" />
                      <span>Steer</span>
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleRemove}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                  aria-label={`Delete queued message ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

interface QueuedMessagesListProps {
  messages: QueuedMessage[]
  sessionId: string
  onRemove: (sessionId: string, messageId: string) => void
  onReorder: (sessionId: string, messages: QueuedMessage[]) => void
  onEdit: (sessionId: string, messageId: string, message: string) => void
  onSteer: (sessionId: string, messageId: string) => void
}

export const QueuedMessagesList = memo(function QueuedMessagesList({
  messages,
  sessionId,
  onRemove,
  onReorder,
  onEdit,
  onSteer,
}: QueuedMessagesListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = messages.findIndex(message => message.id === active.id)
      const newIndex = messages.findIndex(message => message.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      onReorder(sessionId, arrayMove(messages, oldIndex, newIndex))
    },
    [messages, onReorder, sessionId]
  )

  if (messages.length === 0) return null

  return (
    <div className="border-b border-border/70 bg-muted/20 px-4 py-2 md:px-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={messages.map(message => message.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1.5">
            {messages.map((message, index) => (
              <SortableQueuedMessageItem
                key={message.id}
                message={message}
                index={index}
                sessionId={sessionId}
                onRemove={onRemove}
                onEdit={onEdit}
                onSteer={onSteer}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
})
