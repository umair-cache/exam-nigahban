import { useEffect, useRef } from 'react'
import { FOCUS_CHECK_INTERVAL_MS } from './constants'
import { createFocusTracker, isExamScreenActive, screenCaptureOffsetsMs } from './focusMonitor'

/**
 * "Left Exam Screen" monitoring: watches whether the exam page is the
 * student's active screen while `active` is true, and reports qualifying
 * absences through `onEvent` (the same handler the camera monitors use).
 *
 * UI glue only -- every rule lives in focusMonitor.js. Unlike the camera
 * monitors it does not need the camera: only the evidence snapshot does,
 * and `captureEvidence` simply returns null without one.
 *
 * @param {object} options
 * @param {boolean} options.active - session in progress and not locked
 * @param {(event: object) => void} options.onEvent - normal sender
 * @param {(event: object) => void} options.onExitEvent - page-close sender
 * @param {() => string|null} options.captureEvidence - camera snapshot
 * @param {() => Element[]} options.getExamFrames - the exam's own iframes
 * @param {(awaySeconds: number) => void} [options.onReturn] - for the notice
 * @param {() => boolean} [options.isSuspended] - true while the page itself
 *   legitimately moves focus away (the browser's screen-share picker); an
 *   absence in progress is then dropped, never reported
 * @param {() => Promise<string|null>} [options.captureScreen] - a screenshot
 *   of the shared screen, or null; when given, screenshots are taken during
 *   each absence on the screenCaptureOffsetsMs() schedule
 */
export default function useFocusMonitoring({
  active,
  onEvent,
  onExitEvent,
  captureEvidence,
  getExamFrames,
  onReturn,
  isSuspended,
  captureScreen,
}) {
  // Latest callbacks, read by the listeners below, so changing a callback
  // never tears down and restarts monitoring mid-absence.
  const callbacks = useRef({})
  useEffect(() => {
    callbacks.current = {
      onEvent,
      onExitEvent,
      captureEvidence,
      getExamFrames,
      onReturn,
      isSuspended,
      captureScreen,
    }
  })

  useEffect(() => {
    if (!active) return undefined

    const tracker = createFocusTracker({
      captureEvidence: () => callbacks.current.captureEvidence?.() ?? null,
    })
    const timeouts = new Set()
    const captureTimers = new Set()

    const cancelScreenCaptures = () => {
      captureTimers.forEach(clearTimeout)
      captureTimers.clear()
    }

    // Screenshots for the absence that started at `startedAt`, on schedule.
    // Each one checks the absence is still the same before and after the
    // capture, so a late frame can never land on a different absence.
    const scheduleScreenCaptures = (startedAt) => {
      if (!callbacks.current.captureScreen) return
      screenCaptureOffsetsMs().forEach((offsetMs, index) => {
        const id = setTimeout(() => {
          captureTimers.delete(id)
          if (tracker.awayStartedAt() !== startedAt) return
          Promise.resolve(callbacks.current.captureScreen?.())
            .then((imageBase64) => {
              if (imageBase64) {
                tracker.addScreenCapture(startedAt, { sequence: index + 1, offsetMs, imageBase64 })
              }
            })
            .catch(() => {})
        }, offsetMs)
        captureTimers.add(id)
      })
    }

    const evaluate = () => {
      if (callbacks.current.isSuspended?.()) {
        cancelScreenCaptures()
        tracker.reset()
        return
      }
      const present = isExamScreenActive({
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        activeElement: document.activeElement,
        examFrames: callbacks.current.getExamFrames?.() ?? [],
      })
      if (!present) {
        const wasAway = tracker.isAway()
        tracker.markAway()
        if (!wasAway) scheduleScreenCaptures(tracker.awayStartedAt())
        return
      }
      cancelScreenCaptures()
      const { event, awaySeconds } = tracker.markPresent()
      if (event) callbacks.current.onEvent?.(event)
      if (awaySeconds) callbacks.current.onReturn?.(awaySeconds)
    }

    // Deferred one task: when focus moves into the exam's iframe, the
    // window "blur" fires before document.activeElement is updated.
    const evaluateSoon = () => {
      const id = setTimeout(() => {
        timeouts.delete(id)
        evaluate()
      }, 0)
      timeouts.add(id)
    }

    const handlePageHide = () => {
      const event = tracker.flush()
      if (event) callbacks.current.onExitEvent?.(event)
    }

    // A periodic re-check catches a missed focus event, and reports an
    // absence that reaches FOCUS_MAX_AWAY_SEC while it is still going on.
    const interval = setInterval(() => {
      evaluate()
      const live = tracker.tick()
      if (live) callbacks.current.onEvent?.(live)
    }, FOCUS_CHECK_INTERVAL_MS)

    document.addEventListener('visibilitychange', evaluateSoon)
    window.addEventListener('blur', evaluateSoon)
    window.addEventListener('focus', evaluateSoon)
    window.addEventListener('pagehide', handlePageHide)
    evaluateSoon()

    return () => {
      clearInterval(interval)
      timeouts.forEach(clearTimeout)
      cancelScreenCaptures()
      document.removeEventListener('visibilitychange', evaluateSoon)
      window.removeEventListener('blur', evaluateSoon)
      window.removeEventListener('focus', evaluateSoon)
      window.removeEventListener('pagehide', handlePageHide)
      // Monitoring switched off (locked, submitted, unmounted): an
      // absence in progress is dropped, never reported.
      tracker.reset()
    }
  }, [active])
}
