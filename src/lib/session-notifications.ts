import { invoke } from '@/lib/transport'
import { isNativeApp } from './environment'

export function notifyIfBackground(title: string, body?: string): void {
  if (!isNativeApp()) return
  void invoke('send_native_notification', {
    title,
    body,
    backgroundOnly: true,
  }).catch(() => undefined)
}
