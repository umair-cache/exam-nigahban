import { InboxIcon } from './admin/icons'

// Shown when a list has nothing to display. `action` is optional (e.g. a
// "Create exam" button); existing callers that pass only title/message
// render exactly as before, plus the icon.
export default function EmptyState({ title = 'Nothing here yet', message, action }) {
  return (
    <div className="empty-state text-center text-muted py-5">
      <span className="empty-state__icon" aria-hidden="true">
        <InboxIcon width={26} height={26} />
      </span>
      <h2 className="h6 text-body">{title}</h2>
      {message && <p className="mb-0">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
