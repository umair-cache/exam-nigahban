// Entire-screen sharing for exams that require it (Exam.require_screen_share).
//
// Browsers only allow screen capture after the user explicitly chooses what
// to share in the browser's own picker, and they show a "sharing your
// screen" indicator the whole time -- nothing here can or tries to capture
// silently. What this module adds:
//   - verification that the ENTIRE screen (not a tab or window) was shared;
//   - one shared session, so permission given on the System Check page is
//     still active on the exam page (same single-page app, no reload);
//   - capture of a downscaled, stamped JPEG frame on demand. Frames are
//     only requested while the candidate is away from the exam screen
//     (see useFocusMonitoring.js).

import { computeCaptureDimensions, extractBase64FromDataUrl } from './evidenceCapture'
import {
  SCREEN_CAPTURE_JPEG_QUALITIES,
  SCREEN_CAPTURE_MAX_BYTES,
  SCREEN_CAPTURE_MAX_WIDTH_PX,
  SCREEN_SHARE_STOPPED_RULE,
} from './constants'

export const SCREEN_SHARE_STOPPED = 'SCREEN_SHARE_STOPPED'

/** Error codes thrown by requestEntireScreenShare. */
export const SCREEN_SHARE_ERRORS = Object.freeze({
  unsupported: 'unsupported',
  denied: 'denied',
  notEntireScreen: 'not-entire-screen',
  failed: 'failed',
})

export function screenShareSupported() {
  return Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia)
}

/**
 * Did the candidate share their entire screen? Chrome and Edge report the
 * chosen surface as 'monitor' / 'window' / 'browser'. A browser that does
 * not report it (e.g. Safari) cannot be verified, so it does not pass.
 */
export function isEntireScreenSettings(settings) {
  return settings?.displaySurface === 'monitor'
}

/** Bytes encoded by a base64 string (without data-URL prefix). */
export function base64ByteLength(base64) {
  if (!base64) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

export function buildScreenShareStoppedEvent() {
  return {
    eventType: SCREEN_SHARE_STOPPED,
    severity: SCREEN_SHARE_STOPPED_RULE.severity,
    confidence: SCREEN_SHARE_STOPPED_RULE.confidenceThreshold,
    durationSeconds: SCREEN_SHARE_STOPPED_RULE.minDurationSec,
    occurrences: SCREEN_SHARE_STOPPED_RULE.requiredOccurrences,
    source: 'browser_screen_share',
  }
}

// --- The shared session -------------------------------------------------------

let activeStream = null
let frameVideo = null
const endedListeners = new Set()

function liveTrack(stream) {
  const track = stream?.getVideoTracks?.()[0]
  return track && track.readyState === 'live' ? track : null
}

function notifyEnded() {
  endedListeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // A listener's failure must not stop the others.
    }
  })
}

/** The active entire-screen share, or null. */
export function getActiveScreenShare() {
  return liveTrack(activeStream) ? activeStream : null
}

/**
 * Asks the candidate to share their entire screen (must be called from a
 * click). Resolves with the stream; rejects with an Error whose `code` is
 * one of SCREEN_SHARE_ERRORS.
 */
export async function requestEntireScreenShare() {
  if (!screenShareSupported()) {
    throw Object.assign(new Error('Screen sharing is not supported in this browser.'), {
      code: SCREEN_SHARE_ERRORS.unsupported,
    })
  }
  if (getActiveScreenShare()) return activeStream

  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor', frameRate: { ideal: 5, max: 10 } },
      audio: false,
      // Hints for Chromium's picker; ignored by browsers without them.
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    })
  } catch (err) {
    const code = err?.name === 'NotAllowedError' ? SCREEN_SHARE_ERRORS.denied : SCREEN_SHARE_ERRORS.failed
    throw Object.assign(new Error(err?.message || 'Screen sharing was not started.'), { code })
  }

  const track = liveTrack(stream)
  if (!track || !isEntireScreenSettings(track.getSettings?.())) {
    stream.getTracks().forEach((t) => t.stop())
    throw Object.assign(new Error('Please share your entire screen, not a tab or a window.'), {
      code: SCREEN_SHARE_ERRORS.notEntireScreen,
    })
  }

  activeStream = stream
  track.addEventListener('ended', () => {
    if (activeStream === stream) {
      activeStream = null
      frameVideo = null
      notifyEnded()
    }
  })
  return stream
}

/** Ends the share (exam finished or left). Does not notify listeners. */
export function stopScreenShare() {
  const stream = activeStream
  activeStream = null
  frameVideo = null
  stream?.getTracks().forEach((t) => t.stop())
}

/** Called when the candidate (or browser) ends the share. Returns unsubscribe. */
export function onScreenShareEnded(listener) {
  endedListeners.add(listener)
  return () => endedListeners.delete(listener)
}

// --- Capture --------------------------------------------------------------------

async function grabFrameSource(track) {
  // ImageCapture keeps working while the exam tab is in the background,
  // which is exactly when frames are needed.
  if (typeof ImageCapture === 'function') {
    try {
      return await new ImageCapture(track).grabFrame()
    } catch {
      // Fall back to a video element below.
    }
  }
  if (!frameVideo) {
    frameVideo = document.createElement('video')
    frameVideo.muted = true
    frameVideo.playsInline = true
    frameVideo.srcObject = activeStream
    await frameVideo.play().catch(() => {})
  }
  return frameVideo.readyState >= 2 ? frameVideo : null
}

function sourceSize(source) {
  return {
    width: source.videoWidth || source.width,
    height: source.videoHeight || source.height,
  }
}

/**
 * One JPEG frame of the shared screen, downscaled to
 * SCREEN_CAPTURE_MAX_WIDTH_PX, with `stampText` (e.g. student ID and time)
 * drawn along the bottom edge, encoded under SCREEN_CAPTURE_MAX_BYTES.
 * Resolves with base64 (no data-URL prefix), or null -- never throws.
 */
export async function captureScreenFrame(stampText = '') {
  try {
    const track = liveTrack(activeStream)
    if (!track) return null
    const source = await grabFrameSource(track)
    if (!source) return null

    const { width, height } = sourceSize(source)
    const dimensions = computeCaptureDimensions(width, height, SCREEN_CAPTURE_MAX_WIDTH_PX)
    if (!dimensions) return null

    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, dimensions.width, dimensions.height)
    source.close?.()

    if (stampText) {
      const band = 22
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)'
      ctx.fillRect(0, dimensions.height - band, dimensions.width, band)
      ctx.fillStyle = '#ffffff'
      ctx.font = '13px system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(stampText, 8, dimensions.height - band / 2)
    }

    for (const quality of SCREEN_CAPTURE_JPEG_QUALITIES) {
      const base64 = extractBase64FromDataUrl(canvas.toDataURL('image/jpeg', quality))
      if (base64 && base64ByteLength(base64) <= SCREEN_CAPTURE_MAX_BYTES) return base64
    }
    return null
  } catch {
    return null
  }
}
