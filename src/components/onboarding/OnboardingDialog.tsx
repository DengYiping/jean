/**
 * Onboarding Dialog for CLI Setup
 *
 * Multi-step wizard that handles installation and authentication of at least
 * one AI backend CLI (Claude/Codex/OpenCode) plus mandatory GitHub CLI.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useUIStore } from '@/store/ui-store'
import {
  useClaudeCliSetup,
  useClaudeCliAuth,
  resolveClaudeUpdateCommand,
} from '@/services/claude-cli'
import {
  useCodexCliSetup,
  useCodexCliAuth,
  resolveCodexUpdateCommand,
} from '@/services/codex-cli'
import {
  useOpenCodeCliSetup,
  useOpenCodeCliAuth,
} from '@/services/opencode-cli'
import { useGhCliSetup, useGhCliAuth } from '@/services/gh-cli'
import {
  SetupState,
  InstallingState,
  ErrorState,
  AuthCheckingState,
  AuthLoginState,
  HostInstallState,
} from './CliSetupComponents'
import { toast } from 'sonner'
import { usePreferences, usePatchPreferences } from '@/services/preferences'

type AIBackend = 'claude' | 'codex' | 'opencode'
type CliType = AIBackend | 'gh'

const AI_BACKENDS: AIBackend[] = ['claude', 'codex', 'opencode']

type OnboardingStep =
  | 'backend-select'
  | 'claude-setup'
  | 'claude-installing'
  | 'claude-auth-checking'
  | 'claude-auth-login'
  | 'codex-setup'
  | 'codex-installing'
  | 'codex-auth-checking'
  | 'codex-auth-login'
  | 'opencode-setup'
  | 'opencode-installing'
  | 'opencode-auth-checking'
  | 'opencode-auth-login'
  | 'gh-setup'
  | 'gh-installing'
  | 'gh-auth-checking'
  | 'gh-auth-login'
  | 'complete'

interface VersionOption {
  version: string
  prerelease: boolean
  tagName?: string
  tag_name?: string
  publishedAt?: string
  published_at?: string
}

interface CliSetupData {
  type: CliType
  title: string
  description: string
  versions: VersionOption[]
  isVersionsLoading: boolean
  isVersionsError: boolean
  onRetryVersions: () => void
  isInstalling: boolean
  installError: Error | null
  progress: { stage: string; message: string; percent: number } | null
  install: (
    version: string,
    options?: { onSuccess?: () => void; onError?: (error: Error) => void }
  ) => void
  currentVersion: string | null | undefined
}

interface ResolvedUpdateCommand {
  command: string
  commandArgs: string[]
  display: string
}

const backendLabel: Record<CliType, string> = {
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  opencode: 'OpenCode CLI',
  gh: 'GitHub CLI',
}

function stepToBackend(step: OnboardingStep): AIBackend | null {
  if (step.startsWith('claude-')) return 'claude'
  if (step.startsWith('codex-')) return 'codex'
  if (step.startsWith('opencode-')) return 'opencode'
  return null
}

/**
 * Always mounted so Radix Dialog can properly clean up its portal/overlay
 * when closing. Unmounting while open leaves a stale overlay that blocks clicks.
 */
export function OnboardingDialog() {
  return <OnboardingDialogContent />
}

/**
 * Inner component with all hook logic.
 * Only mounted when dialog is actually open.
 */
