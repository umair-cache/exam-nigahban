// Centralized AI-monitoring configuration for Phase 5 (Face Monitoring).
//
// These are the baseline MVP values documented in the README. Every
// threshold used anywhere in the monitoring engine or UI must come from
// here rather than being hard-coded inline, so recalibration during testing
// only requires touching this one file.

// Detection loop cadence: how often a video frame is actually run through
// the face landmarker. MediaPipe can run faster than this, but sampling at
// ~4-5 fps is enough for temporal rules measured in seconds and keeps CPU
// usage low during a long exam session.
export const DETECTION_INTERVAL_MS = 220

// Degrees beyond which the head is considered turned in a cardinal
// direction. These are intentionally modest so HEAD_LEFT/RIGHT/UP/DOWN
// capture a clear, sustained turn rather than normal micro-movement.
export const HEAD_POSE_ANGLE_THRESHOLD_DEG = {
  yawLeft: -15,
  yawRight: 15,
  pitchUp: 12,
  pitchDown: -12,
}

// Beyond this larger angle the head/gaze is considered oriented away from
// the screen altogether (LOOKING_AWAY), rather than a moderate directional
// turn. Chosen to be a technically-justified escalation of the same
// yaw/pitch signal already used for the directional rules, not a separate
// unproven detector.
export const LOOKING_AWAY_ANGLE_THRESHOLD_DEG = {
  yaw: 30,
  pitch: 22,
}

// Baseline temporal rules — see the monitoring-rule table in the README. FACE_ABSENT / MULTIPLE_FACES use a "configurable" confidence
// threshold per the spec; 0.5 is the MVP default (face-count based
// conditions are less confidence-sensitive than pose classification).
export const MONITORING_RULES = {
  HEAD_LEFT: { minDurationSec: 3, requiredOccurrences: 3, confidenceThreshold: 0.75, severity: 'medium' },
  HEAD_RIGHT: { minDurationSec: 3, requiredOccurrences: 3, confidenceThreshold: 0.75, severity: 'medium' },
  HEAD_UP: { minDurationSec: 3, requiredOccurrences: 3, confidenceThreshold: 0.75, severity: 'medium' },
  HEAD_DOWN: { minDurationSec: 3, requiredOccurrences: 3, confidenceThreshold: 0.75, severity: 'medium' },
  LOOKING_AWAY: { minDurationSec: 3, requiredOccurrences: 3, confidenceThreshold: 0.75, severity: 'medium' },
  FACE_ABSENT: { minDurationSec: 3, requiredOccurrences: 1, confidenceThreshold: 0.5, severity: 'high' },
  MULTIPLE_FACES: { minDurationSec: 2, requiredOccurrences: 1, confidenceThreshold: 0.5, severity: 'high' },
}

export const MONITORING_EVENT_TYPES = Object.freeze(Object.keys(MONITORING_RULES))

// Milestone 6 Phase 2 Step 3: mobile-phone detection (YOLOX) temporal rule
// and scheduling interval. Deliberately kept OUT of MONITORING_RULES /
// MONITORING_EVENT_TYPES above (the face-monitoring engine's own rule
// table) -- useMobilePhoneMonitoring.js constructs a second, fully
// independent createTemporalRuleEngine() instance scoped to only this one
// rule, so its state never shares a Map (or anything else) with the face
// engine's. Baseline values are this file's own MOBILE_PHONE row from
// the README's temporal-rule table (~1s persistence, 1
// occurrence, High severity). The confidence bar was lowered from the
// original 0.80: the temporal engine compares this against the MINIMUM
// confidence observed across the whole episode (see temporalRuleEngine.js
// minConfidenceSeen), so at 0.80 a single dipped frame -- motion blur, a
// hand passing over the phone -- discarded an otherwise solid one-second
// sighting. Persistence, not the confidence bar, is what filters noise.
export const MOBILE_PHONE_RULE = {
  // Lowered from 1s so a phone that is only glanced at is still caught.
  //
  // Duration is measured from the FIRST detecting frame, and the YOLOX
  // loop runs every YOLOX_DETECTION_INTERVAL_MS (200ms), so this is really
  // a frame count: 1s required six consecutive detections, 0.5s requires
  // four (0ms, 200, 400, 600). Persistence therefore still does its job as
  // the noise filter -- four consecutive frames is a real sighting, not a
  // flicker -- which matters because the confidence bar is now 0.4 rather
  // than 0.8 and can no longer carry that job alone.
  minDurationSec: 0.5,
  requiredOccurrences: 1,
  confidenceThreshold: 0.4,
  severity: 'high',
}

