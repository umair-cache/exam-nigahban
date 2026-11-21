import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { BULK_REVIEW_MAX_EVENTS, listMonitoringEvents } from '../../api/monitoring'
import { getErrorMessage } from '../../utils/apiError'
import { useAuth } from '../../context/AuthContext'
import {
  EVENT_STATUS_LABELS,
  eventStatusBadgeClass,
  eventStatusLabel,
  eventTypeLabel,
} from '../../utils/monitoringStatus'
import { formatDateTimePKT } from '../../utils/dateFormat'
import { MONITORING_EVENT_TYPES } from '../../monitoring/constants'
import LoadingState from '../../components/LoadingState'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'
import EvidenceReviewPanel from '../../components/EvidenceReviewPanel'
import MonitoringSessionsView from '../../components/admin/MonitoringSessionsView'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import BulkActionBar from '../../components/admin/BulkActionBar'
import BulkReviewDialog from '../../components/admin/BulkReviewDialog'
import QuickReviewButtons from '../../components/admin/QuickReviewButtons'
import {
  addToSelection,
  describeBulkResult,
  removeFromSelection,
  removeSessionFromSelection,
} from '../../utils/bulkSelection'

// How long the "3 violations ignored." notice stays on screen.
const NOTICE_MS = 5000

const PAGE_SIZE = 10
const EMPTY_FILTERS = { status: '', eventType: '', sessionId: '' }

// "sessions" combines each student's violations for one exam session into
// a single record (the default -- it is how an invigilator actually thinks
// about a candidate); "events" is the flat per-violation list, kept because
// it is the only way to filter across sessions, e.g. every mobile-phone
// detection today regardless of who triggered it.
const VIEW_SESSIONS = 'sessions'
const VIEW_EVENTS = 'events'
// MOBILE_PHONE is deliberately not part of MONITORING_EVENT_TYPES /
// MONITORING_RULES in monitoring/constants.js -- it's detected by a
// separate YOLOX rule engine (see MOBILE_PHONE_RULE and the comment above
// it in that file), not the face-monitoring engine those are derived from.
// Added here only, as a filter option -- the backend identifier string and
// detection logic are untouched.
// LEFT_EXAM_SCREEN likewise comes from its own detector (browser focus,
// see monitoring/focusMonitor.js), not the face engine.
const EVENT_TYPE_FILTER_OPTIONS = [
  ...MONITORING_EVENT_TYPES,
  'MOBILE_PHONE',
  'LEFT_EXAM_SCREEN',
  'SCREEN_SHARE_STOPPED',
]

// Optional deep link, e.g. /admin/monitoring?view=events&status=PENDING_REVIEW
// from the alert bell. Unknown values are ignored. Keyed on the query string
// so following such a link while already on this page applies it.
export default function MonitoringEventsPage() {
  const [searchParams] = useSearchParams()
  const status = searchParams.get('status')
  const initialFilters = {
    ...EMPTY_FILTERS,
    status: status && status in EVENT_STATUS_LABELS ? status : '',
  }
  const initialView = searchParams.get('view') === VIEW_EVENTS ? VIEW_EVENTS : VIEW_SESSIONS
  return (
    <MonitoringEventsContent
      key={searchParams.toString()}
      initialFilters={initialFilters}
      initialView={initialView}
    />
  )
}

