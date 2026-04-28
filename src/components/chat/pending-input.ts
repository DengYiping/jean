import { appendSkillPromptContext } from '@/lib/skill-prompt'
import type {
  PendingFile,
  PendingImage,
  PendingTextFile,
  SkillReference,
} from '@/types/chat'

export interface PendingInputSnapshot {
  sourceSessionId: string
  message: string
  images: PendingImage[]
  files: PendingFile[]
  skills: SkillReference[]
  textFiles: PendingTextFile[]
}

export function buildMessageWithPendingRefs(
  snapshot: PendingInputSnapshot
): string {
  let message = appendSkillPromptContext(snapshot.message, snapshot.skills)

  if (snapshot.files.length > 0) {
    const fileRefs = snapshot.files
      .map(file =>
        file.isDirectory
          ? `[Directory: ${file.relativePath} - Use Glob and Read tools to explore this directory]`
          : `[File: ${file.relativePath} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = message ? `${message}\n\n${fileRefs}` : fileRefs
  }

  if (snapshot.images.length > 0) {
    const imageRefs = snapshot.images
      .map(
        image =>
          `[Image attached: ${image.path} - Use the Read tool to view this image]`
      )
      .join('\n')
    message = message ? `${message}\n\n${imageRefs}` : imageRefs
  }

  if (snapshot.textFiles.length > 0) {
    const textFileRefs = snapshot.textFiles
      .map(
        textFile =>
          `[Text file attached: ${textFile.path} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = message ? `${message}\n\n${textFileRefs}` : textFileRefs
  }

  return message
}
