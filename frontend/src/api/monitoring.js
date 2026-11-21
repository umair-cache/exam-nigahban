import apiClient, { API_BASE_URL, TOKEN_KEY } from './client'
import { notifyPendingReviewsChanged } from '../utils/pendingReviews'

export async function listMonitoringEvents({
  status,
  severity,
  eventType,
  sessionId,
  page,
  pageSize,
} = {}) {
  const { data } = await apiClient.get('/api/monitoring/events', {
    params: {
      status: status || undefined,
      severity: severity || undefined,
      event_type: eventType || undefined,
      session_id: sessionId || undefined,
      page,
      page_size: pageSize,
    },
  })
  return data
}

// The request body for a monitoring event, shared by the normal sender
// and the page-close sender below so the two can never drift apart.
function toMonitoringEventBody(sessionId, event) {
  return {
    session_id: sessionId,
    event_type: event.eventType,
    severity: event.severity,
    confidence: event.confidence,
    duration_seconds: event.durationSeconds,
    occurrences: event.occurrences,
    // Optional: omitted entirely (rather than sent as e.g. undefined) when
    // the detector didn't set one, so a MediaPipe event's request body
    // stays byte-identical to before this field existed (Milestone 6 Phase
    // 2 Step 5/6) and the backend's own "browser_mediapipe" default (see
    // backend/app/schemas/monitoring.py) keeps applying exactly as before.
    // useMobilePhoneMonitoring.js sets event.source = 'browser_yolox'.
    ...(event.source ? { source: event.source } : {}),
    // Optional: omitted entirely (rather than sent as null) when capture
    // failed or was unavailable, keeping the request identical to the
    // pre-evidence payload shape in that case.
    ...(event.evidenceImageBase64 ? { evidence_image_base64: event.evidenceImageBase64 } : {}),
  }
}

export async function postMonitoringEvent(sessionId, event) {
  const { data } = await apiClient.post('/api/monitoring/events', toMonitoringEventBody(sessionId, event))
  return data
}

// Browsers cap a request that may outlive its page (fetch keepalive) at
// 64 KB in total, so the evidence photo is left out when the body would be
// larger -- the absence itself is still recorded.
const KEEPALIVE_BODY_LIMIT = 60000

// Sends an event while the page is closing (e.g. a "Left Exam Screen"
// absence pending when the tab is closed). axios cannot outlive the page,
// so this uses fetch with keepalive. Best-effort: never throws.
export function sendMonitoringEventOnExit(sessionId, event) {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    let body = JSON.stringify(toMonitoringEventBody(sessionId, event))
    if (body.length > KEEPALIVE_BODY_LIMIT) {
      const withoutEvidence = { ...event }
      delete withoutEvidence.evidenceImageBase64
      body = JSON.stringify(toMonitoringEventBody(sessionId, withoutEvidence))
    }
    fetch(`${API_BASE_URL}/api/monitoring/events`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    }).catch(() => {})
  } catch {
    // Nothing more can be done while the page is closing.
  }
}

// Session-level rollup: one row per student exam session, with that
// session's violations aggregated by type. Drill-down uses
// listMonitoringEvents({ sessionId }) above -- the individual events (and
// their evidence) are never merged, only grouped for display.
export async function listMonitoringSessions({
  status,
  severity,
  eventType,
  examId,
  sessionId,
  sessionStatus,
  search,
  page,
  pageSize,
} = {}) {
  const { data } = await apiClient.get('/api/monitoring/sessions', {
    params: {
      status: status || undefined,
      severity: severity || undefined,
      event_type: eventType || undefined,
      exam_id: examId || undefined,
      session_id: sessionId || undefined,
      session_status: sessionStatus || undefined,
      search: search || undefined,
      page,
      page_size: pageSize,
    },
  })
  return data
}

// --- Screen captures (exams that require entire-screen sharing) -------------

// Student: attach one screenshot to their own just-recorded
// LEFT_EXAM_SCREEN event. The server checks ownership, event type, the
// exam's requirement, an upload window and the per-event limit.
export async function uploadScreenCapture(eventId, { sequence, offsetMs, imageBase64 }) {
  const { data } = await apiClient.post(`/api/monitoring/events/${eventId}/screen-captures`, {
    image_base64: imageBase64,
    sequence,
    offset_ms: offsetMs,
  })
  return data
}

// Admin: the screenshots of one event, in the order they were taken.
export async function listScreenCaptures(eventId) {
  const { data } = await apiClient.get(`/api/monitoring/events/${eventId}/screen-captures`)
  return data.items
}

// Admin: one screenshot as a blob (authenticated, so not a plain <img src>).
// Every fetch is logged server-side as a view.
export async function fetchScreenCaptureImageBlob(captureId) {
  const { data } = await apiClient.get(`/api/monitoring/screen-captures/${captureId}/image`, {
    responseType: 'blob',
  })
  return data
}

// Admin: Confirm / Ignore a violation directly, for one that has no camera
// photo (the per-evidence review in api/evidence.js needs one). Same
// decision record on the server either way.
export async function reviewMonitoringEvent(eventId, action, reason) {
  const { data } = await apiClient.post(`/api/monitoring/events/${eventId}/review`, {
    action,
    ...(reason ? { reason } : {}),
  })
  notifyPendingReviewsChanged()
  return data
}

// One CONFIRMED/IGNORED decision for up to 100 violations at once. Every
// violation still gets its own audit record on the server. Returns
// { reviewed: [{event_id, status, action_id}], skipped: [{event_id, reason}] }.
export const BULK_REVIEW_MAX_EVENTS = 100

export async function bulkReviewMonitoringEvents(eventIds, action, reason) {
  const { data } = await apiClient.post('/api/monitoring/events/bulk-review', {
    event_ids: eventIds,
    action,
    reason,
  })
  notifyPendingReviewsChanged()
  return data
}
