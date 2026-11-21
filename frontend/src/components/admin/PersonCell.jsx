import { studentInitials } from '../../utils/monitoringStatus'

// A person in a table: initials avatar, name, and a secondary line (an ID
// or username) -- the same identity treatment as the Monitoring cards.
export default function PersonCell({ name, secondary, badge }) {
  return (
    <div className="person-cell">
      <span className="person-cell__avatar" aria-hidden="true">
        {studentInitials(name)}
      </span>
      <span className="person-cell__text">
        <span className="person-cell__name">
          {name}
          {badge}
        </span>
        {secondary && <span className="person-cell__secondary">{secondary}</span>}
      </span>
    </div>
  )
}
