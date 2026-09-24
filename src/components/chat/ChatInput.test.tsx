import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { ChatInput } from './ChatInput'
import { invoke } from '@/lib/transport'
import {
  appendPromptMetadataToPlainText,
  encodePromptAttachmentMetadata,
  type PromptAttachmentMetadata,
} from './message-content-utils'

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('@/hooks/use-auto-resize', () => ({
  useAutoResize: () => vi.fn(),
}))

vi.mock('./FileMentionPopover', () => ({
  FileMentionPopover: () => null,
}))

vi.mock('./SlashPopover', () => ({
  SlashPopover: () => null,
}))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

const preferenceState = vi.hoisted(() => ({
  attachLargePastedTextAsFiles: true,
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      attach_large_pasted_text_as_files:
        preferenceState.attachLargePastedTextAsFiles,
    },
  }),
}))

interface StoreState {
  inputDrafts: Record<string, string>
  setInputDraft: ReturnType<typeof vi.fn>
  addPendingImage: ReturnType<typeof vi.fn>
  addPendingFile: ReturnType<typeof vi.fn>
  addPendingTextFile: ReturnType<typeof vi.fn>
  getPendingFiles: ReturnType<typeof vi.fn>
  removePendingFile: ReturnType<typeof vi.fn>
  setDraftSkillBindings: ReturnType<typeof vi.fn>
  syncDraftSkillBindings: ReturnType<typeof vi.fn>
}

const storeState: StoreState = {
  inputDrafts: {},
  setInputDraft: vi.fn((sessionId: string, draft: string) => {
    storeState.inputDrafts[sessionId] = draft
  }),
  addPendingImage: vi.fn(),
  addPendingFile: vi.fn(),
  addPendingTextFile: vi.fn(),
  getPendingFiles: vi.fn(() => []),
  removePendingFile: vi.fn(),
  setDraftSkillBindings: vi.fn(),
  syncDraftSkillBindings: vi.fn(),
}

vi.mock('@/store/chat-store', () => ({
  useChatStore: {
    getState: () => storeState,
    subscribe: vi.fn(() => () => undefined),
  },
}))

describe('ChatInput copied prompt restore', () => {
  const renderInput = () => {
    const formRef = createRef<HTMLFormElement>()
    const inputRef = createRef<HTMLTextAreaElement>()

    render(
      <ChatInput
        activeSessionId="session-1"
        activeWorktreePath="/tmp/worktree"
        isSending={false}
        executionMode="build"
        focusChatShortcut="⌘K"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        backend="codex"
        formRef={formRef}
        inputRef={inputRef}
      />
    )

    return screen.getByRole('textbox') as HTMLTextAreaElement
  }

  beforeEach(() => {
    preferenceState.attachLargePastedTextAsFiles = true
    vi.mocked(invoke).mockReset()
    storeState.inputDrafts = {}
    storeState.setInputDraft.mockClear()
    storeState.addPendingImage.mockClear()
    storeState.addPendingFile.mockClear()
    storeState.addPendingTextFile.mockClear()
    storeState.getPendingFiles.mockClear()
    storeState.removePendingFile.mockClear()
    storeState.setDraftSkillBindings.mockClear()
    storeState.syncDraftSkillBindings.mockClear()
  })

  it('keeps long pasted text inline when large-text attachments are disabled', async () => {
    preferenceState.attachLargePastedTextAsFiles = false
    const textarea = renderInput()

    const pasteWasNotPrevented = fireEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/plain' ? 'x'.repeat(2000) : '',
        items: [],
      },
    })

    expect(pasteWasNotPrevented).toBe(true)
    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalledWith(
        'save_pasted_text',
        expect.anything()
      )
      expect(storeState.addPendingTextFile).not.toHaveBeenCalled()
    })
  })

  it('restores attachments and draft skill bindings from rich copied prompt metadata', async () => {
    const textarea = renderInput()
    const metadata: PromptAttachmentMetadata = {
      v: 1,
      images: ['/tmp/image.png'],
      textFiles: [],
      files: [
        { path: 'src/App.tsx', isDirectory: false },
        { path: 'src/components', isDirectory: true },
      ],
      skills: [{ name: 'foo', path: '/skills/foo/SKILL.md' }],
    }

    fireEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/html'
            ? `<span data-jean-prompt="${encodePromptAttachmentMetadata(metadata)}">Check this</span>`
            : type === 'text/plain'
              ? 'Check this'
              : '',
        items: [],
      },
    })

    await waitFor(() => {
      expect(storeState.setInputDraft).toHaveBeenCalledWith(
        'session-1',
        '$foo Check this'
      )
      expect(storeState.addPendingImage).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          path: '/tmp/image.png',
          filename: 'image.png',
        })
      )
      expect(storeState.addPendingFile).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          relativePath: 'src/App.tsx',
          isDirectory: false,
        })
      )
      expect(storeState.addPendingFile).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          relativePath: 'src/components',
          isDirectory: true,
        })
      )
      expect(storeState.setDraftSkillBindings).toHaveBeenCalledWith(
        'session-1',
        metadata.skills
      )
      expect(storeState.syncDraftSkillBindings).toHaveBeenCalledWith(
        'session-1',
        '$foo Check this'
      )
    })

    expect(textarea.value).toBe('$foo Check this')
  })

  it('restores attachments from plain-text copied prompt fallback', async () => {
    const textarea = renderInput()
    const metadata: PromptAttachmentMetadata = {
      v: 1,
      images: ['/tmp/image.png'],
      textFiles: [],
      files: [{ path: 'src/components', isDirectory: true }],
      skills: [],
    }
    const copiedText = appendPromptMetadataToPlainText('Check this', metadata)

    fireEvent.paste(textarea, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? copiedText : ''),
        items: [],
      },
    })

    await waitFor(() => {
      expect(storeState.setInputDraft).toHaveBeenCalledWith(
        'session-1',
        'Check this'
      )
      expect(storeState.addPendingImage).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ path: '/tmp/image.png' })
      )
      expect(storeState.addPendingFile).toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({
          relativePath: 'src/components',
          isDirectory: true,
        })
      )
      expect(storeState.setDraftSkillBindings).toHaveBeenCalledWith(
        'session-1',
        []
      )
      expect(storeState.syncDraftSkillBindings).toHaveBeenCalledWith(
        'session-1',
        'Check this'
      )
    })

    expect(textarea.value).toBe('Check this')
  })
})
