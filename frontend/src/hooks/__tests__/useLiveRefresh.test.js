import { describe, expect, it } from 'vitest'
import { shouldLiveRefresh } from '../useLiveRefresh'

describe('shouldLiveRefresh', () => {
  it('refreshes on a new violation', () => {
    expect(shouldLiveRefresh({ type: 'monitoring_event' })).toBe(true)
  })

  it('refreshes when any admin reviews or voids', () => {
    expect(shouldLiveRefresh({ type: 'review_queue_changed' })).toBe(true)
  })

  it('ignores enforcement actions, unknown types and empty messages', () => {
    expect(shouldLiveRefresh({ type: 'enforcement_action' })).toBe(false)
    expect(shouldLiveRefresh({ type: 'something_else' })).toBe(false)
    expect(shouldLiveRefresh(null)).toBe(false)
    expect(shouldLiveRefresh(undefined)).toBe(false)
  })
})
