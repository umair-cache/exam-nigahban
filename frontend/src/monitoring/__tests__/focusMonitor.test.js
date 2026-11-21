import { describe, expect, it } from 'vitest'
import {
  FOCUS_EVENT_SOURCE,
  LEFT_EXAM_SCREEN,
  createFocusTracker,
  isExamScreenActive,
  screenCaptureOffsetsMs,
} from '../focusMonitor'
import { FOCUS_MAX_AWAY_SEC, FOCUS_RULE } from '../constants'

function fakeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    advance: (seconds) => {
      t += seconds * 1000
    },
  }
}

describe('isExamScreenActive', () => {
  const frame = { tag: 'iframe' }

  it('is active when visible and focused', () => {
    expect(isExamScreenActive({ visibilityState: 'visible', hasFocus: true, activeElement: null })).toBe(true)
  })

  it('is not active when the page is hidden (other tab, minimised)', () => {
    expect(isExamScreenActive({ visibilityState: 'hidden', hasFocus: true, activeElement: null })).toBe(false)
  })

  it('is not active when another window or monitor has focus', () => {
    expect(isExamScreenActive({ visibilityState: 'visible', hasFocus: false, activeElement: null })).toBe(false)
  })

  it('treats focus inside the exam frame (iSpring) as still on the exam', () => {
    expect(
      isExamScreenActive({ visibilityState: 'visible', hasFocus: false, activeElement: frame, examFrames: [frame] }),
    ).toBe(true)
  })

  it('does not treat an unrelated frame as the exam', () => {
    expect(
      isExamScreenActive({ visibilityState: 'visible', hasFocus: false, activeElement: { tag: 'other' }, examFrames: [frame] }),
    ).toBe(false)
  })
})

describe('createFocusTracker', () => {
  it('ignores an absence shorter than the minimum (a blip)', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(FOCUS_RULE.minDurationSec - 0.5)
    expect(tracker.markPresent()).toEqual({ event: null, awaySeconds: null })
    expect(tracker.isAway()).toBe(false)
  })

  it('reports one event on return with the exact duration and rule values', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(8.4)
    const { event, awaySeconds } = tracker.markPresent()
    expect(awaySeconds).toBe(8.4)
    expect(event).toEqual({
      eventType: LEFT_EXAM_SCREEN,
      severity: FOCUS_RULE.severity,
      confidence: FOCUS_RULE.confidenceThreshold,
      durationSeconds: 8.4,
      occurrences: FOCUS_RULE.requiredOccurrences,
      source: FOCUS_EVENT_SOURCE,
    })
  })

  it('reports exactly the minimum duration', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(FOCUS_RULE.minDurationSec)
    expect(tracker.markPresent().event.durationSeconds).toBe(FOCUS_RULE.minDurationSec)
  })

  it('attaches the snapshot taken when the student left', () => {
    const clock = fakeClock()
    let calls = 0
    const tracker = createFocusTracker({
      now: clock.now,
      captureEvidence: () => {
        calls += 1
        return 'jpeg-base64'
      },
    })
    tracker.markAway()
    tracker.markAway() // repeated signal during the same absence
    clock.advance(5)
    expect(tracker.markPresent().event.evidenceImageBase64).toBe('jpeg-base64')
    expect(calls).toBe(1)
  })

  it('omits evidence when the camera could not provide a frame', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now, captureEvidence: () => null })
    tracker.markAway()
    clock.advance(5)
    expect(tracker.markPresent().event).not.toHaveProperty('evidenceImageBase64')
  })

  it('keeps the start of an absence when away is signalled twice', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(3)
    tracker.markAway()
    clock.advance(3)
    expect(tracker.markPresent().event.durationSeconds).toBe(6)
  })

  it('reports a long absence live at the cap, and not again on return', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(FOCUS_MAX_AWAY_SEC - 1)
    expect(tracker.tick()).toBeNull()
    clock.advance(1)
    const live = tracker.tick()
    expect(live.durationSeconds).toBe(FOCUS_MAX_AWAY_SEC)
    clock.advance(30)
    expect(tracker.tick()).toBeNull()
    const back = tracker.markPresent()
    expect(back.event).toBeNull()
    // The notice still tells the student the full absence.
    expect(back.awaySeconds).toBe(FOCUS_MAX_AWAY_SEC + 30)
  })

  it('records each separate absence as its own event', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(3)
    const first = tracker.markPresent().event
    clock.advance(10)
    tracker.markAway()
    clock.advance(4)
    const second = tracker.markPresent().event
    expect(first.durationSeconds).toBe(3)
    expect(second.durationSeconds).toBe(4)
  })

  it('returns the pending absence when the page closes', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(12)
    expect(tracker.flush().durationSeconds).toBe(12)
    expect(tracker.isAway()).toBe(false)
  })

  it('sends nothing on close for a blip or an absence already reported live', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(1)
    expect(tracker.flush()).toBeNull()

    tracker.markAway()
    clock.advance(FOCUS_MAX_AWAY_SEC)
    expect(tracker.tick()).not.toBeNull()
    expect(tracker.flush()).toBeNull()
  })

  it('drops an absence without reporting when monitoring is switched off', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    clock.advance(20)
    tracker.reset()
    expect(tracker.markPresent()).toEqual({ event: null, awaySeconds: null })
    expect(tracker.flush()).toBeNull()
  })

  it('does nothing when present is signalled without an absence', () => {
    const tracker = createFocusTracker()
    expect(tracker.markPresent()).toEqual({ event: null, awaySeconds: null })
    expect(tracker.tick()).toBeNull()
    expect(tracker.flush()).toBeNull()
  })
})

