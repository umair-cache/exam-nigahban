import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getAvailableExam,
  getSession,
  getSessionAnswers,
  getSessionQuestions,
  getIspringLaunch,
  commitScormState,
  finishScormAttempt,
  saveAnswer,
  submitExam,
} from '../../api/studentExams'
import { getErrorMessage, getStatusCode } from '../../utils/apiError'
import {
  postMonitoringEvent,
  sendMonitoringEventOnExit,
  uploadScreenCapture,
} from '../../api/monitoring'
import { connectStudentSessionSocket } from '../../api/studentSessionSocket'
import { TOKEN_KEY } from '../../api/client'
import LoadingState from '../../components/LoadingState'
import ErrorState from '../../components/ErrorState'
import ExamTimer from '../../components/ExamTimer'
import QuestionPalette from '../../components/QuestionPalette'
import ConfirmModal from '../../components/ConfirmModal'
import CameraPreview from '../../components/CameraPreview'
import MonitoringStatusPanel from '../../monitoring/MonitoringStatusPanel'
import { useFaceMonitoring } from '../../monitoring/useFaceMonitoring'
import { useMobilePhoneMonitoring } from '../../monitoring/useMobilePhoneMonitoring'
import useFocusMonitoring from '../../monitoring/useFocusMonitoring'
import { captureFrameAsJpegBase64 } from '../../monitoring/evidenceCapture'
import {
  SCREEN_SHARE_ERRORS,
  buildScreenShareStoppedEvent,
  captureScreenFrame,
  getActiveScreenShare,
  onScreenShareEnded,
  requestEntireScreenShare,
  stopScreenShare,
} from '../../monitoring/screenShare'
import { useAuth } from '../../context/AuthContext'
import { formatDateTimePKT } from '../../utils/dateFormat'

// Fallback only: the live session channel (api/studentSessionSocket.js)
// normally delivers an invigilator's pause or cancellation in well under a
// second. This poll exists for when that socket is down -- shortened from
// 20s so the worst case without it is tolerable rather than alarming.
const RESYNC_INTERVAL_MS = 8000
const OPTIONS = [
  { key: 'A', field: 'option_a' },
  { key: 'B', field: 'option_b' },
  { key: 'C', field: 'option_c' },
  { key: 'D', field: 'option_d' },
]

// Server datetimes (a block's blocked_until) are naive UTC strings without
// a timezone suffix; Date.parse would read them as local time, so a Z is
// appended to anchor them to UTC. Returns null for anything unparseable so
// callers can degrade gracefully.
function parseServerUtcMs(value) {
  if (typeof value !== 'string' || value === '') return null
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const ms = Date.parse(hasZone ? value : `${value}Z`)
  return Number.isNaN(ms) ? null : ms
}

function formatBlockCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// Shown when entire-screen sharing could not be started.
const SHARE_ERROR_MESSAGES = {
  [SCREEN_SHARE_ERRORS.notEntireScreen]:
    'Please choose "Entire screen" in the sharing window, not a tab or a window.',
  [SCREEN_SHARE_ERRORS.unsupported]:
    'This browser cannot share the screen. Please use Google Chrome or Microsoft Edge on a computer.',
  default: 'Screen sharing was not started. Please try again and choose "Entire screen".',
}

