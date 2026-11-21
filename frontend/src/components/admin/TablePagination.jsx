// Footer row for a data card: "Showing 1-10 of 17" and Previous / Next.
export default function TablePagination({ page, totalPages, total, pageSize, onPrevious, onNext }) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  return (
    <div className="data-card__footer">
      <p className="data-card__summary">
        Showing <strong>{first}</strong>&ndash;<strong>{last}</strong> of <strong>{total}</strong>
      </p>
      <div className="d-flex align-items-center gap-2">
        <span className="data-card__page small text-muted">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={onPrevious}
          disabled={page <= 1}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={onNext}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  )
}
