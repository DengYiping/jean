import type { QueuedMessage } from '@/types/chat'
import { appendSkillPromptContext } from '@/lib/skill-prompt'

/**
 * Build the message text Jean sends for a queued item, including attachment refs.
 */
export function buildQueuedMessageWithRefs(queuedMsg: QueuedMessage): string {
  let message = appendSkillPromptContext(
    queuedMsg.message,
    queuedMsg.pendingSkills
  )

  if (queuedMsg.pendingFiles.length > 0) {
    const fileRefs = queuedMsg.pendingFiles
      .map(file =>
        file.isDirectory
          ? `[Directory: ${file.relativePath} - Use Glob and Read tools to explore this directory]`
          : `[File: ${file.relativePath} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = message ? `${message}\n\n${fileRefs}` : fileRefs
  }

  if (queuedMsg.pendingImages.length > 0) {
    const imageRefs = queuedMsg.pendingImages
      .map(
        image =>
          `[Image attached: ${image.path} - Use the Read tool to view this image]`
      )
      .join('\n')
    message = message ? `${message}\n\n${imageRefs}` : imageRefs
  }

  if (queuedMsg.pendingTextFiles.length > 0) {
    const textFileRefs = queuedMsg.pendingTextFiles
      .map(
        file =>
          `[Text file attached: ${file.path} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = message ? `${message}\n\n${textFileRefs}` : textFileRefs
  }

  return message
}

export function areQueuedMessageIdsEqual(
  left: QueuedMessage[],
  right: QueuedMessage[]
): boolean {
  if (left.length !== right.length) return false
  return left.every((message, index) => message.id === right[index]?.id)
}
