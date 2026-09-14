import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CodexPermissionApproval } from '@/types/chat'

export interface CodexPermissionApprovalProps {
  approval: CodexPermissionApproval
  onRespond: (rpcId: number, grant: boolean) => void
}

function permissionSummary(permissions: unknown): string[] {
  if (!permissions || typeof permissions !== 'object') return []
  const profile = permissions as {
    network?: { enabled?: boolean }
    fileSystem?: {
      read?: string[]
      write?: string[]
      entries?: { path?: unknown; access?: string }[]
    }
  }
  const summary: string[] = []
  if (profile.network?.enabled) summary.push('Enable network access')
  const fileSystem = profile.fileSystem
  if (fileSystem?.read?.length)
    summary.push(`Read: ${fileSystem.read.join(', ')}`)
  if (fileSystem?.write?.length)
    summary.push(`Write: ${fileSystem.write.join(', ')}`)
  if (fileSystem?.entries?.length)
    summary.push(
      ...fileSystem.entries.map(
        entry => `${entry.access ?? 'access'}: ${JSON.stringify(entry.path)}`
      )
    )
  return summary
}

/** Explicit, turn-scoped approval for an app-server permission profile. */
export function CodexPermissionApproval({
  approval,
  onRespond,
}: CodexPermissionApprovalProps) {
  const summary = permissionSummary(approval.permissions)
  return (
    <div className="mx-3 my-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex gap-2 text-sm font-medium">
        <ShieldAlert className="mt-0.5 size-4 text-amber-600" />
        Codex needs additional permissions
      </div>
      {approval.reason && (
        <p className="mt-2 text-sm text-muted-foreground">{approval.reason}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        This grants only the requested permissions for the current turn. Future
        requests will still require approval.
      </p>
      {summary.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
          {summary.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(approval.permissions, null, 2)}
        </pre>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => onRespond(approval.rpc_id, true)}>
          Grant for this turn
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onRespond(approval.rpc_id, false)}
        >
          Decline
        </Button>
      </div>
    </div>
  )
}
