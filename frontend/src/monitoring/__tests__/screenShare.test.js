import { describe, expect, it } from 'vitest'
import {
  SCREEN_SHARE_STOPPED,
  base64ByteLength,
  buildScreenShareStoppedEvent,
  getActiveScreenShare,
  isEntireScreenSettings,
  screenShareSupported,
} from '../screenShare'
import { SCREEN_SHARE_STOPPED_RULE } from '../constants'

describe('isEntireScreenSettings', () => {
  it('passes only when the entire screen (monitor) was shared', () => {
    expect(isEntireScreenSettings({ displaySurface: 'monitor' })).toBe(true)
  })

  it('rejects a shared window or browser tab', () => {
    expect(isEntireScreenSettings({ displaySurface: 'window' })).toBe(false)
    expect(isEntireScreenSettings({ displaySurface: 'browser' })).toBe(false)
  })

  it('rejects a browser that does not report what was shared', () => {
    expect(isEntireScreenSettings({})).toBe(false)
    expect(isEntireScreenSettings(undefined)).toBe(false)
  })
})

describe('base64ByteLength', () => {
  it('computes decoded size including padding', () => {
    expect(base64ByteLength(btoa('abc'))).toBe(3)
    expect(base64ByteLength(btoa('abcd'))).toBe(4)
    expect(base64ByteLength(btoa('abcde'))).toBe(5)
    expect(base64ByteLength('')).toBe(0)
  })
})

describe('buildScreenShareStoppedEvent', () => {
  it('matches the server rule for SCREEN_SHARE_STOPPED', () => {
    expect(buildScreenShareStoppedEvent()).toEqual({
      eventType: SCREEN_SHARE_STOPPED,
      severity: SCREEN_SHARE_STOPPED_RULE.severity,
      confidence: SCREEN_SHARE_STOPPED_RULE.confidenceThreshold,
      durationSeconds: SCREEN_SHARE_STOPPED_RULE.minDurationSec,
      occurrences: SCREEN_SHARE_STOPPED_RULE.requiredOccurrences,
      source: 'browser_screen_share',
    })
  })
})

describe('shared session', () => {
  it('has no active share and reports no support outside a browser', () => {
    expect(getActiveScreenShare()).toBeNull()
    expect(screenShareSupported()).toBe(false)
  })
})
