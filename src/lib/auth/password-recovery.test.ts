import { describe, expect, it } from 'vitest'
import {
  isValidPassword,
  passwordResetRedirectTo,
  PASSWORD_RESET_REDIRECT_APEX,
  PASSWORD_RESET_REDIRECT_WWW,
} from './password-recovery'

describe('password recovery helpers', () => {
  it('builds redirectTo via /auth/callback?next=/reset-password', () => {
    expect(passwordResetRedirectTo('https://www.seoranko.com')).toBe(
      'https://www.seoranko.com/auth/callback?next=%2Freset-password',
    )
    expect(passwordResetRedirectTo('https://seoranko.com')).toBe(
      'https://seoranko.com/auth/callback?next=%2Freset-password',
    )
    expect(PASSWORD_RESET_REDIRECT_WWW).toBe(
      'https://www.seoranko.com/auth/callback?next=%2Freset-password',
    )
    expect(PASSWORD_RESET_REDIRECT_APEX).toBe(
      'https://seoranko.com/auth/callback?next=%2Freset-password',
    )
  })

  it('falls back to www production callback', () => {
    expect(passwordResetRedirectTo(null)).toBe(
      'https://www.seoranko.com/auth/callback?next=%2Freset-password',
    )
  })

  it('requires at least 8 characters', () => {
    expect(isValidPassword('short')).toBe(false)
    expect(isValidPassword('longenough')).toBe(true)
  })
})
