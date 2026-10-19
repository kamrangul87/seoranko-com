import { afterEach, describe, expect, it } from 'vitest'
import {
  SIGNUP_RATE_LIMIT_PER_HOUR,
  resetSignupRateLimitForTests,
  tryConsumeSignupSlot,
} from './signup-rate-limit'

describe('tryConsumeSignupSlot', () => {
  afterEach(() => {
    resetSignupRateLimitForTests()
  })

  it('allows up to the hourly cap then rejects', () => {
    for (let i = 0; i < SIGNUP_RATE_LIMIT_PER_HOUR; i++) {
      expect(tryConsumeSignupSlot('1.2.3.4')).toBe(true)
    }
    expect(tryConsumeSignupSlot('1.2.3.4')).toBe(false)
  })

  it('tracks IPs independently', () => {
    for (let i = 0; i < SIGNUP_RATE_LIMIT_PER_HOUR; i++) {
      expect(tryConsumeSignupSlot('10.0.0.1')).toBe(true)
    }
    expect(tryConsumeSignupSlot('10.0.0.1')).toBe(false)
    expect(tryConsumeSignupSlot('10.0.0.2')).toBe(true)
  })
})
