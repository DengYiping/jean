import { useCallback, type RefObject } from 'react'
import { invoke } from '@/lib/transport'
import { generateId } from '@/lib/uuid'
import { toast } from 'sonner'
import { persistEnqueue } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { buildMcpConfigJson } from '@/services/mcp'
import { getFilename } from '@/lib/path-utils'
import type {
  QueuedMessage,
  ClaudeCommand,
  ResolvedCommand,
  ExecutionMode,
  ThinkingLevel,
  EffortLevel,
  McpServerInfo,
} from '@/types/chat'

interface UsePendingAttachmentsParams {
  activeSessionId: string | null | undefined
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  selectedModelRef: RefObject<string>
  selectedProviderRef: RefObject<string | null>
  executionModeRef: RefObject<ExecutionMode>
  selectedThinkingLevelRef: RefObject<ThinkingLevel>
  selectedEffortLevelRef: RefObject<EffortLevel>
  useAdaptiveThinkingRef: RefObject<boolean>
  isCodexBackendRef: RefObject<boolean>
  mcpServersDataRef: RefObject<McpServerInfo[] | undefined>
  enabledMcpServersRef: RefObject<string[]>
  selectedBackendRef: RefObject<'claude' | 'codex' | 'opencode'>
  inputRef: RefObject<HTMLTextAreaElement | null>
  setInputDraft: (sessionId: string, draft: string) => void
  sendMessageNow: (queuedMsg: QueuedMessage) => void
}

function normalizeAttachmentRemovalInput(input: string) {
  return input.replace(/\s+/g, ' ').trim()
}

/**
 * Handlers for removing pending attachments and executing `/` commands.
 */
export function usePendingAttachments({
  activeSessionId,
  activeWorktreeId,
  activeWorktreePath,
  selectedModelRef,
  selectedProviderRef,
  executionModeRef,
  selectedThinkingLevelRef,
  selectedEffortLevelRef,
  useAdaptiveThinkingRef,
  isCodexBackendRef,
  mcpServersDataRef,
  enabledMcpServersRef,
  selectedBackendRef,
  inputRef,
  setInputDraft,
  sendMessageNow,
}: UsePendingAttachmentsParams) {
  const handleRemovePendingImage = useCallback(
    (imageId: string) => {
      if (!activeSessionId) return
      useChatStore.getState().removePendingImage(activeSessionId, imageId)
    },
    [activeSessionId]
  )

  const handleRemovePendingTextFile = useCallback(
    (textFileId: string) => {
      if (!activeSessionId) return
      useChatStore.getState().removePendingTextFile(activeSessionId, textFileId)
    },
    [activeSessionId]
  )

  const handleRemovePendingSkill = useCallback(
    (skillId: string) => {
      if (!activeSessionId) return
      const { removePendingSkill, getPendingSkills, inputDrafts } =
        useChatStore.getState()

      const skills = getPendingSkills(activeSessionId)
      const skill = skills.find(s => s.id === skillId)
      if (skill) {
        const currentInput = inputDrafts[activeSessionId] ?? ''
        const pattern = new RegExp(
          `\\$${skill.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?=\\s|$)`,
          'g'
        )
        const newInput = normalizeAttachmentRemovalInput(
          currentInput.replace(pattern, '')
        )
        setInputDraft(activeSessionId, newInput)
        if (inputRef.current && newInput) {
          inputRef.current.value = newInput
        }
      }

      removePendingSkill(activeSessionId, skillId)
    },
    [activeSessionId, inputRef, setInputDraft]
  )

  const handleRemovePendingFile = useCallback(
    (fileId: string) => {
      if (!activeSessionId) return
      const { removePendingFile, getPendingFiles, inputDrafts } =
        useChatStore.getState()

      const files = getPendingFiles(activeSessionId)
      const file = files.find(f => f.id === fileId)
      if (file) {
        const filename = getFilename(file.relativePath)
        const currentInput = inputDrafts[activeSessionId] ?? ''
        const pattern = new RegExp(
          `@${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`,
          'g'
        )
        const newInput = normalizeAttachmentRemovalInput(
          currentInput.replace(pattern, '')
        )
        setInputDraft(activeSessionId, newInput)
        if (inputRef.current && newInput) {
          inputRef.current.value = newInput
        }
      }

      removePendingFile(activeSessionId, fileId)
    },
    [activeSessionId, inputRef, setInputDraft]
  )

  const handleCommandExecute = useCallback(
    (command: ClaudeCommand) => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      void (async () => {
        const toastId = toast.loading(`Resolving /${command.name}...`)

        try {
          const resolved = await invoke<ResolvedCommand>(
            'resolve_claude_command',
            {
              commandPath: command.path,
              workingDir: activeWorktreePath,
            }
          )

          const queuedMessage: QueuedMessage = {
            id: generateId(),
            message: resolved.content,
            pendingImages: [],
            pendingFiles: [],
            pendingSkills: [],
            pendingTextFiles: [],
            model: selectedModelRef.current,
            provider: selectedProviderRef.current,
            executionMode: executionModeRef.current,
            thinkingLevel: selectedThinkingLevelRef.current,
            effortLevel:
              useAdaptiveThinkingRef.current || isCodexBackendRef.current
                ? selectedEffortLevelRef.current
                : undefined,
            mcpConfig: buildMcpConfigJson(
              mcpServersDataRef.current ?? [],
              enabledMcpServersRef.current,
              selectedBackendRef.current
            ),
            commandAllowedTools: resolved.allowed_tools,
            queuedAt: Date.now(),
          }

          const { isSending: checkIsSendingNow, enqueueMessage } =
            useChatStore.getState()
          if (checkIsSendingNow(activeSessionId)) {
            enqueueMessage(activeSessionId, queuedMessage)
            if (activeWorktreeId && activeWorktreePath) {
              persistEnqueue(
                activeWorktreeId,
                activeWorktreePath,
                activeSessionId,
                queuedMessage
              )
            }
          } else {
            sendMessageNow(queuedMessage)
          }

          toast.dismiss(toastId)
        } catch (error) {
          toast.error(
            `Failed to resolve /${command.name}: ${error instanceof Error ? error.message : String(error)}`,
            { id: toastId }
          )
        }
      })()
    },
    [activeSessionId, activeWorktreeId, activeWorktreePath, sendMessageNow]
  )

  return {
    handleRemovePendingImage,
    handleRemovePendingTextFile,
    handleRemovePendingSkill,
    handleRemovePendingFile,
    handleCommandExecute,
  }
}
