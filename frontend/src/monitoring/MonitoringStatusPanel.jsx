// Displays AI-monitoring status using the project's monitoring language
// only: it describes what was observed, never what it means.
// Never implies an autonomous cheating determination — this is a live
// system/observation status indicator, not a verdict.

const STATUS_TEXT = {
  idle: { label: 'Monitoring Inactive', variant: 'secondary' },
  'loading-model': { label: 'Initializing AI Monitoring...', variant: 'secondary' },
  running: { label: 'Monitoring Active', variant: 'success' },
  error: { label: 'AI Monitoring Unavailable', variant: 'warning' },
}

const OBSERVATION_TEXT = {
  'single-face': null,
  'no-face': { label: 'Face Not Visible', variant: 'warning' },
  'multiple-faces': { label: 'Multiple Faces Detected', variant: 'warning' },
}

export default function MonitoringStatusPanel({
  status,
  observationStatus,
  errorMessage,
  cameraStatus,
  phoneDetected = false,
  screenFocusMonitored = false,
}) {
  // Screen-focus monitoring runs with or without the camera, so the
  // student is told about it in both branches below.
  const focusLine = screenFocusMonitored ? (
    <p className="small text-muted mb-0">
      <span className="badge text-bg-light text-dark border me-1">Screen focus: monitored</span>
      Leaving this exam screen (other tabs, windows or screens) is recorded.
    </p>
  ) : null

  if (cameraStatus !== 'granted') {
    return (
      <div className="d-flex flex-column gap-2">
        <div className="alert alert-secondary py-2 small mb-0" role="status">
          Camera access is required for AI-assisted monitoring during this exam.
        </div>
        {focusLine}
      </div>
    )
  }

  const statusInfo = STATUS_TEXT[status] ?? STATUS_TEXT.idle
  const observationInfo = status === 'running' ? OBSERVATION_TEXT[observationStatus] : null

  return (
    <div className="d-flex flex-column gap-2">
      <div className="d-flex flex-wrap align-items-center gap-2" role="status" aria-live="polite" aria-atomic="true">
        <span className={`badge text-bg-${statusInfo.variant}`}>{statusInfo.label}</span>
        {observationInfo && (
          <span className={`badge text-bg-${observationInfo.variant}`}>{observationInfo.label}</span>
        )}
        {phoneDetected && (
          <span className="badge text-bg-warning">Mobile Detected</span>
        )}
      </div>
      {status === 'error' && (
        <p className="small text-muted mb-0">
          {errorMessage || 'AI monitoring could not start. Your exam is not affected.'}
        </p>
      )}
      {focusLine}
      <p className="small text-muted mb-0">
        Suspicious activity is recorded as evidence for administrator review. It is never an
        automatic determination of misconduct.
      </p>
    </div>
  )
}
