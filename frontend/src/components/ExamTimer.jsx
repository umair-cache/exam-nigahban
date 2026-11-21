import { useEffect, useRef, useState } from 'react'
import { ClockIcon } from './admin/icons'

// Thresholds for the timer's visual stages. A calm early warning at five
// minutes, then an urgent one for the final minute -- the common pattern in
// exam software, so a candidate is never surprised by the last 60 seconds.
const WARNING_SECONDS = 5 * 60
const CRITICAL_SECONDS = 60

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function stageFor(seconds) {
  if (seconds <= CRITICAL_SECONDS) return 'critical'
  if (seconds <= WARNING_SECONDS) return 'warning'
  return 'normal'
}

const STAGE_ANNOUNCEMENTS = {
  warning: '5 minutes remaining.',
  critical: '1 minute remaining.',
}

export default function ExamTimer({ remainingSeconds, asOf, onExpire }) {
  const [now, setNow] = useState(Date.now())
  const hasFiredExpire = useRef(false)
  // The stage the candidate joined in. Joining an exam that is already in
  // its last minutes must not trigger an announcement.
  const [initialStage] = useState(() =>
    stageFor(Math.max(0, remainingSeconds - Math.floor((Date.now() - asOf) / 1000))),
  )

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const elapsedSinceSnapshot = Math.floor((now - asOf) / 1000)
  const displaySeconds = Math.max(0, remainingSeconds - elapsedSinceSnapshot)
  const stage = stageFor(displaySeconds)

  useEffect(() => {
    if (displaySeconds === 0 && !hasFiredExpire.current) {
      hasFiredExpire.current = true
      onExpire?.()
    }
    if (displaySeconds > 0) {
      hasFiredExpire.current = false
    }
  }, [displaySeconds, onExpire])

  // Screen readers hear the time once per stage change, not every second:
  // the live region's text only changes when the stage does.
  const announcement = stage !== initialStage ? (STAGE_ANNOUNCEMENTS[stage] ?? '') : ''

  const label = formatDuration(displaySeconds)

  return (
    <div className={`exam-timer exam-timer--${stage}`}>
      <ClockIcon width={18} height={18} className="exam-timer__icon" />
      <span className="exam-timer__label">Time left</span>
      <span role="timer" aria-label={`Time remaining: ${label}`} className="exam-timer__value">
        {label}
      </span>
      <span className="visually-hidden" aria-live="assertive">
        {announcement}
      </span>
    </div>
  )
}