function OnboardingDialogContent() {
  const {
    onboardingOpen,
    onboardingStartStep,
    setOnboardingStartStep,
    onboardingManuallyTriggered,
  } = useUIStore()

  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()

  const claudeSetup = useClaudeCliSetup()
  const codexSetup = useCodexCliSetup()
  const opencodeSetup = useOpenCodeCliSetup()
  const ghSetup = useGhCliSetup()

  const claudeAuth = useClaudeCliAuth({
    enabled: !!claudeSetup.status?.installed,
  })
  const codexAuth = useCodexCliAuth({ enabled: !!codexSetup.status?.installed })
  const opencodeAuth = useOpenCodeCliAuth({
    enabled: !!opencodeSetup.status?.installed,
  })
  const ghAuth = useGhCliAuth({ enabled: !!ghSetup.status?.installed })

  const [step, setStep] = useState<OnboardingStep>('backend-select')
  const [selectedBackends, setSelectedBackends] = useState<AIBackend[]>([])
  const [, setActiveBackendIndex] = useState(0)

  const [claudeVersion, setClaudeVersion] = useState<string | null>(null)
  const [codexVersion, setCodexVersion] = useState<string | null>(null)
  const [opencodeVersion, setOpencodeVersion] = useState<string | null>(null)
  const [ghVersion, setGhVersion] = useState<string | null>(null)

  const [claudeInstallFailed, setClaudeInstallFailed] = useState(false)
  const [codexInstallFailed, setCodexInstallFailed] = useState(false)
  const [opencodeInstallFailed, setOpencodeInstallFailed] = useState(false)
  const [ghInstallFailed, setGhInstallFailed] = useState(false)
  const [claudeInstallCommand, setClaudeInstallCommand] =
    useState<ResolvedUpdateCommand | null>(null)
  const [codexInstallCommand, setCodexInstallCommand] =
    useState<ResolvedUpdateCommand | null>(null)
  const [claudeInstallAttempt, setClaudeInstallAttempt] = useState(0)
  const [codexInstallAttempt, setCodexInstallAttempt] = useState(0)
  const [claudeLoginAttempt, setClaudeLoginAttempt] = useState(0)
  const [codexLoginAttempt, setCodexLoginAttempt] = useState(0)
  const [opencodeLoginAttempt, setOpencodeLoginAttempt] = useState(0)
  const [ghLoginAttempt, setGhLoginAttempt] = useState(0)

  const initializedFlowRef = useRef(false)

  // Seed for terminal IDs - each retry increments an attempt counter to force a fresh PTY
  const loginSessionSeed = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => Date.now(),
    []
  )
  const claudeInstallTerminalId = `onboarding-claude-install-${loginSessionSeed}-${claudeInstallAttempt}`
  const codexInstallTerminalId = `onboarding-codex-install-${loginSessionSeed}-${codexInstallAttempt}`
  const claudeLoginTerminalId = `onboarding-claude-login-${loginSessionSeed}-${claudeLoginAttempt}`
  const codexLoginTerminalId = `onboarding-codex-login-${loginSessionSeed}-${codexLoginAttempt}`
  const opencodeLoginTerminalId = `onboarding-opencode-login-${loginSessionSeed}-${opencodeLoginAttempt}`
  const ghLoginTerminalId = `onboarding-gh-login-${loginSessionSeed}-${ghLoginAttempt}`

  const stableClaudeVersions = claudeSetup.versions.filter(v => !v.prerelease)
  const stableCodexVersions = codexSetup.versions.filter(v => !v.prerelease)
  const stableOpencodeVersions = opencodeSetup.versions.filter(
    v => !v.prerelease
  )
  const stableGhVersions = ghSetup.versions.filter(v => !v.prerelease)

  useEffect(() => {
    if (!claudeVersion && stableClaudeVersions.length > 0) {
      queueMicrotask(() =>
        setClaudeVersion(stableClaudeVersions[0]?.version ?? null)
      )
    }
  }, [claudeVersion, stableClaudeVersions])

  useEffect(() => {
    if (!codexVersion && stableCodexVersions.length > 0) {
      queueMicrotask(() =>
        setCodexVersion(stableCodexVersions[0]?.version ?? null)
      )
    }
  }, [codexVersion, stableCodexVersions])

  useEffect(() => {
    if (!opencodeVersion && stableOpencodeVersions.length > 0) {
      queueMicrotask(() =>
        setOpencodeVersion(stableOpencodeVersions[0]?.version ?? null)
      )
    }
  }, [opencodeVersion, stableOpencodeVersions])

  useEffect(() => {
    if (!ghVersion && stableGhVersions.length > 0) {
      queueMicrotask(() => setGhVersion(stableGhVersions[0]?.version ?? null))
    }
  }, [ghVersion, stableGhVersions])

  const isBackendReady = useCallback(
    (backend: AIBackend) => {
      if (backend === 'claude') {
        return (
          !!claudeSetup.status?.installed && !!claudeAuth.data?.authenticated
        )
      }
      if (backend === 'codex') {
        return !!codexSetup.status?.installed && !!codexAuth.data?.authenticated
      }
      return (
        !!opencodeSetup.status?.installed && !!opencodeAuth.data?.authenticated
      )
    },
    [
      claudeSetup.status?.installed,
      claudeAuth.data?.authenticated,
      codexSetup.status?.installed,
      codexAuth.data?.authenticated,
      opencodeSetup.status?.installed,
      opencodeAuth.data?.authenticated,
    ]
  )

  const getNextStepForBackend = useCallback(
    (backend: AIBackend): OnboardingStep | null => {
      if (backend === 'claude') {
        if (!claudeSetup.status?.installed) return 'claude-setup'
        if (!claudeAuth.data?.authenticated) return 'claude-auth-checking'
        return null
      }
      if (backend === 'codex') {
        if (!codexSetup.status?.installed) return 'codex-setup'
        if (!codexAuth.data?.authenticated) return 'codex-auth-checking'
        return null
      }

      if (!opencodeSetup.status?.installed) return 'opencode-setup'
      if (!opencodeAuth.data?.authenticated) return 'opencode-auth-checking'
      return null
    },
    [
      claudeSetup.status?.installed,
      claudeAuth.data?.authenticated,
      codexSetup.status?.installed,
      codexAuth.data?.authenticated,
      opencodeSetup.status?.installed,
      opencodeAuth.data?.authenticated,
    ]
  )

  const getNextStepAfterBackends = useCallback((): OnboardingStep => {
    if (!ghSetup.status?.installed) return 'gh-setup'
    if (!ghAuth.data?.authenticated) return 'gh-auth-checking'
    return 'complete'
  }, [ghSetup.status?.installed, ghAuth.data?.authenticated])

  const moveToNextBackendOrGh = useCallback(
    (currentBackend: AIBackend) => {
      const currentIndex = selectedBackends.indexOf(currentBackend)
      for (let i = currentIndex + 1; i < selectedBackends.length; i += 1) {
        const backend = selectedBackends[i]
        if (!backend) continue
        const nextStep = getNextStepForBackend(backend)
        if (nextStep) {
          setActiveBackendIndex(i)
          setStep(nextStep)
          return
        }
      }

      setStep(getNextStepAfterBackends())
    },
    [selectedBackends, getNextStepForBackend, getNextStepAfterBackends]
  )

  const loadingInitialState =
    claudeSetup.isStatusLoading ||
    codexSetup.isStatusLoading ||
    opencodeSetup.isStatusLoading ||
    ghSetup.isStatusLoading ||
    (claudeSetup.status?.installed &&
      (claudeAuth.isLoading || claudeAuth.isFetching)) ||
    (codexSetup.status?.installed &&
      (codexAuth.isLoading || codexAuth.isFetching)) ||
    (opencodeSetup.status?.installed &&
      (opencodeAuth.isLoading || opencodeAuth.isFetching)) ||
    (ghSetup.status?.installed && (ghAuth.isLoading || ghAuth.isFetching))

  useEffect(() => {
    if (!onboardingOpen) {
      initializedFlowRef.current = false
      return
    }

    if (loadingInitialState || initializedFlowRef.current) {
      return
    }

    initializedFlowRef.current = true

    queueMicrotask(() => {
      setClaudeInstallFailed(false)
      setCodexInstallFailed(false)
      setOpencodeInstallFailed(false)
      setGhInstallFailed(false)
      setClaudeInstallCommand(null)
      setCodexInstallCommand(null)
      setClaudeInstallAttempt(0)
      setCodexInstallAttempt(0)
      setClaudeLoginAttempt(0)
      setCodexLoginAttempt(0)
      setOpencodeLoginAttempt(0)
      setGhLoginAttempt(0)
    })

    if (onboardingStartStep === 'gh') {
      queueMicrotask(() => {
        setStep('gh-setup')
        setOnboardingStartStep(null)
      })
      return
    }

    if (onboardingStartStep === 'claude') {
      queueMicrotask(() => {
        setSelectedBackends(['claude'])
        setActiveBackendIndex(0)
        setStep('claude-setup')
        setOnboardingStartStep(null)
      })
      return
    }

    const readyBackends = AI_BACKENDS.filter(isBackendReady)
    const ghReady = !!ghSetup.status?.installed && !!ghAuth.data?.authenticated

    // When manually triggered, start at backend-select so users can
    // install additional CLIs (e.g. Codex) even if minimum requirements are met.
    // But if ALL backends are already installed, skip to GH or complete.
    if (onboardingManuallyTriggered) {
      const uninstalledBackends = AI_BACKENDS.filter(b => !isBackendReady(b))
      if (uninstalledBackends.length > 0) {
        queueMicrotask(() => setStep('backend-select'))
        return
      }
      // All backends installed — skip to GH check or complete
      queueMicrotask(() => setStep(getNextStepAfterBackends()))
      return
    }

    if (ghReady && readyBackends.length > 0) {
      queueMicrotask(() => setStep('complete'))
      return
    }

    if (readyBackends.length > 0) {
      queueMicrotask(() => {
        setSelectedBackends(readyBackends)
        setStep(getNextStepAfterBackends())
      })
      return
    }

    queueMicrotask(() => setStep('backend-select'))
  }, [
    onboardingOpen,
    onboardingStartStep,
    setOnboardingStartStep,
    onboardingManuallyTriggered,
    loadingInitialState,
    isBackendReady,
    ghSetup.status?.installed,
    ghAuth.data?.authenticated,
    getNextStepAfterBackends,
  ])

  // Handle AI backend auth check steps
  useEffect(() => {
    if (step !== 'claude-auth-checking') return
    if (claudeAuth.isLoading || claudeAuth.isFetching) return

    if (claudeAuth.data?.authenticated) {
      queueMicrotask(() => moveToNextBackendOrGh('claude'))
    } else {
      queueMicrotask(() => setStep('claude-auth-login'))
    }
  }, [
    step,
    claudeAuth.isLoading,
    claudeAuth.isFetching,
    claudeAuth.data?.authenticated,
    moveToNextBackendOrGh,
  ])

  useEffect(() => {
    if (step !== 'codex-auth-checking') return
    if (codexAuth.isLoading || codexAuth.isFetching) return

    if (codexAuth.data?.authenticated) {
      queueMicrotask(() => moveToNextBackendOrGh('codex'))
    } else {
      queueMicrotask(() => setStep('codex-auth-login'))
    }
  }, [
    step,
    codexAuth.isLoading,
    codexAuth.isFetching,
    codexAuth.data?.authenticated,
    moveToNextBackendOrGh,
  ])

  useEffect(() => {
    if (step !== 'opencode-auth-checking') return
    if (opencodeAuth.isLoading || opencodeAuth.isFetching) return

    if (opencodeAuth.data?.authenticated) {
      queueMicrotask(() => moveToNextBackendOrGh('opencode'))
    } else {
      queueMicrotask(() => setStep('opencode-auth-login'))
    }
  }, [
    step,
    opencodeAuth.isLoading,
    opencodeAuth.isFetching,
    opencodeAuth.data?.authenticated,
    moveToNextBackendOrGh,
  ])

  useEffect(() => {
    if (step !== 'gh-auth-checking') return
    if (ghAuth.isLoading || ghAuth.isFetching) return

    if (ghAuth.data?.authenticated) {
      queueMicrotask(() => setStep('complete'))
    } else {
      queueMicrotask(() => setStep('gh-auth-login'))
    }
  }, [step, ghAuth.isLoading, ghAuth.isFetching, ghAuth.data?.authenticated])

  const handleBackendToggle = useCallback(
    (backend: AIBackend, checked: boolean) => {
      setSelectedBackends(prev => {
        if (checked) {
          if (prev.includes(backend)) return prev
          return [...prev, backend]
        }
        return prev.filter(b => b !== backend)
      })
    },
    []
  )

  const handleBackendSelectionContinue = useCallback(() => {
    if (selectedBackends.length === 0 && !onboardingManuallyTriggered) {
      toast.warning('Select at least one AI backend to continue.')
      return
    }

    for (let i = 0; i < selectedBackends.length; i += 1) {
      const backend = selectedBackends[i]
      if (!backend) continue
      const nextStep = getNextStepForBackend(backend)
      if (nextStep) {
        setActiveBackendIndex(i)
        setStep(nextStep)
        return
      }
    }

    setStep(getNextStepAfterBackends())
  }, [
    selectedBackends,
    onboardingManuallyTriggered,
    getNextStepForBackend,
    getNextStepAfterBackends,
  ])

  const handleClaudeInstall = useCallback(async () => {
    try {
      const resolved = await resolveClaudeUpdateCommand()
      if (resolved) {
        setClaudeInstallCommand(resolved)
        setStep('claude-installing')
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('Failed to resolve Claude update command', {
        description: message,
      })
      return
    }

    const result = await claudeSetup.refetchStatus()
    if (result.data?.installed) {
      setStep('claude-auth-checking')
      claudeAuth.refetch()
      return
    }
    toast.error(
      'Claude CLI not found in PATH. Install `claude` on your system first.'
    )
  }, [claudeSetup, claudeAuth])

  const handleClaudeInstallComplete = useCallback(async () => {
    const result = await claudeSetup.refetchStatus()
    if (result.data?.installed) {
      setStep('claude-auth-checking')
      await claudeAuth.refetch()
      return
    }

    toast.error('Claude CLI was not found after running the install command.')
    setStep('claude-setup')
  }, [claudeSetup, claudeAuth])

  const handleClaudeInstallRetry = useCallback(() => {
    setClaudeInstallAttempt(prev => prev + 1)
  }, [])

  const handleCodexInstall = useCallback(async () => {
    try {
      const resolved = await resolveCodexUpdateCommand()
      if (resolved) {
        setCodexInstallCommand(resolved)
        setStep('codex-installing')
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('Failed to resolve Codex update command', {
        description: message,
      })
      return
    }

    const result = await codexSetup.refetchStatus()
    if (result.data?.installed) {
      setStep('codex-auth-checking')
      codexAuth.refetch()
      return
    }
    toast.error(
      'Codex CLI not found in PATH. Install `codex` on your system first.'
    )
  }, [codexSetup, codexAuth])

  const handleCodexInstallComplete = useCallback(async () => {
    const result = await codexSetup.refetchStatus()
    if (result.data?.installed) {
      setStep('codex-auth-checking')
      await codexAuth.refetch()
      return
    }

    toast.error('Codex CLI was not found after running the install command.')
    setStep('codex-setup')
  }, [codexSetup, codexAuth])

  const handleCodexInstallRetry = useCallback(() => {
    setCodexInstallAttempt(prev => prev + 1)
  }, [])

  const handleOpencodeInstall = useCallback(() => {
    opencodeSetup.refetchStatus().then(result => {
      if (result.data?.installed) {
        setStep('opencode-auth-checking')
        opencodeAuth.refetch()
        return
      }
      toast.error(
        'OpenCode CLI not found in PATH. Install `opencode` on your system first.'
      )
    })
  }, [opencodeSetup, opencodeAuth])

  const handleGhInstall = useCallback(() => {
    if (!ghVersion) return
    setStep('gh-installing')
    ghSetup.install(ghVersion, {
      onSuccess: () => {
        setStep('gh-auth-checking')
        ghAuth.refetch()
      },
      onError: () => {
        setGhInstallFailed(true)
        setStep('gh-setup')
      },
    })
  }, [ghVersion, ghSetup, ghAuth])

  const handleClaudeLoginComplete = useCallback(async () => {
    setStep('claude-auth-checking')
    await claudeAuth.refetch()
  }, [claudeAuth])

  const handleCodexLoginComplete = useCallback(async () => {
    setStep('codex-auth-checking')
    await codexAuth.refetch()
  }, [codexAuth])

  const handleOpencodeLoginComplete = useCallback(async () => {
    setStep('opencode-auth-checking')
    await opencodeAuth.refetch()
  }, [opencodeAuth])

  const handleGhLoginComplete = useCallback(async () => {
    setStep('gh-auth-checking')
    await ghAuth.refetch()
  }, [ghAuth])

  const handleClaudeLoginRetry = useCallback(() => {
    setClaudeLoginAttempt(prev => prev + 1)
  }, [])

  const handleCodexLoginRetry = useCallback(() => {
    setCodexLoginAttempt(prev => prev + 1)
  }, [])

  const handleOpencodeLoginRetry = useCallback(() => {
    setOpencodeLoginAttempt(prev => prev + 1)
  }, [])

  const handleGhLoginRetry = useCallback(() => {
    setGhLoginAttempt(prev => prev + 1)
  }, [])

  const handleComplete = useCallback(() => {
    claudeSetup.refetchStatus()
    codexSetup.refetchStatus()
    opencodeSetup.refetchStatus()
    ghSetup.refetchStatus()
    // Set the first selected backend as the default so the preference
    // isn't left pointing at an uninstalled backend (e.g. 'claude').
    const [firstBackend] = selectedBackends
    if (firstBackend && preferences) {
      patchPreferences.mutate({ default_backend: firstBackend })
    }
    // Atomically close onboarding and mark as dismissed so it doesn't reappear on reload
    useUIStore.setState({
      onboardingOpen: false,
      onboardingStartStep: null,
      onboardingDismissed: true,
    })
  }, [
    claudeSetup,
    codexSetup,
    opencodeSetup,
    ghSetup,
    selectedBackends,
    preferences,
    patchPreferences,
  ])

  const handleAbort = useCallback(() => {
    // Atomic update: onboardingDismissed must be true BEFORE onboardingOpen
    // becomes false, otherwise the App.tsx subscriber sees dismissed=false
    // and incorrectly opens the feature tour dialog.
    useUIStore.setState({
      onboardingOpen: false,
      onboardingStartStep: null,
      onboardingDismissed: true,
    })
    // Safety: Radix Dialog sometimes fails to restore pointer-events on <body>
    setTimeout(() => {
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.removeProperty('pointer-events')
      }
    }, 500)
  }, [])

  const getCliSetupData = (): CliSetupData | null => {
    if (step === 'claude-setup' || step === 'claude-installing') {
      return {
        type: 'claude',
        title: 'Claude CLI',
        description: 'Claude CLI enables Anthropic-backed AI sessions.',
        versions: stableClaudeVersions,
        isVersionsLoading: claudeSetup.isVersionsLoading,
        isVersionsError: claudeSetup.isVersionsError,
        onRetryVersions: claudeSetup.refetchVersions,
        isInstalling: claudeSetup.isInstalling,
        installError: claudeInstallFailed ? claudeSetup.installError : null,
        progress: claudeSetup.progress,
        install: claudeSetup.install,
        currentVersion: claudeSetup.status?.version,
      }
    }

    if (step === 'codex-setup' || step === 'codex-installing') {
      return {
        type: 'codex',
        title: 'Codex CLI',
        description: 'Codex CLI enables OpenAI-backed AI sessions.',
        versions: stableCodexVersions,
        isVersionsLoading: codexSetup.isVersionsLoading,
        isVersionsError: codexSetup.isVersionsError,
        onRetryVersions: codexSetup.refetchVersions,
        isInstalling: codexSetup.isInstalling,
        installError: codexInstallFailed ? codexSetup.installError : null,
        progress: codexSetup.progress,
        install: codexSetup.install,
        currentVersion: codexSetup.status?.version,
      }
    }

    if (step === 'opencode-setup' || step === 'opencode-installing') {
      return {
        type: 'opencode',
        title: 'OpenCode CLI',
        description: 'OpenCode CLI enables OpenCode-backed AI sessions.',
        versions: stableOpencodeVersions,
        isVersionsLoading: opencodeSetup.isVersionsLoading,
        isVersionsError: opencodeSetup.isVersionsError,
        onRetryVersions: opencodeSetup.refetchVersions,
        isInstalling: opencodeSetup.isInstalling,
        installError: opencodeInstallFailed ? opencodeSetup.installError : null,
        progress: opencodeSetup.progress,
        install: opencodeSetup.install,
        currentVersion: opencodeSetup.status?.version,
      }
    }

    if (step === 'gh-setup' || step === 'gh-installing') {
      return {
        type: 'gh',
        title: 'GitHub CLI',
        description: 'GitHub CLI is required for GitHub integration.',
        versions: stableGhVersions,
        isVersionsLoading: ghSetup.isVersionsLoading,
        isVersionsError: ghSetup.isVersionsError,
        onRetryVersions: ghSetup.refetchVersions,
        isInstalling: ghSetup.isInstalling,
        installError: ghInstallFailed ? ghSetup.installError : null,
        progress: ghSetup.progress,
        install: ghSetup.install,
        currentVersion: ghSetup.status?.version,
      }
    }

    return null
  }

  const cliData = getCliSetupData()

  const isClaudeReinstall =
    claudeSetup.status?.installed && step === 'claude-setup'
  const isCodexReinstall =
    codexSetup.status?.installed && step === 'codex-setup'
  const isOpencodeReinstall =
    opencodeSetup.status?.installed && step === 'opencode-setup'
  const isGhReinstall = ghSetup.status?.installed && step === 'gh-setup'

  const claudeLoginCommand = claudeSetup.status?.path ?? ''
  const claudeLoginArgs = claudeSetup.status?.supports_auth_command
    ? ['auth', 'login']
    : ['login']
  const codexLoginCommand = codexSetup.status?.path ?? ''
  const codexLoginArgs = ['login']
  const opencodeLoginCommand = opencodeSetup.status?.command ?? ''
  const opencodeLoginArgs = [
    ...(opencodeSetup.status?.command_args ?? []),
    'auth',
    'login',
  ]
  const ghLoginCommand = ghSetup.status?.path ?? ''
  const ghLoginArgs = ['auth', 'login']

  const getDialogContent = () => {
    if (step === 'backend-select') {
      return {
        title: onboardingManuallyTriggered
          ? 'Install AI Backends'
          : 'Welcome to Jean',
        description: onboardingManuallyTriggered
          ? 'Select additional AI backends to install.'
          : 'Select at least one AI backend to install. GitHub CLI setup is required next.',
      }
    }

    if (step === 'complete') {
      return {
        title: 'Setup Complete',
        description:
          'All required tools have been installed and authenticated.',
      }
    }

    if (step === 'gh-setup' || step === 'gh-installing') {
      return {
        title: isGhReinstall
          ? 'Change GitHub CLI Version'
          : 'Install GitHub CLI',
        description: isGhReinstall
          ? 'Select a version to install. This will replace the current installation.'
          : 'GitHub CLI is required for GitHub integration.',
      }
    }

    if (step === 'gh-auth-checking' || step === 'gh-auth-login') {
      return {
        title: 'Authenticate GitHub CLI',
        description: 'GitHub CLI authentication is required to continue.',
      }
    }

    const currentBackend = stepToBackend(step)
    const backendName = currentBackend
      ? backendLabel[currentBackend]
      : 'AI Backend'

    if (
      step === 'claude-setup' ||
      (step === 'claude-installing' && !claudeInstallCommand) ||
      step === 'codex-setup' ||
      (step === 'codex-installing' && !codexInstallCommand) ||
      step === 'opencode-setup' ||
      step === 'opencode-installing'
    ) {
      return {
        title: `Detect ${backendName}`,
        description: `${backendName} must be installed on your host system before Jean can use it.`,
      }
    }

    if (
      (step === 'claude-installing' && claudeInstallCommand) ||
      (step === 'codex-installing' && codexInstallCommand) ||
      step === 'claude-auth-checking' ||
      step === 'claude-auth-login' ||
      step === 'codex-auth-checking' ||
      step === 'codex-auth-login' ||
      step === 'opencode-auth-checking' ||
      step === 'opencode-auth-login'
    ) {
      return {
        title:
          step === 'claude-installing' && claudeInstallCommand
            ? 'Install Claude CLI'
            : step === 'codex-installing' && codexInstallCommand
              ? 'Install Codex CLI'
              : `Authenticate ${backendName}`,
        description:
          step === 'claude-installing' && claudeInstallCommand
            ? 'Run the configured Claude install/update command below.'
            : step === 'codex-installing' && codexInstallCommand
              ? 'Run the configured Codex install/update command below.'
              : `${backendName} requires authentication to function.`,
      }
    }

    return { title: 'Setup', description: '' }
  }

  const dialogContent = getDialogContent()

  const renderStepIndicator = () => {
    const isBackendSelection = step === 'backend-select'
    const isBackendStep =
      step.startsWith('claude-') ||
      step.startsWith('codex-') ||
      step.startsWith('opencode-')
    const isGhStep = step.startsWith('gh-')

    const backendComplete = !isBackendSelection && !isBackendStep
    const ghComplete = step === 'complete'

    return (
      <div className="flex items-center justify-center gap-2 mb-4">
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            isBackendSelection || isBackendStep
              ? 'bg-primary text-primary-foreground'
              : backendComplete
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          <span className="font-medium">1</span>
          <span>AI Backend(s)</span>
        </div>
        <div className="w-4 h-px bg-border" />
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            isGhStep
              ? 'bg-primary text-primary-foreground'
              : ghComplete
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
          }`}
        >
          <span className="font-medium">2</span>
          <span>GitHub CLI</span>
        </div>
        <div className="w-4 h-px bg-border" />
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
            step === 'complete'
              ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <span className="font-medium">3</span>
          <span>Done</span>
        </div>
      </div>
    )
  }

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (step === 'complete') {
          handleComplete()
        } else {
          handleAbort()
        }
      }
    },
    [step, handleComplete, handleAbort]
  )

  return (
    <Dialog open={onboardingOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg flex flex-col" preventClose>
        <DialogHeader>
          <DialogTitle className="text-xl">{dialogContent.title}</DialogTitle>
          <DialogDescription>{dialogContent.description}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto py-4 flex flex-col">
          {renderStepIndicator()}

          <div className="w-full">
            {step === 'backend-select' ? (
              <BackendSelectionState
                selectedBackends={selectedBackends}
                onToggle={handleBackendToggle}
                onContinue={handleBackendSelectionContinue}
                readyBackends={
                  onboardingManuallyTriggered
                    ? AI_BACKENDS.filter(isBackendReady)
                    : []
                }
              />
            ) : step === 'complete' ? (
              <SuccessState
                claudeVersion={claudeSetup.status?.version}
                codexVersion={codexSetup.status?.version}
                opencodeVersion={opencodeSetup.status?.version}
                ghVersion={ghSetup.status?.version}
                onContinue={handleComplete}
              />
            ) : step === 'claude-installing' && claudeInstallCommand ? (
              <AuthLoginState
                cliName="Claude CLI"
                terminalId={claudeInstallTerminalId}
                command={claudeInstallCommand.command}
                commandArgs={claudeInstallCommand.commandArgs}
                onComplete={handleClaudeInstallComplete}
                onRetry={handleClaudeInstallRetry}
                title="Claude install command"
                description="Run the configured Claude install/update command below."
                failureTitle="Install command exited unexpectedly"
                completeLabel="Check Claude Status"
                retryLabel="Retry Command"
              />
            ) : step === 'claude-installing' && cliData ? (
              <InstallingState
                cliName="Claude CLI"
                progress={cliData.progress}
              />
            ) : step === 'codex-installing' && codexInstallCommand ? (
              <AuthLoginState
                cliName="Codex CLI"
                terminalId={codexInstallTerminalId}
                command={codexInstallCommand.command}
                commandArgs={codexInstallCommand.commandArgs}
                onComplete={handleCodexInstallComplete}
                onRetry={handleCodexInstallRetry}
                title="Codex install command"
                description="Run the configured Codex install/update command below."
                failureTitle="Install command exited unexpectedly"
                completeLabel="Check Codex Status"
                retryLabel="Retry Command"
              />
            ) : step === 'codex-installing' && cliData ? (
              <InstallingState
                cliName="Codex CLI"
                progress={cliData.progress}
              />
            ) : step === 'opencode-installing' && cliData ? (
              <InstallingState
                cliName="OpenCode CLI"
                progress={cliData.progress}
              />
            ) : step === 'gh-installing' && cliData ? (
              <InstallingState
                cliName="GitHub CLI"
                progress={cliData.progress}
              />
            ) : step === 'claude-auth-checking' ? (
              <AuthCheckingState cliName="Claude CLI" />
            ) : step === 'codex-auth-checking' ? (
              <AuthCheckingState cliName="Codex CLI" />
            ) : step === 'opencode-auth-checking' ? (
              <AuthCheckingState cliName="OpenCode CLI" />
            ) : step === 'gh-auth-checking' ? (
              <AuthCheckingState cliName="GitHub CLI" />
            ) : step === 'claude-auth-login' ? (
              <AuthLoginState
                cliName="Claude CLI"
                progress={cliData.progress}
              />
            ) : step === 'codex-auth-login' ? (
              <AuthLoginState
                cliName="Codex CLI"
                progress={cliData.progress}
              />
            ) : step === 'opencode-auth-login' ? (
              <AuthLoginState
                cliName="OpenCode CLI"
                progress={cliData.progress}
              />
            ) : step === 'gh-auth-login' ? (
              <AuthLoginState
                cliName="GitHub CLI"
                progress={cliData.progress}
              />
            ) : step === 'claude-setup' ? (
              <HostInstallState
                cliName="Claude CLI"
                binaryName="claude"
                expectedCommand={
                  preferences?.claude_update_command?.trim() || undefined
                }
                description={
                  preferences?.claude_update_command ? (
                    <>
                      Jean can run your configured Claude install/update command
                      for you, then verify that <code>claude</code> is available
                      on your host system.
                    </>
                  ) : undefined
                }
                buttonLabel={
                  preferences?.claude_update_command
                    ? 'Run install command'
                    : undefined
                }
                onRefresh={handleClaudeInstall}
              />
            ) : step === 'codex-setup' ? (
              <HostInstallState
                cliName="Codex CLI"
                binaryName="codex"
                expectedCommand={
                  preferences?.codex_update_command?.trim() || undefined
                }
                description={
                  preferences?.codex_update_command ? (
                    <>
                      Jean can run your configured Codex install/update command
                      for you, then verify that <code>codex</code> is available
                      on your host system.
                    </>
                  ) : undefined
                }
                buttonLabel={
                  preferences?.codex_update_command
                    ? 'Run install command'
                    : undefined
                }
                onRefresh={handleCodexInstall}
              />
            ) : step === 'opencode-setup' ? (
              <HostInstallState
                cliName="OpenCode CLI"
                binaryName="opencode"
                onRefresh={handleOpencodeInstall}
              />
            ) : cliData ? (
              cliData.installError ? (
                <ErrorState
                  cliName={backendLabel[cliData.type]}
                  error={cliData.installError}
                  onRetry={
                    cliData.type === 'claude'
                      ? handleClaudeInstall
                      : cliData.type === 'codex'
                        ? handleCodexInstall
                        : cliData.type === 'opencode'
                          ? handleOpencodeInstall
                          : handleGhInstall
                  }
                />
              ) : (
                <SetupState
                  cliName={backendLabel[cliData.type]}
                  versions={cliData.versions}
                  selectedVersion={
                    cliData.type === 'claude'
                      ? claudeVersion
                      : cliData.type === 'codex'
                        ? codexVersion
                        : cliData.type === 'opencode'
                          ? opencodeVersion
                          : ghVersion
                  }
                  currentVersion={
                    (cliData.type === 'claude' && isClaudeReinstall) ||
                    (cliData.type === 'codex' && isCodexReinstall) ||
                    (cliData.type === 'opencode' && isOpencodeReinstall) ||
                    (cliData.type === 'gh' && isGhReinstall)
                      ? cliData.currentVersion
                      : null
                  }
                  isLoading={cliData.isVersionsLoading}
                  isError={cliData.isVersionsError}
                  onRetry={cliData.onRetryVersions}
                  onVersionChange={
                    cliData.type === 'claude'
                      ? setClaudeVersion
                      : cliData.type === 'codex'
                        ? setCodexVersion
                        : cliData.type === 'opencode'
                          ? setOpencodeVersion
                          : setGhVersion
                  }
                  onInstall={
                    cliData.type === 'claude'
                      ? handleClaudeInstall
                      : cliData.type === 'codex'
                        ? handleCodexInstall
                        : cliData.type === 'opencode'
                          ? handleOpencodeInstall
                          : handleGhInstall
                  }
                />
              )
            ) : (
              <BackendSelectionState
                selectedBackends={selectedBackends}
                onToggle={handleBackendToggle}
                onContinue={handleBackendSelectionContinue}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface BackendSelectionStateProps {
  selectedBackends: AIBackend[]
  onToggle: (backend: AIBackend, checked: boolean) => void
  onContinue: () => void
  readyBackends?: AIBackend[]
}

function BackendSelectionState({
  selectedBackends,
  onToggle,
  onContinue,
  readyBackends = [],
}: BackendSelectionStateProps) {
  const availableBackends = AI_BACKENDS.filter(b => !readyBackends.includes(b))

  return (
    <div className="space-y-6">
      {availableBackends.length === 0 ? (
        <div className="text-center py-4">
          <p className="font-medium">All AI backends are installed</p>
          <p className="text-sm text-muted-foreground mt-1">
            You can manage versions in Settings.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {availableBackends.map(backend => {
              const id = `backend-${backend}`
              const checked = selectedBackends.includes(backend)
              const label = backendLabel[backend]

              return (
                <label
                  key={backend}
                  htmlFor={id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-accent/40"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={value => onToggle(backend, value === true)}
                  />
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      Install and authenticate {label}.
                    </p>
                  </div>
                </label>
              )
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            {readyBackends.length > 0
              ? 'Select the backends you want to add.'
              : 'You must install at least one AI backend. You can install more later in Settings.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Jean installs its own copies of each CLI and won&apos;t use or
            modify your global installations.
          </p>
        </>
      )}

      <Button onClick={onContinue} className="w-full" size="lg">
        Continue
      </Button>
    </div>
  )
}

interface SuccessStateProps {
  claudeVersion: string | null | undefined
  codexVersion: string | null | undefined
  opencodeVersion: string | null | undefined
  ghVersion: string | null | undefined
  onContinue: () => void
}

function SuccessState({
  claudeVersion,
  codexVersion,
  opencodeVersion,
  ghVersion,
  onContinue,
}: SuccessStateProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="font-medium">All Tools Ready</p>
        <div className="text-sm text-muted-foreground mt-2 space-y-1">
          {claudeVersion && <p>Claude CLI: v{claudeVersion}</p>}
          {codexVersion && <p>Codex CLI: v{codexVersion}</p>}
          {opencodeVersion && <p>OpenCode CLI: v{opencodeVersion}</p>}
          {ghVersion && <p>GitHub CLI: v{ghVersion}</p>}
          {!claudeVersion &&
            !codexVersion &&
            !opencodeVersion &&
            !ghVersion && <p>Setup complete</p>}
        </div>
      </div>

      <Button onClick={onContinue} className="w-full" size="lg">
        Continue to Jean
      </Button>
    </div>
  )
}

export default OnboardingDialog
