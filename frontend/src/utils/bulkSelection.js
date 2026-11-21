// Pure helpers for selecting several violations and reviewing them at once.
// The selection is a plain object keyed by event id, holding the few fields
// the bulk bar and dialog show, so it survives live refreshes, paging and
// switching between the two Monitoring views.

import { eventTypeLabel } from './monitoringStatus'

export function toSelectionEntry(event) {
  return {
    id: event.id,
    sessionId: event.session_id,
    studentName: event.student_full_name,
    studentId: event.student_id,
    examTitle: event.exam_title,
    eventType: event.event_type,
    status: event.status,
    // The events list sends evidence_id; a single event carries evidence.
    evidenceId: event.evidence_id ?? event.evidence?.id ?? null,
  }
}

export function addToSelection(selection, events, max = Infinity) {
  const next = { ...selection }
  for (const event of events) {
    if (Object.keys(next).length >= max) break
    next[event.id] = toSelectionEntry(event)
  }
  return next
}

export function removeFromSelection(selection, ids) {
  const next = { ...selection }
  for (const id of ids) delete next[id]
  return next
}

export function removeSessionFromSelection(selection, sessionId) {
  return removeFromSelection(
    selection,
    Object.values(selection)
      .filter((entry) => entry.sessionId === sessionId)
      .map((entry) => entry.id),
  )
}

// One line per student exam session, e.g.
// { key, studentName, studentId, examTitle, count, types: ["Left Exam Screen ×3"] }
export function summarizeSelection(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const group = groups.get(entry.sessionId) ?? {
      key: entry.sessionId,
      studentName: entry.studentName,
      studentId: entry.studentId,
      examTitle: entry.examTitle,
      count: 0,
      typeCounts: new Map(),
    }
    group.count += 1
    group.typeCounts.set(entry.eventType, (group.typeCounts.get(entry.eventType) ?? 0) + 1)
    groups.set(entry.sessionId, group)
  }
  const students = new Set(entries.map((entry) => entry.studentId))
  return {
    count: entries.length,
    studentCount: students.size,
    groups: [...groups.values()].map(({ typeCounts, ...group }) => ({
      ...group,
      types: [...typeCounts.entries()].map(([type, n]) => `${eventTypeLabel(type)} ×${n}`),
    })),
  }
}

// Selected violations that already carry the other decision, which a bulk
// review would reverse (e.g. ignoring violations someone had confirmed).
export function countDecisionChanges(entries, action) {
  return entries.filter(
    (entry) => entry.status && entry.status !== 'PENDING_REVIEW' && entry.status !== action,
  ).length
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

const DONE_WORD = { CONFIRMED: 'confirmed', IGNORED: 'ignored' }

// "11 violations ignored. 1 skipped (voided or no longer available)."
export function describeBulkResult(result, action) {
  const reviewed = result?.reviewed?.length ?? 0
  const skipped = result?.skipped?.length ?? 0
  let text = `${plural(reviewed, 'violation')} ${DONE_WORD[action] ?? 'reviewed'}.`
  if (skipped) text += ` ${skipped} skipped (voided or no longer available).`
  return text
}
