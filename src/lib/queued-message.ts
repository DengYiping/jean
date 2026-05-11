import {
  appendSkillPromptContext,
  type SkillPromptInput,
} from '@/lib/skill-prompt'
import type {
  PendingFile,
  PendingImage,
  PendingTextFile,
  QueuedMessage,
} from '@/types/chat'

const IMAGE_ONLY_DEFAULT_PROMPT =
  'Please check this image and tell me what is wrong.'
const TEXT_ONLY_DEFAULT_PROMPT = 'Please check the attached text as reference.'

interface MessageWithAttachmentRefsInput {
  message: string
  pendingFiles: PendingFile[]
  pendingImages: PendingImage[]
  pendingTextFiles: PendingTextFile[]
  skills: SkillPromptInput[]
}

export function buildMessageWithAttachmentRefs({
  message: rawMessage,
  pendingFiles,
  pendingImages,
  pendingTextFiles,
  skills,
}: MessageWithAttachmentRefsInput): string {
  let message = appendSkillPromptContext(rawMessage, skills)

  if (pendingFiles.length > 0) {
    const fileRefs = pendingFiles
      .map(file =>
        file.isDirectory
          ? `[Directory: ${file.relativePath} - Use Glob and Read tools to explore this directory]`
          : `[File: ${file.relativePath} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = message ? `${message}\n\n${fileRefs}` : fileRefs
  }

  if (pendingImages.length > 0) {
    if (!message) {
      message = IMAGE_ONLY_DEFAULT_PROMPT
    }
    const imageRefs = pendingImages
      .map(
        image =>
          `[Image attached: ${image.path} - Use the Read tool to view this image]`
      )
      .join('\n')
    message = `${message}\n\n${imageRefs}`
  }

  if (pendingTextFiles.length > 0) {
    if (!message) {
      message = TEXT_ONLY_DEFAULT_PROMPT
    }
    const textFileRefs = pendingTextFiles
      .map(
        file =>
          `[Text file attached: ${file.path} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = `${message}\n\n${textFileRefs}`
  }

  return message
}

/**
 * Build the message text Jean sends for a queued item, including attachment refs.
 */
export function buildQueuedMessageWithRefs(queuedMsg: QueuedMessage): string {
  const skills = queuedMsg.skills ?? queuedMsg.pendingSkills ?? []
  return buildMessageWithAttachmentRefs({
    message: queuedMsg.message,
    pendingFiles: queuedMsg.pendingFiles,
    pendingImages: queuedMsg.pendingImages,
    pendingTextFiles: queuedMsg.pendingTextFiles,
    skills,
  })
}

export function areQueuedMessageIdsEqual(
  left: QueuedMessage[],
  right: QueuedMessage[]
): boolean {
  if (left.length !== right.length) return false
  return left.every((message, index) => message.id === right[index]?.id)
}
