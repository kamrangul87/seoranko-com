import { describe, expect, it } from 'vitest'
import {
  isValidPassword,
  passwordResetRedirectTo,
  PASSWORD_RESET_REDIRECT_APEX,
  PASSWORD_RESET_REDIRECT_WWW,
} from './password-recovery'

describe('password recovery helpers', () => {
  it('builds redirectTo from the current origin', () => {
    expect(passwordResetRedirectTo('https://www.seoranko.com')).toBe(
      PASSWORD_RESET_REDIRECT_WWW,
    )
    expect(passwordResetRedirectTo('https://seoranko.com')).toBe(
      PASSWORD_RESET_REDIRECT_APEX,
    )
  })

  it('falls back to www production URL', () => {
    expect(passwordResetRedirectTo(null)).toBe(PASSWORD_RESET_REDIRECT_WWW)
  })

  it('requires at least 8 characters', () => {
    expect(isValidPassword('short')).toBe(false)
    expect(isValidPassword('longenough')).toBe(true)
  })
})
