import { useState } from 'react'
import { reviewMonitoringEvent } from '../../api/monitoring'
import { getErrorMessage } from '../../utils/apiError'

// One-click Confirm / Ignore for a pending violation, beside its Review
// button. Same endpoint and audit record as the review window, without a
// remark (remarks are optional). Reviewed rows show only Review.
export default function QuickReviewButtons({ event, onReview, onDone }) {
  const [busy, setBusy] = useState(null) // 'CONFIRMED' | 'IGNORED' | null
  const [error, setError] = useState('')
  const pending = event.status === 'PENDING_REVIEW'

  const decide = async (action) => {
    setBusy(action)
    setError('')
    try {
      await reviewMonitoringEvent(event.id, action)
      onDone?.(action, event)
    } catch (err) {
      setError(getErrorMessage(err, 'Not saved. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="quick-review">
      <div className="btn-group btn-group-sm" role="group" aria-label="Review actions">
        <button type="button" className="btn btn-outline-primary" onClick={() => onReview(event)}>
          Review
        </button>
        {pending && (
          <>
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={() => decide('CONFIRMED')}
              disabled={busy !== null}
              title="Confirm this violation"
            >
              {busy === 'CONFIRMED' ? '…' : 'Confirm'}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => decide('IGNORED')}
              disabled={busy !== null}
              title="Ignore this violation"
            >
              {busy === 'IGNORED' ? '…' : 'Ignore'}
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="text-danger small mt-1" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
