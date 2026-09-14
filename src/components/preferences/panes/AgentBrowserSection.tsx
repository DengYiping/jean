import React, { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Copy, Globe, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { copyToClipboard } from '@/lib/clipboard'
import { invoke } from '@/lib/transport'
import { invalidateAllMcpServers } from '@/services/mcp'
import type { CliBackend } from '@/types/preferences'
import { SettingsSection } from '../SettingsSection'

interface AgentBrowserStatus {
  installed: boolean
  binaryPath: string | null
  version: string | null
  profilePath: string
  profileExists: boolean
  managedDir: string
  managedInstall: boolean
  claudeSnippet: string
  codexSnippet: string
  installHint: string
}

interface AgentBrowserInstallResult {
  backend: CliBackend
  status: 'installed' | 'error'
}

type InstallState = 'idle' | 'installing' | 'success' | 'error'

export const AgentBrowserSection: React.FC = () => {
  const queryClient = useQueryClient()
  const { installedBackends } = useInstalledBackends()
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [installMessage, setInstallMessage] = useState('')
  const {
    data: status,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['agentBrowserStatus'],
    queryFn: () => invoke<AgentBrowserStatus>('get_agent_browser_status'),
    staleTime: 15_000,
  })

  const handleEnsureProfile = useCallback(async () => {
    try {
      await invoke<AgentBrowserStatus>('ensure_agent_browser_profile')
      await refetch()
      toast.success('Agent Browser profile ready')
    } catch (error) {
      toast.error(`Failed to create profile: ${error}`)
    }
  }, [refetch])

  const handleInstall = useCallback(async () => {
    setInstallState('installing')
    setInstallMessage('Installing agent-browser, Chromium, and MCP setup…')
    const toastId = toast.loading('Installing Agent Browser and Chromium…')
    try {
      const next = await invoke<AgentBrowserStatus>('install_agent_browser')
      queryClient.setQueryData(['agentBrowserStatus'], next)
      const results = await invoke<AgentBrowserInstallResult[]>(
        'install_agent_browser_mcp',
        { backends: installedBackends }
      )
      const failures = results.filter(result => result.status === 'error')
      if (failures.length > 0) {
        throw new Error(`MCP setup failed for ${failures.length} backend(s)`)
      }
      invalidateAllMcpServers(undefined, installedBackends)
      queryClient.invalidateQueries({ queryKey: ['preferences'] })
      await refetch()
      setInstallState('success')
      setInstallMessage(
        `${next.version ? `Installed agent-browser ${next.version}` : 'Installed agent-browser and Chromium'}${results.length ? ` and added MCP to ${results.length} backend${results.length === 1 ? '' : 's'}` : ''}`
      )
      toast.success('Agent Browser ready', { id: toastId })
    } catch (error) {
      setInstallState('error')
      setInstallMessage(`Setup failed: ${error}`)
      toast.error(`Agent Browser setup failed: ${error}`, { id: toastId })
    }
  }, [installedBackends, queryClient, refetch])

  const handleCopy = (label: string, content: string | undefined) => {
    if (!content) return toast.error(`No ${label} snippet available`)
    copyToClipboard(content)
    toast.success(`${label} snippet copied`)
  }

  return (
    <SettingsSection
      title="Agent Browser"
      anchorId="pref-mcp-section-agent-browser"
    >
      <p className="text-sm text-muted-foreground">
        Give agents a real Chromium browser with a Jean-managed login profile.
        Log in manually once; future Claude, Codex, and OpenCode sessions reuse
        cookies.
      </p>
      <div className="space-y-3 rounded-md border px-4 py-3">
        {isLoading || isFetching ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Checking Agent Browser…
          </span>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {status?.installed ? (
                <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <CheckCircle className="size-3.5" />
                  agent-browser{status.version ? ` ${status.version}` : ''}{' '}
                  installed{status.managedInstall ? ' (Jean-managed)' : ''}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <XCircle className="size-3.5" />
                  agent-browser not installed
                </span>
              )}
              {status?.profileExists && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Globe className="size-3.5" />
                  Profile ready
                </span>
              )}
            </div>
            {status && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="break-all">
                  <span className="font-medium text-foreground">Profile: </span>
                  {status.profilePath}
                </div>
                {status.binaryPath && (
                  <div className="break-all">
                    <span className="font-medium text-foreground">
                      Binary:{' '}
                    </span>
                    {status.binaryPath}
                  </div>
                )}
                {!status.installed && (
                  <div className="rounded bg-muted/50 px-2 py-1.5 font-mono text-[11px]">
                    {status.installHint}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void handleInstall()}
            disabled={installState === 'installing'}
          >
            {installState === 'installing' ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Installing agent-browser…
              </>
            ) : status?.installed ? (
              'Reinstall / update agent-browser'
            ) : (
              'Install agent-browser'
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void handleEnsureProfile()}
          >
            Create profile
          </Button>
          {status && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleCopy('Claude', status.claudeSnippet)}
              >
                <Copy className="size-3.5" />
                Claude snippet
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleCopy('Codex', status.codexSnippet)}
              >
                <Copy className="size-3.5" />
                Codex snippet
              </Button>
            </>
          )}
        </div>
        {installMessage && (
          <p
            className={
              installState === 'error'
                ? 'text-xs text-red-600 dark:text-red-400'
                : 'text-xs text-muted-foreground'
            }
          >
            {installMessage}
          </p>
        )}
        <div className="space-y-1 text-xs text-muted-foreground">
          <Label className="text-xs text-foreground">How to use</Label>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              Click <strong>Install agent-browser</strong> to install the npm
              package, Chromium, and MCP configuration for installed backends.
              Requires <code>npm</code> on PATH.
            </li>
            <li>
              For first login, run headed (or under VNC) and sign in manually.
            </li>
            <li>
              Ask the agent to use the browser; it reuses the Jean profile.
            </li>
          </ol>
        </div>
      </div>
    </SettingsSection>
  )
}