describe('screen captures during an absence', () => {
  it('schedules captures at +1 s and then every 5 s, at most six', () => {
    expect(screenCaptureOffsetsMs()).toEqual([1000, 6000, 11000, 16000, 21000, 26000])
  })

  it('attaches captures to the event of the absence they belong to', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    const started = tracker.awayStartedAt()
    clock.advance(1)
    expect(tracker.addScreenCapture(started, { sequence: 1, offsetMs: 1000, imageBase64: 'a' })).toBe(true)
    clock.advance(5)
    tracker.addScreenCapture(started, { sequence: 2, offsetMs: 6000, imageBase64: 'b' })
    clock.advance(1)
    const { event } = tracker.markPresent()
    expect(event.screenCaptures.map((c) => c.sequence)).toEqual([1, 2])
  })

  it('never attaches a late capture to a different absence', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    const first = tracker.awayStartedAt()
    clock.advance(3)
    tracker.markPresent()
    clock.advance(10)
    tracker.markAway()
    expect(tracker.addScreenCapture(first, { sequence: 1, offsetMs: 1000, imageBase64: 'late' })).toBe(false)
    clock.advance(3)
    expect(tracker.markPresent().event).not.toHaveProperty('screenCaptures')
  })

  it('includes captures in a live (60 s) report and accepts none afterwards', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    const started = tracker.awayStartedAt()
    tracker.addScreenCapture(started, { sequence: 1, offsetMs: 1000, imageBase64: 'a' })
    clock.advance(FOCUS_MAX_AWAY_SEC)
    expect(tracker.tick().screenCaptures).toHaveLength(1)
    expect(tracker.addScreenCapture(started, { sequence: 2, offsetMs: 6000, imageBase64: 'b' })).toBe(false)
  })

  it('caps captures per absence', () => {
    const tracker = createFocusTracker({ now: fakeClock().now })
    tracker.markAway()
    const started = tracker.awayStartedAt()
    for (let i = 1; i <= 6; i += 1) {
      expect(tracker.addScreenCapture(started, { sequence: i, offsetMs: i, imageBase64: 'x' })).toBe(true)
    }
    expect(tracker.addScreenCapture(started, { sequence: 7, offsetMs: 7, imageBase64: 'x' })).toBe(false)
  })

  it('drops captures when the absence is reset', () => {
    const clock = fakeClock()
    const tracker = createFocusTracker({ now: clock.now })
    tracker.markAway()
    tracker.addScreenCapture(tracker.awayStartedAt(), { sequence: 1, offsetMs: 1000, imageBase64: 'a' })
    tracker.reset()
    tracker.markAway()
    clock.advance(3)
    expect(tracker.markPresent().event).not.toHaveProperty('screenCaptures')
  })
})
