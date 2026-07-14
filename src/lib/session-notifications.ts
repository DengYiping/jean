import { invoke } from '@/lib/transport'
import { isNativeApp } from './environment'
import type { WorkspaceSessionTarget } from './workspace-navigation'

export type SessionNotificationTarget = Pick<
  WorkspaceSessionTarget,
  'sessionId'
> &
  Partial<Omit<WorkspaceSessionTarget, 'sessionId'>>

export function notifyIfBackground(
  title: string,
  body?: string,
  target?: SessionNotificationTarget
): void {
  if (!isNativeApp()) return
  void invoke('send_native_notification', {
    title,
    body,
    backgroundOnly: true,
    target,
  }).catch(() => undefined)
}