export default function TakeExamPage() {
  const { examId } = useParams()
  const navigate = useNavigate()

  const [examTitle, setExamTitle] = useState('')
  const [contentType, setContentType] = useState('native')
  // Exams that require entire-screen sharing (Exam.require_screen_share):
  // screenshots replace the camera photo on "Left Exam Screen" events.
  const [requireScreenShare, setRequireScreenShare] = useState(false)
  const [screenShareActive, setScreenShareActive] = useState(() => Boolean(getActiveScreenShare()))
  const [screenShareStopped, setScreenShareStopped] = useState(false)
  const [screenShareError, setScreenShareError] = useState('')
  // True while the browser's own share picker is open: it takes focus
  // from the page, which must not count as leaving the exam screen.
  const sharePickerOpenRef = useRef(false)
  const { user } = useAuth()
  const [sessionId, setSessionId] = useState(null)
  const [snapshot, setSnapshot] = useState(null) // { remainingSeconds, asOf, status }
  const [questions, setQuestions] = useState([])
  const [answersMap, setAnswersMap] = useState({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [ispringLaunch, setIspringLaunch] = useState(null)
  const ispringFrameRef = useRef(null)
  const [ispringError, setIspringError] = useState('')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [savingQuestionId, setSavingQuestionId] = useState(null)
  const [saveError, setSaveError] = useState('')

  const [locked, setLocked] = useState(false)
  const [lockReason, setLockReason] = useState('')

  // The invigilator's write-block currently in force ({ blocked_until,
  // reason } from the periodic session resync), or null. Distinct from
  // `locked`: a pause is temporary and the session stays alive.
  const [activeBlock, setActiveBlock] = useState(null)
  const [blockRemainingSeconds, setBlockRemainingSeconds] = useState(0)

  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const lockedRef = useRef(false)
  useEffect(() => {
    lockedRef.current = locked
  }, [locked])

  const videoRef = useRef(null)
  const [cameraStatus, setCameraStatus] = useState('idle')

  const handleMonitoringEvent = useCallback(
    (event) => {
      if (!sessionId) return
      // A monitoring-event delivery failure is transient and must never
      // interrupt the exam; the AI monitoring engine keeps running
      // regardless, and this event is simply not persisted for review.
      const { screenCaptures, ...eventFields } = event
      postMonitoringEvent(sessionId, eventFields)
        .then(async (created) => {
          // Screenshots ("Left Exam Screen" on screen-share exams) follow
          // the recorded event one by one, so a failed upload never loses
          // the event itself or the other screenshots.
          if (!created?.id || !screenCaptures?.length) return
          for (const capture of screenCaptures) {
            await uploadScreenCapture(created.id, capture).catch(() => {})
          }
        })
        .catch(() => {})
    },
    [sessionId],
  )

  // A pause (activeBlock) deliberately does NOT stop monitoring: a blocked
  // student may misbehave further, so evidence must keep flowing to the
  // invigilator. Only a terminal lock ends it.
  const monitoringActive = Boolean(sessionId) && !locked && cameraStatus === 'granted'
  const { status: monitoringStatus, observationStatus, errorMessage: monitoringError } =
    useFaceMonitoring(videoRef, monitoringActive, handleMonitoringEvent)
  // Mobile-phone (YOLOX) detection, wired alongside face monitoring --
  // same videoRef, same monitoringActive gate, same event sink, but its
  // own independent rAF loop and temporal rule engine instance (see
  // useMobilePhoneMonitoring.js). MOBILE_PHONE events are accepted and
  // persisted by the backend: the rule is seeded in
  // app/db/seed_monitoring_rules.py and the type is validated like any
  // other. The live observation also drives the camera status badge.
  const { phoneDetected } = useMobilePhoneMonitoring(videoRef, monitoringActive, handleMonitoringEvent)

  // "Left Exam Screen": unlike the camera monitors this does not wait for
  // the camera -- only its evidence snapshot needs it. It runs while the
  // session is in progress (including during an enforcement pause, like
  // the camera monitors) and stops once the session is locked.
  const [focusNotice, setFocusNotice] = useState(null)
  const focusNoticeTimer = useRef(null)
  useEffect(() => () => clearTimeout(focusNoticeTimer.current), [])
  useFocusMonitoring({
    active: Boolean(sessionId) && !locked,
    onEvent: handleMonitoringEvent,
    onExitEvent: (event) => {
      if (sessionId) sendMonitoringEventOnExit(sessionId, event)
    },
    // On a screen-share exam the evidence is screenshots of the shared
    // screen instead of the camera photo.
    captureEvidence: () =>
      !requireScreenShare && cameraStatus === 'granted'
        ? captureFrameAsJpegBase64(videoRef.current)
        : null,
    captureScreen: requireScreenShare
      ? () =>
          captureScreenFrame(
            `${user?.username ?? 'student'} · ${formatDateTimePKT(new Date().toISOString())}`,
          )
      : undefined,
    isSuspended: () => sharePickerOpenRef.current,
    getExamFrames: () => (ispringFrameRef.current ? [ispringFrameRef.current] : []),
    onReturn: (awaySeconds) => {
      setFocusNotice(Math.round(awaySeconds))
      clearTimeout(focusNoticeTimer.current)
      focusNoticeTimer.current = setTimeout(() => setFocusNotice(null), 8000)
    },
  })

  // Stopping the share during the exam is itself recorded (High) and covers
  // the paper until the entire screen is shared again; time keeps running.
  useEffect(() => {
    if (!requireScreenShare || !sessionId) return undefined
    return onScreenShareEnded(() => {
      setScreenShareActive(false)
      if (lockedRef.current) return
      setScreenShareStopped(true)
      handleMonitoringEvent(buildScreenShareStoppedEvent())
    })
  }, [requireScreenShare, sessionId, handleMonitoringEvent])

  // The exam is over (cancelled, expired, submitted): stop sharing at once.
  useEffect(() => {
    if (locked) stopScreenShare()
  }, [locked])

  const handleShareScreen = async () => {
    setScreenShareError('')
    sharePickerOpenRef.current = true
    try {
      await requestEntireScreenShare()
      setScreenShareActive(true)
      setScreenShareStopped(false)
    } catch (err) {
      setScreenShareError(SHARE_ERROR_MESSAGES[err?.code] ?? SHARE_ERROR_MESSAGES.default)
    } finally {
      // Let focus settle back on the page before monitoring resumes.
      setTimeout(() => {
        sharePickerOpenRef.current = false
      }, 1000)
    }
  }

  const lockSession = useCallback(
    (reason) => {
      lockedRef.current = true
      setLocked(true)
      setLockReason(reason)
    },
    [],
  )

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const exam = await getAvailableExam(examId)
      setExamTitle(exam.title)
      setContentType(exam.content_type || 'native')
      setRequireScreenShare(Boolean(exam.require_screen_share))

      if (
        exam.session_status === 'submitted' ||
        exam.session_status === 'expired' ||
        exam.session_status === 'cancelled'
      ) {
        navigate(`/student/exams/${examId}/result`, { replace: true })
        return
      }
      if (exam.session_status !== 'in_progress' || !exam.session_id) {
        navigate(`/student/exams/${examId}/instructions`, { replace: true })
        return
      }

      const session = await getSession(exam.session_id)
      if (session.status !== 'in_progress') {
        navigate(`/student/exams/${examId}/result`, { replace: true })
        return
      }
      setActiveBlock(session.active_block ?? null)

      let questionList = []
      const map = {}
      let launch = null
      if (exam.content_type === 'ispring') {
        launch = await getIspringLaunch(exam.session_id)
      } else {
        const [nativeQuestions, existingAnswers] = await Promise.all([
          getSessionQuestions(exam.session_id),
          getSessionAnswers(exam.session_id),
        ])
        questionList = nativeQuestions
        existingAnswers.forEach((answer) => {
          if (answer.selected_answer) {
            map[answer.question_id] = answer.selected_answer
          }
        })
      }

      setSessionId(exam.session_id)
      setSnapshot({
        remainingSeconds: session.remaining_seconds,
        asOf: Date.now(),
        status: session.status,
      })
      setQuestions(questionList)
      setAnswersMap(map)
      setIspringLaunch(launch)
    } catch (err) {
      if (getStatusCode(err) === 409) {
        navigate(`/student/exams/${examId}/result`, { replace: true })
        return
      }
      setLoadError(getErrorMessage(err, 'Unable to load the exam.'))
    } finally {
      setLoading(false)
    }
  }, [examId, navigate])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  const resync = useCallback(async () => {
    if (!sessionId || lockedRef.current) return
    try {
      const session = await getSession(sessionId)
      setSnapshot({
        remainingSeconds: session.remaining_seconds,
        asOf: Date.now(),
        status: session.status,
      })
      // Computed server-side on every fetch: a newly created, lifted, or
      // expired block is picked up here without any extra endpoint.
      setActiveBlock(session.active_block ?? null)
      if (session.status !== 'in_progress') {
        lockSession(
          session.status === 'expired'
            ? 'Your exam session has expired.'
            : session.status === 'cancelled'
              ? 'This exam has been cancelled by the invigilator.'
              : 'This exam has already been submitted.',
        )
      }
    } catch {
      // A transient resync failure is not fatal; the next interval will retry.
    }
  }, [sessionId, lockSession])

  useEffect(() => {
    if (!ispringLaunch || !sessionId) return undefined

    const receiveScormMessage = (event) => {
      if (
        event.origin !== ispringLaunch.content_origin ||
        event.source !== ispringFrameRef.current?.contentWindow ||
        event.data?.source !== 'exam-nigahban-ispring' ||
        event.data?.nonce !== ispringLaunch.message_nonce
      ) {
        return
      }
      const values = event.data.values
      if (!values || typeof values !== 'object' || Array.isArray(values)) return

      if (event.data.type === 'commit') {
        commitScormState(sessionId, values).catch((err) => {
          if (getStatusCode(err) === 403 || getStatusCode(err) === 409) {
            resync()
          } else {
            setIspringError('Quiz progress could not be saved. Keep this page open and try again.')
          }
        })
      } else if (event.data.type === 'finish') {
        setIspringError('')
        finishScormAttempt(sessionId, values)
          .then(() => navigate(`/student/exams/${examId}/result`, { replace: true }))
          .catch((err) => {
            if (getStatusCode(err) === 403 || getStatusCode(err) === 409) {
              resync()
            }
            setIspringError(
              getErrorMessage(err, 'The quiz finished, but its result could not be recorded.'),
            )
          })
      }
    }

    window.addEventListener('message', receiveScormMessage)
    return () => window.removeEventListener('message', receiveScormMessage)
  }, [examId, ispringLaunch, navigate, resync, sessionId])

  useEffect(() => {
    if (!sessionId) return undefined
    const interval = setInterval(resync, RESYNC_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [sessionId, resync])

  // Live enforcement channel. The server only ever nudges ("your session
  // changed"), so this re-reads the session and applies the result through
  // the same resync() the polling fallback uses -- one code path for
  // enforcement, and a stray frame can never fake a pause.
  useEffect(() => {
    if (!sessionId || locked) return undefined

    const socket = connectStudentSessionSocket({
      sessionId,
      token: localStorage.getItem(TOKEN_KEY),
      onSessionUpdate: () => resync(),
    })

    return () => socket?.close()
  }, [sessionId, locked, resync])

  // Ticks the pause countdown once per second while a block is in force.
  // When it reaches zero the server-side block has expired too (the
  // backend filters on blocked_until), so one final resync clears the
  // overlay and the exam resumes automatically.
  useEffect(() => {
    if (!activeBlock) return undefined
    const endsAtMs = parseServerUtcMs(activeBlock.blocked_until)
    if (endsAtMs === null) return undefined

    // Guards the expiry resync so a skewed client clock (countdown reads
    // 0 while the server still has the block) can trigger at most one
    // resync per block -- the regular 20s resync keeps correcting after
    // that, instead of a fetch loop.
    let expiryResyncDone = false

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000))
      setBlockRemainingSeconds(remaining)
      if (remaining === 0 && !expiryResyncDone) {
        expiryResyncDone = true
        clearInterval(interval)
        resync()
      }
    }

    // The first tick runs on the next macrotask so the countdown shows
    // immediately without a synchronous setState in the effect body.
    const initialTick = setTimeout(tick, 0)
    const interval = setInterval(tick, 1000)
    return () => {
      clearTimeout(initialTick)
      clearInterval(interval)
    }
  }, [activeBlock, resync])

  const handleTimerExpire = useCallback(() => {
    resync()
  }, [resync])

  const handleSelectAnswer = async (questionId, letter) => {
    if (locked || activeBlock) return
    const previous = answersMap[questionId]
    setAnswersMap((prev) => ({ ...prev, [questionId]: letter }))
    setSavingQuestionId(questionId)
    setSaveError('')
    try {
      await saveAnswer(sessionId, questionId, letter)
    } catch (err) {
      setAnswersMap((prev) => ({ ...prev, [questionId]: previous }))
      if (getStatusCode(err) === 403) {
        // The invigilator paused the exam between resyncs: the server
        // rejected the write, so resync (which renders the pause overlay
        // from server state) and drop the optimistic selection.
        resync()
      } else if (getStatusCode(err) === 409) {
        lockSession('Your exam session is no longer active. Your remaining answers were not saved.')
      } else {
        setSaveError(getErrorMessage(err, 'Failed to save your answer. Please try again.'))
      }
    } finally {
      setSavingQuestionId(null)
    }
  }

  const handleSubmit = async () => {
    setSubmitError('')
    setSubmitting(true)
    try {
      await submitExam(sessionId)
      stopScreenShare()
      navigate(`/student/exams/${examId}/result`, { replace: true })
    } catch (err) {
      if (getStatusCode(err) === 409) {
        navigate(`/student/exams/${examId}/result`, { replace: true })
        return
      }
      if (getStatusCode(err) === 403) {
        // The invigilator paused the exam: close the modal and resync --
        // the pause overlay explains why, and submitting becomes possible
        // again once the block lifts.
        setShowSubmitModal(false)
        setSubmitting(false)
        resync()
        return
      }
      setSubmitError(getErrorMessage(err, 'Unable to submit the exam. Please try again.'))
      setSubmitting(false)
    }
  }

  if (loading) return <LoadingState message="Loading your exam..." />
  if (loadError) return <ErrorState message={loadError} onRetry={bootstrap} />
  if (contentType === 'native' && questions.length === 0) {
    return <ErrorState title="No Questions" message="This exam has no questions configured." />
  }

  if (contentType === 'ispring' && !ispringLaunch) {
    return <ErrorState title="Quiz Unavailable" message="The iSpring quiz could not be launched." />
  }

  const currentQuestion = contentType === 'native' ? questions[currentIndex] : null
  const answeredIds = new Set(Object.keys(answersMap).filter((k) => answersMap[k]).map(Number))
  const answeredCount = answeredIds.size
  const unansweredCount = questions.length - answeredCount
  const blockActive = activeBlock !== null

  return (
    <div className="no-select">
      <div className="exam-topbar d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h1 className="h5 mb-0">{examTitle}</h1>
        {snapshot && (
          <ExamTimer
            remainingSeconds={snapshot.remainingSeconds}
            asOf={snapshot.asOf}
            onExpire={handleTimerExpire}
          />
        )}
      </div>

      {/* Shown after the student returns from another tab, window or
          screen. Informational only -- the exam is never blocked; an
          administrator reviews the recorded absence. */}
      <div aria-live="polite" aria-atomic="true">
        {focusNotice !== null && !locked && (
          <div className="alert alert-warning d-flex align-items-start justify-content-between gap-2 py-2 small" role="status">
            <span>
              You left the exam screen for {focusNotice} second{focusNotice === 1 ? '' : 's'}.
              This has been recorded for review.
            </span>
            <button
              type="button"
              className="btn-close"
              aria-label="Dismiss notice"
              onClick={() => setFocusNotice(null)}
            />
          </div>
        )}
      </div>

      {/* A cancelled, expired or submitted session ends the exam, so this
          is a blocking overlay rather than an inline notice -- the paper
          must not stay visible and clickable underneath. The candidate
          reads why before the screen changes, which matters if they later
          contest the decision. */}
      {locked && (
        <div className="modal-backdrop-manual" role="alertdialog" aria-modal="true">
          <div className="modal-dialog" style={{ margin: 0, maxWidth: 'min(460px, 92vw)' }}>
            <div className="modal-content">
              <div className="modal-header">
                <h2 className="modal-title h5 mb-0">Examination Ended</h2>
              </div>
              <div className="modal-body">
                <p className="mb-0">{lockReason}</p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate(`/student/exams/${examId}/result`, { replace: true })}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screen-share exams: the paper stays covered until the entire
          screen is shared. Not a lock -- time keeps running, and sharing
          again continues the exam. */}
      {requireScreenShare && !locked && !screenShareActive && (
        <div className="modal-backdrop-manual" role="alertdialog" aria-modal="true" aria-labelledby="share-title">
          <div className="modal-dialog" style={{ margin: 0, maxWidth: 'min(480px, 92vw)' }}>
            <div className="modal-content">
              <div className="modal-header">
                <h2 id="share-title" className="modal-title h5 mb-0">
                  {screenShareStopped ? 'Screen sharing stopped' : 'Share your entire screen'}
                </h2>
              </div>
              <div className="modal-body">
                <p className="mb-2">
                  {screenShareStopped
                    ? 'This exam requires your entire screen to be shared. Stopping it has been recorded for review.'
                    : 'This exam requires your entire screen to be shared before you can continue.'}
                </p>
                <p className="small text-muted mb-0">
                  Screenshots are taken only if you leave the exam screen. Your exam time is still
                  running.
                </p>
                {screenShareError && (
                  <div className="alert alert-danger py-2 small mt-3 mb-0" role="alert">
                    {screenShareError}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-primary" onClick={handleShareScreen}>
                  Share entire screen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeBlock && (
        <div className="alert alert-warning border-warning-subtle" role="alert">
          <p className="mb-1 fw-bold">Your exam has been paused by the invigilator.</p>
          <p className="mb-1 small">Reason: {activeBlock.reason}</p>
          <p className="mb-0 small">
            {blockRemainingSeconds > 0
              ? `Answering and submitting resume automatically in ${formatBlockCountdown(
                  blockRemainingSeconds,
                )}. Your exam time is still running.`
              : 'The pause is ending. Answering will resume automatically in a moment. Your exam time is still running.'}
          </p>
        </div>
      )}

      <div className="row g-4">
        <div className="col-12 col-lg-8">
          {contentType === 'ispring' ? (
            <div className="card exam-card overflow-hidden position-relative">
              {ispringError && (
                <div className="alert alert-danger rounded-0 mb-0 py-2 small" role="alert">
                  {ispringError}
                </div>
              )}
              <iframe
                ref={ispringFrameRef}
                title={`${examTitle} quiz`}
                src={ispringLaunch.launch_url}
                className="w-100 border-0"
                style={{ minHeight: '72vh', pointerEvents: blockActive || locked ? 'none' : 'auto' }}
                sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"
                allow="fullscreen"
              />
              {blockActive && (
                <div
                  className="position-absolute top-0 start-0 w-100 h-100"
                  aria-hidden="true"
                  style={{ background: 'rgba(255,255,255,.25)', zIndex: 2 }}
                />
              )}
            </div>
          ) : (
            <div className="card exam-card">
              <div className="card-body">
                <p className="text-muted small mb-1">
                  Question {currentIndex + 1} of {questions.length}
                </p>
                <h2 className="h6 mb-3">{currentQuestion.question_text}</h2>

                <div className="d-flex flex-column gap-2 mb-3">
                  {OPTIONS.map(({ key, field }) => (
                    <label
                      key={key}
                      className={`form-check border rounded p-2 ${
                        answersMap[currentQuestion.id] === key ? 'border-primary bg-light' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        className="form-check-input me-2"
                        name={`question-${currentQuestion.id}`}
                        value={key}
                        checked={answersMap[currentQuestion.id] === key}
                        disabled={locked || blockActive || savingQuestionId === currentQuestion.id}
                        onChange={() => handleSelectAnswer(currentQuestion.id, key)}
                      />
                      <span className="form-check-label">
                        <strong>{key}.</strong> {currentQuestion[field]}
                      </span>
                    </label>
                  ))}
                </div>

                {savingQuestionId === currentQuestion.id && (
                  <p className="small text-muted mb-2">Saving answer...</p>
                )}
                {saveError && (
                  <div className="alert alert-danger py-2 small" role="alert">
                    {saveError}
                  </div>
                )}

                <div className="d-flex justify-content-between mt-3">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    disabled={currentIndex === 0 || blockActive}
                    onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  >
                    Previous
                  </button>
                  {currentIndex < questions.length - 1 ? (
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      disabled={blockActive}
                      onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-success"
                      disabled={locked || blockActive}
                      onClick={() => setShowSubmitModal(true)}
                    >
                      Submit Exam
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="col-12 col-lg-4">
          <div className="card exam-card mb-4">
            <div className="card-body">
              <h2 className="h6">Exam Monitoring</h2>
              <CameraPreview ref={videoRef} onStatusChange={setCameraStatus} autoStart />
              <div className="mt-3">
                <MonitoringStatusPanel
                  status={monitoringStatus}
                  observationStatus={observationStatus}
                  errorMessage={monitoringError}
                  cameraStatus={cameraStatus}
                  phoneDetected={phoneDetected}
                  screenFocusMonitored={Boolean(sessionId) && !locked}
                />
              </div>
            </div>
          </div>

          {contentType === 'native' && <div className="card exam-card">
            <div className="card-body">
              <h2 className="h6">Question Navigator</h2>
              <p className="small text-muted">
                {answeredCount} of {questions.length} answered
              </p>
              <QuestionPalette
                questions={questions}
                currentIndex={currentIndex}
                answeredIds={answeredIds}
                onSelect={(index) => {
                  if (!locked && !blockActive) {
                    setCurrentIndex(index)
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-success w-100 mt-3"
                disabled={locked || blockActive}
                onClick={() => setShowSubmitModal(true)}
              >
                Submit Exam
              </button>
            </div>
          </div>}
        </div>
      </div>

      {showSubmitModal && (
        <ConfirmModal
          title="Submit Exam?"
          confirmLabel={submitting ? 'Submitting...' : 'Submit Exam'}
          confirmDisabled={submitting}
          onConfirm={handleSubmit}
          onCancel={() => !submitting && setShowSubmitModal(false)}
        >
          <p>
            You have answered <strong>{answeredCount}</strong> of{' '}
            <strong>{questions.length}</strong> questions.
          </p>
          {unansweredCount > 0 && (
            <div className="alert alert-warning py-2 small" role="alert">
              <strong>
                {unansweredCount} {unansweredCount === 1 ? 'question is' : 'questions are'} unanswered.
              </strong>{' '}
              Unanswered questions receive no marks.
            </div>
          )}
          <p className="mb-0 text-danger">
            Once submitted, you will not be able to change your answers. This action cannot be
            undone.
          </p>
          {submitError && (
            <div className="alert alert-danger py-2 small mt-2" role="alert">
              {submitError}
            </div>
          )}
        </ConfirmModal>
      )}
    </div>
  )
}
