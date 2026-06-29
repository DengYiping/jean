import { invoke } from '@/lib/transport'
import { isNativeApp } from './environment'

export function notifyIfBackground(title: string, body?: string): void {
  if (!isNativeApp()) return
  if (document.hasFocus()) return
  void invoke('send_native_notification', { title, body }).catch(
    () => undefined
  )
}
