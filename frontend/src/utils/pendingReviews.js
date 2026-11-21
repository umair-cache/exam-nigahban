// A small in-app signal: "the number of events awaiting review may have
// changed". Sent by the API helpers right after a review or a void
// succeeds, and listened to by the admin header so its alert badge updates
// at once instead of on the next page load.
//
// The signal carries no data -- listeners simply re-read the count from the
// server, so the badge always shows the server's truth. Other open tabs of
// the app are told too (BroadcastChannel, where the browser supports it).

const EVENT_NAME = 'exam-nigahban:pending-reviews-changed'
const CHANNEL_NAME = 'exam-nigahban-pending-reviews'
// Identifies this tab, so it ignores its own cross-tab message (it has
// already been told through the in-tab event).
const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

function openChannel() {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null
  } catch {
    return null
  }
}

export function notifyPendingReviewsChanged() {
  window.dispatchEvent(new Event(EVENT_NAME))
  const channel = openChannel()
  if (channel) {
    channel.postMessage({ from: TAB_ID })
    channel.close()
  }
}

// Calls `handler` whenever the signal arrives from this tab or another one.
// Returns an unsubscribe function.
export function onPendingReviewsChanged(handler) {
  window.addEventListener(EVENT_NAME, handler)
  const channel = openChannel()
  if (channel) {
    channel.onmessage = (message) => {
      if (message.data?.from !== TAB_ID) handler()
    }
  }
  return () => {
    window.removeEventListener(EVENT_NAME, handler)
    channel?.close()
  }
}
