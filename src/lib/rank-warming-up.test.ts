import { describe, it, expect } from 'vitest'
import { isWarmingUp, daysUntilWarmingUpEnds, decayMonitoringEligible } from './rank-warming-up'

describe('isWarmingUp', () => {
  const now = new Date('2026-08-18T00:00:00Z')

  it('is true the day a page is published', () => {
    expect(isWarmingUp('2026-08-18T00:00:00Z', now)).toBe(true)
  })

  it('is true 89 days in', () => {
    expect(isWarmingUp('2026-05-21T00:00:00Z', now)).toBe(true)
  })

  it('is false at 90+ days', () => {
    expect(isWarmingUp('2026-05-20T00:00:00Z', now)).toBe(false)
  })

  it('is false with no publishedAt', () => {
    expect(isWarmingUp(null, now)).toBe(false)
    expect(isWarmingUp(undefined, now)).toBe(false)
  })

  it('is false for a garbage date string', () => {
    expect(isWarmingUp('not-a-date', now)).toBe(false)
  })
})

describe('daysUntilWarmingUpEnds', () => {
  it('counts down from 90', () => {
    const now = new Date('2026-08-18T00:00:00Z')
    expect(daysUntilWarmingUpEnds('2026-08-18T00:00:00Z', now)).toBe(90)
    expect(daysUntilWarmingUpEnds('2026-07-19T00:00:00Z', now)).toBe(60)
  })
})

describe('decayMonitoringEligible', () => {
  it('is only true for LIVE_VERIFIED', () => {
    expect(decayMonitoringEligible('LIVE_VERIFIED')).toBe(true)
    expect(decayMonitoringEligible('LIVE_UNVERIFIED')).toBe(false)
    expect(decayMonitoringEligible('CREATED')).toBe(false)
    expect(decayMonitoringEligible('FAILED')).toBe(false)
    expect(decayMonitoringEligible(null)).toBe(false)
  })
})
