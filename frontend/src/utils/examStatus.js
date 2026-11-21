// Exam lifecycle status (draft / active / inactive) -> badge class and
// label. Shared by every admin screen that shows an exam's status, so the
// same status always looks the same.
const EXAM_STATUS_BADGE_CLASS = {
  draft: 'text-bg-secondary',
  active: 'text-bg-success',
  inactive: 'text-bg-warning',
}

export function examStatusBadgeClass(examStatus) {
  return EXAM_STATUS_BADGE_CLASS[examStatus] || 'text-bg-secondary'
}

export function examStatusLabel(examStatus) {
  if (!examStatus) return 'Unknown'
  return examStatus.charAt(0).toUpperCase() + examStatus.slice(1)
}

// Display names for a list of exams that keep same-titled exams apart:
// a title used once stays as-is; a repeated title gains its creation date,
// and its ID too if that is also shared. Returns a Map of exam id -> name.
export function examDisplayNames(exams, formatDate) {
  const key = (exam) => (exam.title || '').trim().toLowerCase()
  const titleCounts = new Map()
  for (const exam of exams) titleCounts.set(key(exam), (titleCounts.get(key(exam)) || 0) + 1)

  const withDate = exams.map((exam) => ({
    exam,
    name:
      titleCounts.get(key(exam)) > 1 && exam.created_at
        ? `${exam.title} (created ${formatDate(exam.created_at)})`
        : exam.title,
  }))
  const nameCounts = new Map()
  for (const { name } of withDate) nameCounts.set(name, (nameCounts.get(name) || 0) + 1)

  return new Map(
    withDate.map(({ exam, name }) => [
      exam.id,
      nameCounts.get(name) > 1 ? `${name} #${exam.id}` : name,
    ]),
  )
}
