import {
  AlertTriangle,
  CheckCircle2,
  CirclePause,
  FileText,
  HelpCircle,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react'
import type { Session } from '@/types/chat'

export function hasPendingPermissionRequest(session: Session): boolean {
  return (session.pending_permission_denials?.length ?? 0) > 0
}

export function isUnreadSession(session: Session): boolean {
  if (session.archived_at) return false

  const actionableStatuses = ['completed', 'cancelled', 'crashed']
  const hasFinishedRun =
    session.last_run_status &&
    actionableStatuses.includes(session.last_run_status)
  const isWaiting = session.waiting_for_input
  const isReviewing = session.is_reviewing
  const hasPermissionRequest = hasPendingPermissionRequest(session)

  if (!hasFinishedRun && !isWaiting && !isReviewing && !hasPermissionRequest) {
    return false
  }

  if (!session.last_opened_at) return true
  return session.last_opened_at < session.updated_at
}

export function getUnreadSessionStatus(session: Session): {
  icon: LucideIcon
  label: string
  className: string
} | null {
  if (hasPendingPermissionRequest(session)) {
    return {
      icon: ShieldAlert,
      label: 'Needs permission',
      className: 'text-amber-500',
    }
  }

  if (session.waiting_for_input) {
    const isPlan = session.waiting_for_input_type === 'plan'
    return {
      icon: isPlan ? FileText : HelpCircle,
      label: isPlan ? 'Needs approval' : 'Needs input',
      className: 'text-yellow-500',
    }
  }

  const config: Record<
    string,
    { icon: LucideIcon; label: string; className: string }
  > = {
    completed: {
      icon: CheckCircle2,
      label: 'Completed',
      className: 'text-green-500',
    },
    cancelled: {
      icon: CirclePause,
      label: 'Cancelled',
      className: 'text-muted-foreground',
    },
    crashed: {
      icon: AlertTriangle,
      label: 'Crashed',
      className: 'text-destructive',
    },
  }

  if (session.last_run_status && config[session.last_run_status]) {
    return config[session.last_run_status] ?? null
  }

  return null
}
