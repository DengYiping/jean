import { useUnreadSessionCount } from '@/services/chat'

/** Returns the number of unread sessions across all projects */
export function useUnreadCount(): number {
  const { data: unreadCount } = useUnreadSessionCount(true)
  return unreadCount ?? 0
}
