import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAvailableExam, startExam } from '../../api/studentExams'
import { checkApiHealth } from '../../api/system'
import { getErrorMessage } from '../../utils/apiError'
import CameraPreview from '../../components/CameraPreview'
import ExamStepper from '../../components/ExamStepper'
import {
  SCREEN_SHARE_ERRORS,
  getActiveScreenShare,
  requestEntireScreenShare,
  screenShareSupported,
} from '../../monitoring/screenShare'

const CHECK_LABELS = {
  browser: 'Browser supports camera access',
  connectivity: 'Connected to Exam Nigahban server',
  camera: 'Camera permission granted',
  screenSupport: 'Browser supports screen sharing (Chrome or Edge on a computer)',
  screenShare: 'Entire screen shared',
}

const SHARE_ERROR_MESSAGES = {
  [SCREEN_SHARE_ERRORS.notEntireScreen]:
    'Please choose "Entire screen" in the sharing window, not a tab or a window.',
  [SCREEN_SHARE_ERRORS.unsupported]:
    'This browser cannot share the screen. Please use Google Chrome or Microsoft Edge on a computer.',
  [SCREEN_SHARE_ERRORS.denied]: 'Screen sharing was cancelled. Click "Share entire screen" to try again.',
  default: 'Screen sharing could not be started. Please try again.',
}

function CheckRow({ label, state }) {
  const icon = state === 'pass' ? '✓' : state === 'fail' ? '✕' : '…'
  const textClass = state === 'pass' ? 'text-success' : state === 'fail' ? 'text-danger' : 'text-muted'
  return (
    <li className={`d-flex align-items-center gap-2 ${textClass}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </li>
  )
}

export default function ReadinessPage() {
  const { examId } = useParams()
  const navigate = useNavigate()

  const [connectivity, setConnectivity] = useState('checking') // checking | pass | fail
  const [cameraStatus, setCameraStatus] = useState('idle')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  // Only exams that require it (Exam.require_screen_share) add the
  // screen-sharing checks; every other exam's System Check is unchanged.
  const [requireScreenShare, setRequireScreenShare] = useState(false)
  const [screenShared, setScreenShared] = useState(() => Boolean(getActiveScreenShare()))
  const [shareError, setShareError] = useState('')
  const supportsScreenShare = screenShareSupported()

  const browserSupportsCamera = Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => {
    let cancelled = false
    checkApiHealth()
      .then(() => {
        if (!cancelled) setConnectivity('pass')
      })
      .catch(() => {
        if (!cancelled) setConnectivity('fail')
      })
    getAvailableExam(examId)
      .then((exam) => {
        if (!cancelled) setRequireScreenShare(Boolean(exam.require_screen_share))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [examId])

  const cameraCheckState =
    cameraStatus === 'granted' ? 'pass' : cameraStatus === 'idle' || cameraStatus === 'requesting' ? 'pending' : 'fail'

  const screenChecksPassed = !requireScreenShare || (supportsScreenShare && screenShared)
  const allChecksPassed =
    browserSupportsCamera && connectivity === 'pass' && cameraStatus === 'granted' && screenChecksPassed

  const handleShareScreen = async () => {
    setShareError('')
    try {
      await requestEntireScreenShare()
      setScreenShared(true)
    } catch (err) {
      setScreenShared(false)
      setShareError(SHARE_ERROR_MESSAGES[err?.code] ?? SHARE_ERROR_MESSAGES.default)
    }
  }

  const handleBeginExam = async () => {
    setStartError('')
    setStarting(true)
    try {
      await startExam(examId)
      navigate(`/student/exams/${examId}/take`)
    } catch (err) {
      setStartError(getErrorMessage(err, 'Unable to start the exam. Please try again.'))
      setStarting(false)
    }
  }

  return (
    <div className="page-narrow">
      <ExamStepper current={3} />
      <h1 className="h4 mb-3">Pre-Exam System Check</h1>

      <CameraPreview onStatusChange={setCameraStatus} />

      <div className="card exam-card mt-4">
        <div className="card-body">
          <h2 className="h6">Readiness Checklist</h2>
          <ul className="list-unstyled small mb-3">
            <CheckRow
              label={CHECK_LABELS.browser}
              state={browserSupportsCamera ? 'pass' : 'fail'}
            />
            <CheckRow
              label={CHECK_LABELS.connectivity}
              state={connectivity === 'checking' ? 'pending' : connectivity}
            />
            <CheckRow label={CHECK_LABELS.camera} state={cameraCheckState} />
            {requireScreenShare && (
              <>
                <CheckRow
                  label={CHECK_LABELS.screenSupport}
                  state={supportsScreenShare ? 'pass' : 'fail'}
                />
                <CheckRow label={CHECK_LABELS.screenShare} state={screenShared ? 'pass' : 'pending'} />
              </>
            )}
          </ul>

          {requireScreenShare && supportsScreenShare && !screenShared && (
            <div className="border rounded p-3 mb-3 small">
              <p className="mb-2">
                This exam requires your <strong>entire screen</strong> to be shared. Screenshots are
                taken only if you leave the exam screen, and are reviewed by an administrator.
              </p>
              {shareError && (
                <div className="alert alert-danger py-2 small" role="alert">
                  {shareError}
                </div>
              )}
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={handleShareScreen}>
                Share entire screen
              </button>
            </div>
          )}

          {!allChecksPassed && (
            <p className="small text-muted mb-3">
              All checks above must pass before you can begin the exam.
            </p>
          )}

          {startError && (
            <div className="alert alert-danger py-2 small" role="alert">
              {startError}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={!allChecksPassed || starting}
            onClick={handleBeginExam}
          >
            {starting ? 'Starting Exam...' : 'Begin Exam'}
          </button>
        </div>
      </div>
    </div>
  )
}
