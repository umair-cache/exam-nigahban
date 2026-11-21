import { plural } from '../../utils/bulkSelection'

// Pinned to the bottom of the page while anything is selected.
export default function BulkActionBar({ count, studentCount, max, onConfirm, onIgnore, onClear }) {
  if (count === 0) return null
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk review">
      <div className="bulk-bar__summary">
        <strong>{plural(count, 'violation')}</strong>
        <span className="text-muted"> &middot; {plural(studentCount, 'student')} selected</span>
        {count >= max && <span className="bulk-bar__limit">Limit of {max} reached</span>}
      </div>
      <div className="bulk-bar__actions">
        <button type="button" className="btn btn-sm btn-danger" onClick={onConfirm}>
          Confirm
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onIgnore}>
          Ignore
        </button>
        <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  )
}