function MonitoringEventsContent({ initialFilters, initialView }) {
  const [draftFilters, setDraftFilters] = useState(initialFilters)
  const [appliedFilters, setAppliedFilters] = useState(initialFilters)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [view, setView] = useState(initialView)
  // Bumped to make the grouped view re-read its sessions in place.
  const [refreshTick, setRefreshTick] = useState(0)
  const { user } = useAuth()
  const { latestAlert, wsConnected } = useOutletContext() ?? {}

  // Bulk review. Keyed by event id, so a selection survives live refreshes,
  // paging and switching views; capped at what one bulk request accepts.
  const [selection, setSelection] = useState({})
  const [bulkDialog, setBulkDialog] = useState(null) // { action, entries }
  const [selectingAll, setSelectingAll] = useState(false)
  const [selectAllError, setSelectAllError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
  const selectedEntries = useMemo(() => Object.values(selection), [selection])
  const selectedStudentCount = useMemo(
    () => new Set(selectedEntries.map((entry) => entry.studentId)).size,
    [selectedEntries],
  )
  const selectedSessionIds = useMemo(
    () => new Set(selectedEntries.map((entry) => entry.sessionId)),
    [selectedEntries],
  )

  // `silent` keeps the current rows on screen while refetching (live
  // updates, and refreshes behind the open review panel); a normal load
  // shows the spinner and reports errors.
  const load = useCallback(async ({ silent = false } = {}) => {
    // Only the flat view fetches here; the grouped view owns its own
    // fetching (and its own pagination, which counts sessions not events).
    if (view !== VIEW_EVENTS) {
      setLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const result = await listMonitoringEvents({
        status: appliedFilters.status,
        eventType: appliedFilters.eventType,
        sessionId: appliedFilters.sessionId ? Number(appliedFilters.sessionId) : undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setData(result)
      if (silent) setError('')
    } catch (err) {
      // A failed background refresh keeps the rows already shown; the next
      // alert or a manual refresh tries again.
      if (!silent) setError(getErrorMessage(err, 'Unable to load monitoring events right now.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [appliedFilters, page, view])

  useEffect(() => {
    load()
  }, [load])

  // New violations (and reviews by other admins) arrive on the admin alerts
  // socket; refresh whichever view is open, without a spinner.
  const refreshInPlace = useCallback(() => {
    if (view === VIEW_EVENTS) load({ silent: true })
    else setRefreshTick((tick) => tick + 1)
  }, [view, load])
  useLiveRefresh(latestAlert, refreshInPlace)

  const handleApplyFilters = (event) => {
    event.preventDefault()
    setPage(1)
    setAppliedFilters(draftFilters)
  }

  const handleClearFilters = () => {
    setDraftFilters(EMPTY_FILTERS)
    setAppliedFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const handlePrevious = () => setPage((current) => Math.max(1, current - 1))
  const handleNext = () =>
    setPage((current) => (data && current < data.total_pages ? current + 1 : current))

  const handleReviewed = () => {
    setSelectedEvent(null)
    load()
  }

  const toggleEvent = (item) =>
    setSelection((current) =>
      current[item.id]
        ? removeFromSelection(current, [item.id])
        : addToSelection(current, [item], BULK_REVIEW_MAX_EVENTS),
    )

  const pageItems = data?.items ?? []
  const pageAllSelected = pageItems.length > 0 && pageItems.every((item) => selection[item.id])
  const togglePage = () =>
    setSelection((current) =>
      pageAllSelected
        ? removeFromSelection(
            current,
            pageItems.map((item) => item.id),
          )
        : addToSelection(current, pageItems, BULK_REVIEW_MAX_EVENTS),
    )

  // Every violation matching the current filters, up to one batch.
  const selectAllMatching = async () => {
    setSelectingAll(true)
    setSelectAllError('')
    try {
      const result = await listMonitoringEvents({
        status: appliedFilters.status,
        eventType: appliedFilters.eventType,
        sessionId: appliedFilters.sessionId ? Number(appliedFilters.sessionId) : undefined,
        page: 1,
        pageSize: BULK_REVIEW_MAX_EVENTS,
      })
      setSelection((current) => addToSelection(current, result.items, BULK_REVIEW_MAX_EVENTS))
    } catch (err) {
      setSelectAllError(getErrorMessage(err, 'Unable to select every matching violation.'))
    } finally {
      setSelectingAll(false)
    }
  }

  // From a student card: tick or untick all of that session's pending
  // violations (fetched by the card), or review them straight away.
  const handleSelectSession = (sessionId, events, checked) =>
    setSelection((current) =>
      checked
        ? addToSelection(current, events, BULK_REVIEW_MAX_EVENTS)
        : removeSessionFromSelection(current, sessionId),
    )
  const handleReviewSession = (action, events) =>
    setBulkDialog({ action, entries: Object.values(addToSelection({}, events)) })

  const openBulkFromSelection = (action) => setBulkDialog({ action, entries: selectedEntries })

  const handleBulkDone = (result, action) => {
    setBulkDialog(null)
    setSelection((current) =>
      removeFromSelection(
        current,
        [...result.reviewed, ...result.skipped].map((item) => item.event_id),
      ),
    )
    setNotice(describeBulkResult(result, action))
    refreshInPlace()
  }

  // One-click Confirm / Ignore on a single row.
  const handleQuickDone = (action, event) => {
    setSelection((current) => removeFromSelection(current, [event.id]))
    setNotice(
      `${eventTypeLabel(event.event_type)} by ${event.student_full_name} ${
        action === 'CONFIRMED' ? 'confirmed' : 'ignored'
      }.`,
    )
    refreshInPlace()
  }

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
        <div className="d-flex align-items-center gap-2">
          <h1 className="h4 mb-0">Monitoring Events</h1>
          {wsConnected && (
            <span
              className="dashboard-live-indicator"
              title="New violations appear here automatically"
            >
              <span className="dashboard-live-indicator__dot" />
              Live
            </span>
          )}
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={refreshInPlace}>
            Refresh
          </button>
          <div className="btn-group btn-group-sm" role="group" aria-label="Result grouping">
            <button
              type="button"
              className={`btn btn-outline-primary${view === VIEW_SESSIONS ? ' active' : ''}`}
              aria-pressed={view === VIEW_SESSIONS}
              onClick={() => setView(VIEW_SESSIONS)}
            >
              By Student Session
            </button>
            <button
              type="button"
              className={`btn btn-outline-primary${view === VIEW_EVENTS ? ' active' : ''}`}
              aria-pressed={view === VIEW_EVENTS}
              onClick={() => setView(VIEW_EVENTS)}
            >
              All Events
            </button>
          </div>
        </div>
      </div>

      <form className="row g-2 align-items-end mb-4" onSubmit={handleApplyFilters}>
        <div className="col-6 col-md-3">
          <label htmlFor="filter-status" className="form-label small">
            Status
          </label>
          <select
            id="filter-status"
            className="form-select form-select-sm"
            value={draftFilters.status}
            onChange={(e) => setDraftFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">All</option>
            {Object.keys(EVENT_STATUS_LABELS).map((status) => (
              <option key={status} value={status}>
                {eventStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="col-6 col-md-3">
          <label htmlFor="filter-event-type" className="form-label small">
            Event Type
          </label>
          <select
            id="filter-event-type"
            className="form-select form-select-sm"
            value={draftFilters.eventType}
            onChange={(e) => setDraftFilters((f) => ({ ...f, eventType: e.target.value }))}
          >
            <option value="">All</option>
            {EVENT_TYPE_FILTER_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {eventTypeLabel(type)}
              </option>
            ))}
          </select>
        </div>

        <div className="col-6 col-md-3">
          <label htmlFor="filter-session-id" className="form-label small">
            Session ID
          </label>
          <input
            id="filter-session-id"
            type="number"
            min="1"
            className="form-control form-control-sm"
            value={draftFilters.sessionId}
            onChange={(e) => setDraftFilters((f) => ({ ...f, sessionId: e.target.value }))}
          />
        </div>

        <div className="col-12 col-md-3 d-flex gap-2">
          <button type="submit" className="btn btn-primary btn-sm">
            Apply
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleClearFilters}>
            Clear
          </button>
        </div>
      </form>

      {notice && (
        <div className="alert alert-success py-2 small d-flex justify-content-between align-items-center" role="status">
          <span>{notice}</span>
          <button type="button" className="btn-close btn-sm" aria-label="Dismiss" onClick={() => setNotice('')} />
        </div>
      )}

      {view === VIEW_SESSIONS && (
        <MonitoringSessionsView
          filters={appliedFilters}
          pageSize={PAGE_SIZE}
          refreshTick={refreshTick}
          selectedSessionIds={selectedSessionIds}
          onSelectSession={handleSelectSession}
          onReviewSession={handleReviewSession}
          onQuickDone={handleQuickDone}
        />
      )}

      {view === VIEW_EVENTS && loading && (
        <LoadingState message="Loading monitoring events..." />
      )}
      {view === VIEW_EVENTS && !loading && error && (
        <ErrorState message={error} onRetry={() => load()} />
      )}
      {view === VIEW_EVENTS && !loading && !error && data && data.items.length === 0 && (
        <EmptyState
          title="No monitoring events"
          message="No monitoring events match the current filters."
        />
      )}

      {view === VIEW_EVENTS && !loading && !error && data && data.items.length > 0 && (
        <>
          {pageAllSelected && data.total > pageItems.length && (
            <div className="alert alert-info py-2 small d-flex flex-wrap align-items-center gap-2">
              All {pageItems.length} on this page are selected.
              <button
                type="button"
                className="btn btn-link btn-sm p-0 align-baseline"
                onClick={selectAllMatching}
                disabled={selectingAll || selectedEntries.length >= BULK_REVIEW_MAX_EVENTS}
              >
                {selectingAll
                  ? 'Selecting…'
                  : `Select all ${Math.min(data.total, BULK_REVIEW_MAX_EVENTS)} matching these filters`}
              </button>
              {data.total > BULK_REVIEW_MAX_EVENTS && (
                <span className="text-muted">(up to {BULK_REVIEW_MAX_EVENTS} at a time)</span>
              )}
            </div>
          )}
          {selectAllError && (
            <div className="alert alert-warning py-2 small" role="alert">
              {selectAllError}
            </div>
          )}
          <div className="table-responsive">
            <table className="table table-sm table-hover align-middle">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '2rem' }}>
                    <input
                      type="checkbox"
                      className="form-check-input bulk-select"
                      checked={pageAllSelected}
                      onChange={togglePage}
                      aria-label="Select every violation on this page"
                    />
                  </th>
                  <th>Student</th>
                  <th>Exam</th>
                  <th>Event Type</th>
                  <th>Confidence</th>
                  <th>Duration</th>
                  <th>Occurrences</th>
                  <th>Status</th>
                  <th>Detected At</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.id}
                    className={selection[item.id] ? 'monitoring-row--selected' : undefined}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="form-check-input bulk-select"
                        checked={Boolean(selection[item.id])}
                        onChange={() => toggleEvent(item)}
                        disabled={
                          !selection[item.id] && selectedEntries.length >= BULK_REVIEW_MAX_EVENTS
                        }
                        aria-label={`Select ${eventTypeLabel(item.event_type)} by ${item.student_full_name}`}
                      />
                    </td>
                    <td>
                      {item.student_full_name}
                      <div className="text-muted small">{item.student_id}</div>
                    </td>
                    <td>{item.exam_title}</td>
                    <td>{eventTypeLabel(item.event_type)}</td>
                    <td>{(item.confidence * 100).toFixed(1)}%</td>
                    <td>{Number(item.duration_seconds).toFixed(2)}s</td>
                    <td>{item.occurrences}</td>
                    <td>
                      <span className={`badge ${eventStatusBadgeClass(item.status)}`}>
                        {eventStatusLabel(item.status)}
                      </span>
                    </td>
                    <td className="text-nowrap">{formatDateTimePKT(item.detected_at)}</td>
                    <td>
                      <QuickReviewButtons
                        event={item}
                        onReview={setSelectedEvent}
                        onDone={handleQuickDone}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="d-flex justify-content-between align-items-center mt-3">
            <p className="text-muted small mb-0">
              Page {data.page} of {data.total_pages} (Total: {data.total})
            </p>
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handlePrevious}
                disabled={page <= 1}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleNext}
                disabled={page >= data.total_pages}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {selectedEvent && (
        <EvidenceReviewPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onReviewed={handleReviewed}
          // Refetches the table while leaving the panel open, so a
          // confirmed event can be acted on without reopening it.
          onRefresh={() => load({ silent: true })}
          canVoid={Boolean(user?.is_system_admin)}
        />
      )}

      <BulkActionBar
        count={selectedEntries.length}
        studentCount={selectedStudentCount}
        max={BULK_REVIEW_MAX_EVENTS}
        onConfirm={() => openBulkFromSelection('CONFIRMED')}
        onIgnore={() => openBulkFromSelection('IGNORED')}
        onClear={() => setSelection({})}
      />

      {bulkDialog && (
        <BulkReviewDialog
          action={bulkDialog.action}
          entries={bulkDialog.entries}
          onClose={() => setBulkDialog(null)}
          onDone={handleBulkDone}
        />
      )}
    </div>
  )
}
