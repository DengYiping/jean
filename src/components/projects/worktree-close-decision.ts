export type WorktreeCloseDecision = 'confirm' | 'close'

export function decideWorktreeMiddleClose(
  confirmSessionClose: boolean | undefined
): WorktreeCloseDecision {
  return confirmSessionClose === false ? 'close' : 'confirm'
}

export type SessionCloseDecision = 'confirm' | 'delete'

export function decideSessionMiddleClose(params: {
  activeSessionCount: number
  sessionIsEmpty: boolean
  confirmSessionClose: boolean | undefined
}): SessionCloseDecision {
  const { activeSessionCount, sessionIsEmpty, confirmSessionClose } = params
  const isLastSession = activeSessionCount <= 1
  if (isLastSession && confirmSessionClose !== false && !sessionIsEmpty) {
    return 'confirm'
  }
  return 'delete'
}
