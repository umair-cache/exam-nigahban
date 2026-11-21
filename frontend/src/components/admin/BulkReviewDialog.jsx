import { useMemo, useState } from 'react'
import { bulkReviewMonitoringEvents } from '../../api/monitoring'
import { getErrorMessage } from '../../utils/apiError'
import { countDecisionChanges, plural, summarizeSelection } from '../../utils/bulkSelection'

const COPY = {
  CONFIRMED: { verb: 'Confirm', variant: 'danger' },
  IGNORED: { verb: 'Ignore', variant: 'secondary' },
}
// Students listed by name before the rest are summarised as "+N more".
const LISTED_STUDENTS = 4

// A quick confirmation for one decision on many violations: who is
// affected, an optional remark, and the action button (Enter submits).
// Each violation still gets its own audit record on the server.
export default function BulkReviewDialog({ action, entries, onClose, onDone }) {
  const summary = useMemo(() => summarizeSelection(entries), [entries])
  const reversals = useMemo(() => countDecisionChanges(entries, action), [entries, action])
  const { verb, variant } = COPY[action]
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const result = await bulkReviewMonitoringEvents(
        entries.map((entry) => entry.id),
        action,
        remark.trim() || undefined,
      )
      onDone(result, action)
    } catch (err) {
      setError(getErrorMessage(err, 'Not saved. Nothing was changed; please try again.'))
      setSubmitting(false)
    }
  }

  const listed = summary.groups.slice(0, LISTED_STUDENTS)
  const more = summary.groups.length - listed.length

  return (
    <div
      className="modal-backdrop-manual"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-review-title"
      onKeyDown={(e) => e.key === 'Escape' && !submitting && onClose()}
    >
      <form className="modal-dialog" style={{ margin: 0 }} onSubmit={handleSubmit}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="bulk-review-title">
              {verb} {plural(summary.count, 'violation')}?
            </h5>
          </div>
          <div className="modal-body">
            <ul className="bulk-review__groups list-unstyled mb-3">
              {listed.map((group) => (
                <li key={group.key}>
                  <span className="fw-semibold">{group.studentName}</span>{' '}
                  <span className="text-muted small">({group.studentId})</span>
                  <div className="small text-muted">{group.types.join(' · ')}</div>
                </li>
              ))}
              {more > 0 && <li className="small text-muted">+ {plural(more, 'more student session')}</li>}
            </ul>

            {reversals > 0 && (
              <div className="alert alert-warning py-2 small" role="alert">
                {plural(reversals, 'violation')} already {reversals === 1 ? 'has' : 'have'} the
                opposite decision and will be changed.
              </div>
            )}

            <input
              type="text"
              className="form-control form-control-sm"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              maxLength={1000}
              placeholder="Remarks (optional)"
              aria-label="Remarks (optional)"
              disabled={submitting}
            />

            {error && (
              <div className="alert alert-danger py-2 small mt-3 mb-0" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            {/* Focused on open, so Enter applies the decision at once. */}
            <button type="submit" className={`btn btn-${variant}`} disabled={submitting} autoFocus>
              {submitting ? 'Saving…' : `${verb} ${plural(summary.count, 'violation')}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
