// Quick-filter tabs ("All 17 · Students 15 · Administrators 2"). Each tab
// is a toggle button; the selected one is aria-pressed. `count` is optional
// and omitted where the total is not known without an extra request.
export default function FilterTabs({ label, options, value, onChange }) {
  return (
    <div className="filter-tabs" role="group" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value || 'all'}
            type="button"
            className={`filter-tabs__tab${selected ? ' filter-tabs__tab--selected' : ''}`}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {typeof option.count === 'number' && (
              <span className="filter-tabs__count">{option.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
