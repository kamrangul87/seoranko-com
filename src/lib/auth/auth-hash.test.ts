import { describe, expect, it } from 'vitest'
import {
  AUTH_HASH_CAPTURE_SCRIPT,
  loginPathAfterAuthFailure,
  nextPathAfterAuthType,
  parseAuthHash,
} from './auth-hash'

describe('AUTH_HASH_CAPTURE_SCRIPT', () => {
  it('stores signup and recovery hashes before React boots', () => {
    expect(AUTH_HASH_CAPTURE_SCRIPT).toMatch(/sessionStorage\.setItem/)
    expect(AUTH_HASH_CAPTURE_SCRIPT).toMatch(/access_token/)
    expect(AUTH_HASH_CAPTURE_SCRIPT).toMatch(/type=signup/)
    expect(AUTH_HASH_CAPTURE_SCRIPT).toMatch(/type=recovery/)
  })
})

describe('parseAuthHash', () => {
  it('parses signup implicit tokens from the marketing homepage hash', () => {
    const parsed = parseAuthHash(
      '#access_token=tok_abc&expires_in=3600&refresh_token=ref_xyz&token_type=bearer&type=signup',
    )
    expect(parsed).toEqual({
      accessToken: 'tok_abc',
      refreshToken: 'ref_xyz',
      type: 'signup',
      error: null,
      errorCode: null,
    })
  })

  it('parses recovery hashes', () => {
    expect(parseAuthHash('#access_token=a&refresh_token=b&type=recovery')?.type).toBe(
      'recovery',
    )
  })

  it('parses error hashes', () => {
    const parsed = parseAuthHash(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    )
    expect(parsed?.error).toBe('access_denied')
    expect(parsed?.errorCode).toBe('otp_expired')
  })

  it('ignores unrelated hashes', () => {
    expect(parseAuthHash('#pricing')).toBeNull()
    expect(parseAuthHash('')).toBeNull()
    expect(parseAuthHash('#')).toBeNull()
  })
})

describe('nextPathAfterAuthType', () => {
  it('sends recovery to reset-password and signup to dashboard', () => {
    expect(nextPathAfterAuthType('recovery')).toBe('/reset-password')
    expect(nextPathAfterAuthType('signup')).toBe('/dashboard')
    expect(nextPathAfterAuthType('signup', '/dashboard/settings')).toBe(
      '/dashboard/settings',
    )
    expect(nextPathAfterAuthType('signup', 'https://evil.example')).toBe(
      '/dashboard',
    )
  })
})

describe('loginPathAfterAuthFailure', () => {
  it('uses confirmed vs expired based on the hash', () => {
    expect(loginPathAfterAuthFailure(null)).toBe('/login?confirmed=1')
    expect(
      loginPathAfterAuthFailure({
        accessToken: null,
        refreshToken: null,
        type: 'signup',
        error: 'access_denied',
        errorCode: 'otp_expired',
      }),
    ).toBe('/login?error=link_expired')
  })
})
