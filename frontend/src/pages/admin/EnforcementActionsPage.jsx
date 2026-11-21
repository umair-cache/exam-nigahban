import { useCallback, useEffect, useState } from 'react'
import { liftEnforcementAction, listEnforcementActions } from '../../api/enforcement'
import { getErrorMessage } from '../../utils/apiError'
import {
  ACTION_TYPE_LABELS,
  ENFORCEMENT_STATUS_LABELS,
  actionTypeBadgeClass,
  actionTypeLabel,
  enforcementStatusBadgeClass,
  enforcementStatusLabel,
} from '../../utils/enforcementStatus'
import { formatDateTimePKT } from '../../utils/dateFormat'
import LoadingState from '../../components/LoadingState'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'
import ConfirmModal from '../../components/ConfirmModal'
import PageHeader from '../../components/admin/PageHeader'
import FilterTabs from '../../components/admin/FilterTabs'
import TablePagination from '../../components/admin/TablePagination'
import PersonCell from '../../components/admin/PersonCell'

const PAGE_SIZE = 10
const EMPTY_FILTERS = { actionType: '', status: '' }
// Wording for a block's end time under its status badge. A lifted block
// ended early, so its end time is only what had been scheduled.
const BLOCK_END_PREFIX = {
  ACTIVE: 'Until ',
  EXPIRED: 'Ended ',
  LIFTED: 'Was scheduled until ',
}

// Read-only audit view of every enforcement action taken by admins (the
// actions themselves are taken from the evidence review panel). The one
// mutation available here is lifting a still-active block early; CANCEL_EXAM
// and UFM_CASE rows are terminal by design and can only be read.
export default function EnforcementActionsPage() {
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The active-block row pending lift confirmation, or null.
  const [pendingLift, setPendingLift] = useState(null)
  const [lifting, setLifting] = useState(false)
  const [liftError, setLiftError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listEnforcementActions({
        actionType: appliedFilters.actionType,
        status: appliedFilters.status,
        page,
        pageSize: PAGE_SIZE,
      })
      setData(result)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load enforcement actions right now.'))
    } finally {
      setLoading(false)
    }
  }, [appliedFilters, page])

  useEffect(() => {
    load()
  }, [load])

  // Tabs and the type select apply immediately, like the Users and Exams
  // filters, so there is no separate Apply step.
  const applyFilters = (next) => {
    setPage(1)
    setAppliedFilters(next)
  }

  const handleClearFilters = () => applyFilters(EMPTY_FILTERS)

  const handlePrevious = () => setPage((current) => Math.max(1, current - 1))
  const handleNext = () =>
    setPage((current) => (data && current < data.total_pages ? current + 1 : current))

  const handleLift = async () => {
    setLifting(true)
    setLiftError('')
    try {
      await liftEnforcementAction(pendingLift.id)
      setPendingLift(null)
      load()
    } catch (err) {
      setLiftError(getErrorMessage(err, 'Unable to lift this block. Please try again.'))
    } finally {
      setLifting(false)
    }
  }

  const hasFilters = Boolean(appliedFilters.actionType || appliedFilters.status)

  return (
    <div>
      <PageHeader
        title="Enforcement Actions"
        subtitle="Blocks, exam cancellations and UFM cases issued from evidence review."
      />

      <div className="filter-bar">
        <FilterTabs
          label="Filter enforcement actions by status"
          value={appliedFilters.status}
          onChange={(value) => applyFilters({ ...appliedFilters, status: value })}
          options={[
            { value: '', label: 'All' },
            ...Object.keys(ENFORCEMENT_STATUS_LABELS).map((status) => ({
              value: status,
              label: enforcementStatusLabel(status),
            })),
          ]}
        />
        <div className="filter-bar__controls">
          <select
            id="filter-action-type"
            className="form-select form-select-sm"
            aria-label="Filter by action type"
            value={appliedFilters.actionType}
            onChange={(e) => applyFilters({ ...appliedFilters, actionType: e.target.value })}
          >
            <option value="">All action types</option>
            {Object.keys(ACTION_TYPE_LABELS).map((type) => (
              <option key={type} value={type}>
                {actionTypeLabel(type)}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              type="button"
              className="btn btn-link btn-sm text-decoration-none"
              onClick={handleClearFilters}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading && <LoadingState message="Loading enforcement actions..." />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && data && data.items.length === 0 && (
        <div className="data-card">
          <EmptyState
            title="No enforcement actions"
            message={
              hasFilters
                ? 'No enforcement actions match the current filters.'
                : 'Actions taken from the evidence review panel will appear here.'
            }
            action={
              hasFilters ? (
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={handleClearFilters}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <div className="data-card">
          <div className="table-responsive">
            <table className="data-table data-table--stack">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Exam</th>
                  <th scope="col">Action</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reason</th>
                  <th scope="col" className="data-table__optional">Issued</th>
                  <th scope="col" className="data-table__actions">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const isActiveBlock =
                    item.action_type === 'BLOCK' && item.effective_status === 'ACTIVE'
                  return (
                    <tr key={item.id}>
                      <td className="data-table__lead">
                        <PersonCell
                          name={item.student_full_name}
                          secondary={item.student_number ?? item.student_id}
                        />
                      </td>
                      <td data-label="Exam">{item.exam_title}</td>
                      <td data-label="Action">
                        <span className={`badge ${actionTypeBadgeClass(item.action_type)}`}>
                          {actionTypeLabel(item.action_type)}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span>
                          <span
                            className={`badge ${enforcementStatusBadgeClass(item.effective_status)}`}
                          >
                            {enforcementStatusLabel(item.effective_status)}
                          </span>
                          {item.blocked_until && (
                            <span className="status-note">
                              {BLOCK_END_PREFIX[item.effective_status] ?? 'Until '}
                              {formatDateTimePKT(item.blocked_until)}
                            </span>
                          )}
                        </span>
                      </td>
                      <td data-label="Reason">
                        <span className="data-table__clamp" title={item.reason}>
                          {item.reason}
                        </span>
                      </td>
                      <td data-label="Issued" className="data-table__optional">
                        <span>
                          <span className="d-block">{item.admin_username}</span>
                          <span className="status-note">{formatDateTimePKT(item.created_at)}</span>
                        </span>
                      </td>
                      <td className="data-table__actions">
                        {isActiveBlock && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-warning"
                            onClick={() => {
                              setLiftError('')
                              setPendingLift(item)
                            }}
                          >
                            Lift Block
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={data.page}
            totalPages={data.total_pages}
            total={data.total}
            pageSize={PAGE_SIZE}
            onPrevious={handlePrevious}
            onNext={handleNext}
          />
        </div>
      )}

      {pendingLift && (
        <ConfirmModal
          title="Lift This Block?"
          confirmLabel={lifting ? 'Lifting...' : 'Lift Block'}
          confirmVariant="warning"
          confirmDisabled={lifting}
          onConfirm={handleLift}
          onCancel={() => !lifting && setPendingLift(null)}
        >
          <p>
            <strong>{pendingLift.student_full_name}</strong> will regain write access to{' '}
            <strong>{pendingLift.exam_title}</strong> immediately, before the block&apos;s
            scheduled end{pendingLift.blocked_until ? ` (${formatDateTimePKT(pendingLift.blocked_until)})` : ''}.
          </p>
          <p className="mb-0 small text-muted">
            The block is recorded as lifted in the enforcement log; the original action and its
            reason are kept.
          </p>
          {liftError && (
            <div className="alert alert-danger py-2 small mt-2 mb-0" role="alert">
              {liftError}
            </div>
          )}
        </ConfirmModal>
      )}
    </div>
  )
}
