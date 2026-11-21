import { describe, expect, it } from 'vitest'
import {
  addToSelection,
  countDecisionChanges,
  describeBulkResult,
  removeFromSelection,
  removeSessionFromSelection,
  summarizeSelection,
} from '../bulkSelection'

const event = (id, sessionId, studentId, type = 'LEFT_EXAM_SCREEN', evidence = null) => ({
  id,
  session_id: sessionId,
  student_full_name: `Student ${studentId}`,
  student_id: studentId,
  exam_title: 'Math',
  event_type: type,
  evidence,
})

describe('bulk selection', () => {
  it('adds events keyed by id, keeping the fields the dialog needs', () => {
    const selection = addToSelection({}, [event(1, 10, 'S1', 'MOBILE_PHONE', { id: 7 })])
    expect(selection[1]).toMatchObject({ id: 1, sessionId: 10, studentId: 'S1', evidenceId: 7 })
  })

  it('reads evidence_id from the events list', () => {
    const selection = addToSelection({}, [{ ...event(2, 10, 'S1'), evidence_id: 9 }])
    expect(selection[2].evidenceId).toBe(9)
  })

  it('does not duplicate an event added twice', () => {
    const once = addToSelection({}, [event(1, 10, 'S1')])
    expect(Object.keys(addToSelection(once, [event(1, 10, 'S1')]))).toEqual(['1'])
  })

  it('stops at the maximum batch size', () => {
    const events = [1, 2, 3].map((id) => event(id, 10, 'S1'))
    expect(Object.keys(addToSelection({}, events, 2))).toHaveLength(2)
  })

  it('removes by id and by session', () => {
    const selection = addToSelection({}, [event(1, 10, 'S1'), event(2, 11, 'S2'), event(3, 10, 'S1')])
    expect(Object.keys(removeFromSelection(selection, [2]))).toEqual(['1', '3'])
    expect(Object.keys(removeSessionFromSelection(selection, 10))).toEqual(['2'])
  })

  it('summarises by student session with counts per violation type', () => {
    const selection = addToSelection({}, [
      event(1, 10, 'S1'),
      event(2, 10, 'S1'),
      event(3, 10, 'S1', 'MOBILE_PHONE'),
      event(4, 11, 'S2'),
    ])
    const summary = summarizeSelection(Object.values(selection))
    expect(summary.count).toBe(4)
    expect(summary.studentCount).toBe(2)
    expect(summary.groups[0]).toMatchObject({ studentId: 'S1', count: 3 })
    expect(summary.groups[0].types).toEqual(['Left Exam Screen ×2', 'Mobile Phone ×1'])
  })

  it('counts the decisions a bulk review would reverse', () => {
    const entries = Object.values(
      addToSelection({}, [
        { ...event(1, 10, 'S1'), status: 'PENDING_REVIEW' },
        { ...event(2, 10, 'S1'), status: 'CONFIRMED' },
        { ...event(3, 10, 'S1'), status: 'IGNORED' },
      ]),
    )
    expect(countDecisionChanges(entries, 'IGNORED')).toBe(1)
    expect(countDecisionChanges(entries, 'CONFIRMED')).toBe(1)
  })

  it('describes partial results honestly', () => {
    expect(describeBulkResult({ reviewed: [{}, {}], skipped: [] }, 'IGNORED')).toBe(
      '2 violations ignored.',
    )
    expect(describeBulkResult({ reviewed: [{}], skipped: [{}] }, 'CONFIRMED')).toBe(
      '1 violation confirmed. 1 skipped (voided or no longer available).',
    )
  })
})
