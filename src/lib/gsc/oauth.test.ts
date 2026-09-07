import { describe, expect, it, beforeAll } from 'vitest'
import { signGscOAuthState, verifyGscOAuthState } from './oauth'

describe('GSC OAuth state', () => {
  beforeAll(() => {
    process.env.SITE_CONNECTION_ENCRYPTION_KEY =
      process.env.SITE_CONNECTION_ENCRYPTION_KEY || 'test-gsc-oauth-signing-key-32chars!!'
  })

  it('round-trips a signed state payload', () => {
    const token = signGscOAuthState({
      userId: 'user-1',
      siteId: 'site-1',
      nonce: 'abc',
      exp: Date.now() + 60_000,
    })
    const parsed = verifyGscOAuthState(token)
    expect(parsed.userId).toBe('user-1')
    expect(parsed.siteId).toBe('site-1')
  })

  it('rejects tampered state', () => {
    const token = signGscOAuthState({
      userId: 'user-1',
      siteId: 'site-1',
      nonce: 'abc',
      exp: Date.now() + 60_000,
    })
    expect(() => verifyGscOAuthState(token.replace(/\./, '.x'))).toThrow(/Invalid OAuth state/)
  })

  it('rejects expired state', () => {
    const token = signGscOAuthState({
      userId: 'user-1',
      siteId: 'site-1',
      nonce: 'abc',
      exp: Date.now() - 1000,
    })
    expect(() => verifyGscOAuthState(token)).toThrow(/expired/i)
  })
})
