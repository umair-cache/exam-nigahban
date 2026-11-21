import { useEffect, useRef } from 'react'

// Admin-alert message types that can change what the monitoring lists show:
// a new violation, or a review/void made by any administrator.
const LIVE_REFRESH_TYPES = new Set(['monitoring_event', 'review_queue_changed'])

export const LIVE_REFRESH_DEBOUNCE_MS = 1000

export function shouldLiveRefresh(message) {
  return Boolean(message && LIVE_REFRESH_TYPES.has(message.type))
}

// Calls `refresh` once, 1s after the last relevant alert, so a burst of
// violations becomes a single refetch. The alert already on screen when the
// page mounts is ignored: the page's own first load covers it.
export function useLiveRefresh(latestAlert, refresh, delayMs = LIVE_REFRESH_DEBOUNCE_MS) {
  const refreshRef = useRef(refresh)
  const seenAlertRef = useRef(latestAlert)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    if (latestAlert === seenAlertRef.current) return undefined
    seenAlertRef.current = latestAlert
    if (!shouldLiveRefresh(latestAlert)) return undefined
    const timer = setTimeout(() => refreshRef.current(), delayMs)
    return () => clearTimeout(timer)
  }, [latestAlert, delayMs])
}
