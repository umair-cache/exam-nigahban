// "Left Exam Screen" detection: pure logic, no React and no DOM listeners,
// so every rule here is unit-tested directly (see
// __tests__/focusMonitor.test.js). useFocusMonitoring.js connects it to the
// browser's visibility and focus signals.
//
// Rules (FOCUS_RULE / FOCUS_MAX_AWAY_SEC in constants.js, mirrored by the
// backend's monitoring_rules row):
//   - an absence shorter than FOCUS_RULE.minDurationSec is a blip: nothing
//     is sent;
//   - a longer absence is sent once, when the student returns, with its
//     exact duration;
//   - an absence still going on at FOCUS_MAX_AWAY_SEC is sent at once (so
//     admins see it live) and is not sent again on return;
//   - if the page is closed while away, flush() returns the pending event.
// One camera snapshot is taken when the student leaves and attached to the
// event, through the same evidence capture the camera monitors use.

import {
  FOCUS_MAX_AWAY_SEC,
  FOCUS_RULE,
  SCREEN_CAPTURE_FIRST_DELAY_MS,
  SCREEN_CAPTURE_INTERVAL_MS,
  SCREEN_CAPTURE_MAX_PER_ABSENCE,
} from './constants'

export const LEFT_EXAM_SCREEN = 'LEFT_EXAM_SCREEN'
export const FOCUS_EVENT_SOURCE = 'browser_focus'

/**
 * Is the exam the student's active screen right now?
 *
 * Visible and focused -- or focus has moved into one of the exam's own
 * frames (an iSpring quiz is a cross-origin iframe; clicking a question
 * moves focus into it, which must not count as leaving).
 *
 * @param {object} snapshot
 * @param {string} snapshot.visibilityState - document.visibilityState
 * @param {boolean} snapshot.hasFocus - document.hasFocus()
 * @param {Element|null} snapshot.activeElement - document.activeElement
 * @param {Element[]} [snapshot.examFrames] - the exam's own iframes
 */
export function isExamScreenActive({ visibilityState, hasFocus, activeElement, examFrames = [] }) {
  if (visibilityState !== 'visible') return false
  if (hasFocus) return true
  return Boolean(activeElement) && examFrames.includes(activeElement)
}

/**
 * When, after leaving, each screenshot of an absence is taken (ms):
 * [1000, 6000, 11000, 16000, 21000, 26000] with the default constants.
 */
export function screenCaptureOffsetsMs({
  firstDelayMs = SCREEN_CAPTURE_FIRST_DELAY_MS,
  intervalMs = SCREEN_CAPTURE_INTERVAL_MS,
  max = SCREEN_CAPTURE_MAX_PER_ABSENCE,
} = {}) {
  return Array.from({ length: max }, (_, index) => firstDelayMs + index * intervalMs)
}

function roundSeconds(seconds) {
  return Math.round(seconds * 100) / 100
}

/**
 * Tracks one student's absences from the exam screen.
 *
 * @param {object} [deps]
 * @param {() => number} [deps.now] - clock in ms (injectable for tests)
 * @param {() => string|null} [deps.captureEvidence] - snapshot on leaving
 * @param {typeof FOCUS_RULE} [deps.rule]
 * @param {number} [deps.maxAwaySec]
 */
export function createFocusTracker({
  now = () => Date.now(),
  captureEvidence = () => null,
  rule = FOCUS_RULE,
  maxAwaySec = FOCUS_MAX_AWAY_SEC,
} = {}) {
  let awaySince = null
  let evidence = null
  let reportedLive = false
  let screenCaptures = []

  const buildEvent = (durationSeconds) => ({
    eventType: LEFT_EXAM_SCREEN,
    severity: rule.severity,
    confidence: rule.confidenceThreshold,
    durationSeconds: roundSeconds(durationSeconds),
    occurrences: rule.requiredOccurrences,
    source: FOCUS_EVENT_SOURCE,
    ...(evidence ? { evidenceImageBase64: evidence } : {}),
    // Screenshots taken so far during this absence (exams that require
    // screen sharing); uploaded right after the event is recorded.
    ...(screenCaptures.length ? { screenCaptures: [...screenCaptures] } : {}),
  })

  const awaySeconds = () => (awaySince === null ? 0 : (now() - awaySince) / 1000)

  const clear = () => {
    awaySince = null
    evidence = null
    reportedLive = false
    screenCaptures = []
  }

  return {
    isAway: () => awaySince !== null,

    /** Start time (ms) of the current absence, or null -- its identity. */
    awayStartedAt: () => awaySince,

    /**
     * Adds a screenshot to the absence that started at `absenceStartedAt`.
     * Ignored when that absence has already ended or been reported live
     * (a late capture must never attach to the wrong absence). Returns
     * whether it was kept.
     */
    addScreenCapture(absenceStartedAt, capture) {
      if (awaySince === null || awaySince !== absenceStartedAt || reportedLive) return false
      if (screenCaptures.length >= SCREEN_CAPTURE_MAX_PER_ABSENCE) return false
      screenCaptures.push(capture)
      return true
    },

    /** The student left. Repeated calls during one absence are ignored. */
    markAway() {
      if (awaySince !== null) return
      awaySince = now()
      reportedLive = false
      evidence = captureEvidence() || null
    },

    /**
     * The student is back. Returns the event to send (or null) and the
     * absence length, which the exam page uses for its notice -- given
     * even when the event was already sent live at FOCUS_MAX_AWAY_SEC.
     */
    markPresent() {
      if (awaySince === null) return { event: null, awaySeconds: null }
      const seconds = awaySeconds()
      const event = !reportedLive && seconds >= rule.minDurationSec ? buildEvent(seconds) : null
      const counted = seconds >= rule.minDurationSec ? roundSeconds(seconds) : null
      clear()
      return { event, awaySeconds: counted }
    },

    /** Periodic check: an absence reaching maxAwaySec is reported now. */
    tick() {
      if (awaySince === null || reportedLive) return null
      const seconds = awaySeconds()
      if (seconds < maxAwaySec) return null
      reportedLive = true
      return buildEvent(seconds)
    },

    /** The page is closing: the pending absence, if it qualifies. */
    flush() {
      if (awaySince === null) return null
      const seconds = awaySeconds()
      const event = !reportedLive && seconds >= rule.minDurationSec ? buildEvent(seconds) : null
      clear()
      return event
    },

    /** Monitoring switched off (exam locked, unmounted): drop, send nothing. */
    reset: clear,
  }
}