// YOLOX Worker detection-loop cadence: 200ms, the ~5 FPS rate validated
// end-to-end in Milestone 5.6's real combined-mode browser benchmark (see
// RECOMMENDED_YOLOX_TARGET_FPS in spike/objectDetection/constants.js, that
// benchmark's own source of truth) -- reused as the production value here,
// not re-derived.
export const YOLOX_DETECTION_INTERVAL_MS = 200

// Evidence capture (Phase 6): a single downsized still frame is captured
// only for a frame that already produced a stabilized monitoring event
// above -- never captured continuously. Kept small so upload stays fast
// and well under the backend's server-side size cap.
export const EVIDENCE_CAPTURE_MAX_WIDTH_PX = 480
export const EVIDENCE_JPEG_QUALITY = 0.7

// "Left Exam Screen" (LEFT_EXAM_SCREEN): the exam page stopped being the
// active screen -- another tab, window, app or monitor. Detected from the
// browser's visibility/focus signals (see focusMonitor.js), not the camera.
//
// Must match the LEFT_EXAM_SCREEN row in
// backend/app/db/seed_monitoring_rules.py, which the API re-validates every
// event against: a stricter value there would reject what is sent here.
// confidenceThreshold is 1.0 because the signal is certain, not a model
// score. Severity is medium like the other behaviour-based activities;
// how serious an absence was shows in its recorded duration.
export const FOCUS_RULE = {
  minDurationSec: 2,
  requiredOccurrences: 1,
  confidenceThreshold: 1,
  severity: 'medium',
}

// An absence still going on after this long is reported immediately, so
// administrators see it live instead of only when the student returns.
export const FOCUS_MAX_AWAY_SEC = 60

// How often an ongoing absence is checked against FOCUS_MAX_AWAY_SEC, and
// presence re-checked as a safety net for a missed focus event.
export const FOCUS_CHECK_INTERVAL_MS = 1000

// Screen evidence for LEFT_EXAM_SCREEN on exams that require entire-screen
// sharing (Exam.require_screen_share). Screenshots are taken ONLY while the
// candidate is away from the exam screen: the first about 1 s after they
// leave (once the other tab/window is showing), then every 5 s, at most 6
// per absence. Must match MAX_SCREEN_CAPTURES_PER_EVENT in
// backend/app/core/monitoring_constants.py.
export const SCREEN_CAPTURE_FIRST_DELAY_MS = 1000
export const SCREEN_CAPTURE_INTERVAL_MS = 5000
export const SCREEN_CAPTURE_MAX_PER_ABSENCE = 6
// Readable but light; kept under the backend's 300 KB per-image cap.
export const SCREEN_CAPTURE_MAX_WIDTH_PX = 1280
export const SCREEN_CAPTURE_JPEG_QUALITIES = [0.6, 0.45, 0.3]
export const SCREEN_CAPTURE_MAX_BYTES = 280_000

// SCREEN_SHARE_STOPPED: the candidate stopped sharing their entire screen.
// Must match its row in backend/app/db/seed_monitoring_rules.py.
export const SCREEN_SHARE_STOPPED_RULE = {
  minDurationSec: 0,
  requiredOccurrences: 1,
  confidenceThreshold: 1,
  severity: 'high',
}
