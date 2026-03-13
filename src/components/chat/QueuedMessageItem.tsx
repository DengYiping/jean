import { memo, useCallback, type CSSProperties } from 'react'
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
  Brain,
  ClipboardList,
  Clock,
  GripVertical,
  Hammer,
  Sparkles,
  Trash2,
  WandSparkles,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ImageLightbox } from '@/components/chat/ImageLightbox'
import type { QueuedMessage } from '@/types/chat'
import {
  MODEL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  EFFORT_LEVEL_OPTIONS,
} from '@/components/chat/ChatToolbar'

interface SortableQueuedMessageItemProps {
  message: QueuedMessage
  index: number
  sessionId: string
  onRemove: (sessionId: string, messageId: string) => void
  onSteer: (sessionId: string, messageId: string) => void
}

const SortableQueuedMessageItem = memo(function SortableQueuedMessageItem({
  message,
  index,
  sessionId,
  onRemove,
  onSteer,
}: SortableQueuedMessageItemProps) {
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

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          'rounded-2xl border border-border/70 bg-background/85 px-3 py-2.5 shadow-sm transition-shadow',
          isDragging && 'shadow-lg'
        )}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Reorder queued message ${index + 1}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <Clock className="h-3 w-3" />
                <span>Queued #{index + 1}</span>
              </span>
            </div>

            <div className="mt-2 text-sm break-words">
              {message.message.length > 240
                ? `${message.message.slice(0, 240)}...`
                : message.message}
            </div>

            {message.pendingImages.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {message.pendingImages.map((image, imageIndex) => (
                  <ImageLightbox
                    key={`${message.id}-img-${imageIndex}`}
                    src={image.path}
                    alt={`Attached image ${imageIndex + 1}`}
                    thumbnailClassName="h-16 max-w-28 rounded border border-border/60 object-contain"
                  />
                ))}
              </div>
            )}

            {(message.pendingFiles.length > 0 ||
              message.pendingSkills.length > 0 ||
              message.pendingTextFiles.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {message.pendingFiles.length > 0 && (
                  <span>{message.pendingFiles.length} file(s)</span>
                )}
                {message.pendingSkills.length > 0 && (
                  <span>{message.pendingSkills.length} skill(s)</span>
                )}
                {message.pendingTextFiles.length > 0 && (
                  <span>{message.pendingTextFiles.length} text file(s)</span>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Sparkles className="h-2.5 w-2.5" />
                {MODEL_OPTIONS.find(option => option.value === message.model)
                  ?.label ?? message.model}
              </span>

              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
                  message.executionMode === 'plan' &&
                    'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300',
                  message.executionMode === 'build' &&
                    'bg-muted/80 text-muted-foreground',
                  message.executionMode === 'yolo' &&
                    'bg-red-500/20 text-red-700 dark:text-red-300'
                )}
              >
                {message.executionMode === 'plan' && (
                  <ClipboardList className="h-2.5 w-2.5" />
                )}
                {message.executionMode === 'build' && (
                  <Hammer className="h-2.5 w-2.5" />
                )}
                {message.executionMode === 'yolo' && (
                  <Zap className="h-2.5 w-2.5" />
                )}
                <span className="capitalize">{message.executionMode}</span>
              </span>

              {message.effortLevel ? (
                <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Brain className="h-2.5 w-2.5" />
                  {
                    EFFORT_LEVEL_OPTIONS.find(
                      option => option.value === message.effortLevel
                    )?.label
                  }
                </span>
              ) : message.thinkingLevel !== 'off' ? (
                <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Brain className="h-2.5 w-2.5" />
                  {
                    THINKING_LEVEL_OPTIONS.find(
                      option => option.value === message.thinkingLevel
                    )?.label
                  }
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleSteer}
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <span className="inline-flex items-center gap-1">
                <WandSparkles className="h-3.5 w-3.5" />
                <span>Steer</span>
              </span>
            </button>

            <button
              type="button"
              onClick={handleRemove}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
              aria-label={`Delete queued message ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
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
  onSteer: (sessionId: string, messageId: string) => void
}

export const QueuedMessagesList = memo(function QueuedMessagesList({
  messages,
  sessionId,
  onRemove,
  onReorder,
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
    <div className="border-b border-border/70 bg-muted/20 px-4 py-3 md:px-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Queued Messages
        </div>
        <div className="text-xs text-muted-foreground">
          Drag to reorder. Steer sends this next.
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={messages.map(message => message.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {messages.map((message, index) => (
              <SortableQueuedMessageItem
                key={message.id}
                message={message}
                index={index}
                sessionId={sessionId}
                onRemove={onRemove}
                onSteer={onSteer}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
})
