interface TerminalExitState {
  exitCode: number | null
  signal: string | null
  isRunTerminal: boolean
}

export function shouldAutoCloseTerminal({
  exitCode,
  signal,
  isRunTerminal,
}: TerminalExitState): boolean {
  if (isRunTerminal) return false
  const isIntentionalSignal =
    signal != null &&
    (signal.includes('Interrupt') || signal.includes('Terminated'))
  return exitCode === 0 || isIntentionalSignal
}
