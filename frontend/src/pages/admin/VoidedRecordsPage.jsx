import { useCallback, useEffect, useMemo, useState } from 'react'
import { listVoidedRecords } from '../../api/void'
import { useAuth } from '../../context/AuthContext'
import { getErrorMessage } from '../../utils/apiError'
import { formatDateTimePKT } from '../../utils/dateFormat'
import LoadingState from '../../components/LoadingState'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/admin/PageHeader'
import FilterTabs from '../../components/admin/FilterTabs'
import TablePagination from '../../components/admin/TablePagination'

const PAGE_SIZE = 10
const SUBTITLE =
  'Records withdrawn from the monitoring queues, counts and reports. Nothing here was deleted; each entry keeps who withdrew it, when, and why.'
const KIND_LABELS = { monitoring_event: 'Violation', exam: 'Exam' }
const KIND_BADGE_CLASSES = { monitoring_event: 'text-bg-warning', exam: 'text-bg-dark' }

// The counterpart to voiding, and the reason voiding is not deletion.
//
// A voided record leaves every queue, count and report -- but it must not
// leave the system unaccounted for. Without this page, an administrator
// withdrawing a violation would be indistinguishable from one deleting it,
// and "what happened to event 412?" would have no answer.
export default function VoidedRecordsPage() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await listVoidedRecords())
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load voided records.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.is_system_admin) load()
  }, [load, user?.is_system_admin])

  // The endpoint returns every voided record at once (the list is small and
  // rarely grows), so filtering and paging happen here.
  const filtered = useMemo(
    () => (data ? data.items.filter((item) => !kind || item.kind === kind) : []),
    [data, kind],
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const countOf = (value) => (data ? data.items.filter((item) => item.kind === value).length : 0)
  const handleKindChange = (value) => {
    setKind(value)
    setPage(1)
  }

  // The API refuses this to anyone else, so this only replaces a raw 403
  // with an explanation of why the page is empty for them.
  if (!user?.is_system_admin) {
    return (
      <div>
        <PageHeader title="Voided Records" subtitle={SUBTITLE} />
        <div className="data-card">
          <EmptyState
            title="System administrator only"
            message="Withdrawn records are visible to the system administrator account."
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Voided Records" subtitle={SUBTITLE} />

      <div className="filter-bar">
        <FilterTabs
          label="Filter voided records by type"
          value={kind}
          onChange={handleKindChange}
          options={[
            { value: '', label: `All${data ? ` (${data.items.length})` : ''}` },
            { value: 'monitoring_event', label: `Violations${data ? ` (${countOf('monitoring_event')})` : ''}` },
            { value: 'exam', label: `Exams${data ? ` (${countOf('exam')})` : ''}` },
          ]}
        />
      </div>

      {loading && <LoadingState message="Loading voided records..." />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && data && filtered.length === 0 && (
        <div className="data-card">
          <EmptyState
            title="Nothing has been voided"
            message={
              kind
                ? `No ${kind === 'exam' ? 'exam' : 'violation'} has been withdrawn from the record.`
                : 'No monitoring event or exam has been withdrawn from the record.'
            }
          />
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="data-card">
          <div className="table-responsive">
            <table className="data-table data-table--stack">
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Type</th>
                  <th scope="col">Reason</th>
                  <th scope="col" className="data-table__optional">Voided</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={`${item.kind}-${item.id}`}>
                    <td className="data-table__lead">
                      <span>
                        <span className="d-block fw-medium">{item.label}</span>
                        <span className="status-note">#{item.id}</span>
                      </span>
                    </td>
                    <td data-label="Type">
                      <span className={`badge ${KIND_BADGE_CLASSES[item.kind] || 'text-bg-secondary'}`}>
                        {KIND_LABELS[item.kind] || item.kind}
                      </span>
                    </td>
                    <td data-label="Reason">
                      <span className="data-table__clamp" title={item.void_reason}>
                        {item.void_reason}
                      </span>
                    </td>
                    <td data-label="Voided" className="data-table__optional">
                      <span>
                        <span className="d-block">{item.voided_by}</span>
                        <span className="status-note">{formatDateTimePKT(item.voided_at)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPrevious={() => setPage(Math.max(1, currentPage - 1))}
            onNext={() => setPage(Math.min(totalPages, currentPage + 1))}
          />
        </div>
      )}
    </div>
  )
}
