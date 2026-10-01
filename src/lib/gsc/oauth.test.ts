import { describe, expect, it, beforeAll } from 'vitest'
import { buildGscAuthorizeUrl, signGscOAuthState, verifyGscOAuthState } from './oauth'

describe('GSC OAuth state', () => {
  beforeAll(() => {
    process.env.SITE_CONNECTION_ENCRYPTION_KEY =
      process.env.SITE_CONNECTION_ENCRYPTION_KEY || 'test-gsc-oauth-signing-key-32chars!!'
  })

  it('round-trips a site-mode signed state payload', () => {
    const token = signGscOAuthState({
      userId: 'user-1',
      mode: 'site',
      siteId: 'site-1',
      nonce: 'abc',
      exp: Date.now() + 60_000,
    })
    const parsed = verifyGscOAuthState(token)
    expect(parsed.userId).toBe('user-1')
    expect(parsed.mode).toBe('site')
    expect(parsed.siteId).toBe('site-1')
  })

  it('round-trips an account-mode state without siteId', () => {
    const token = signGscOAuthState({
      userId: 'user-1',
      mode: 'account',
      nonce: 'abc',
      exp: Date.now() + 60_000,
    })
    const parsed = verifyGscOAuthState(token)
    expect(parsed.mode).toBe('account')
    expect(parsed.siteId).toBeUndefined()
  })

  it('rejects site mode without siteId at sign time', () => {
    expect(() =>
      signGscOAuthState({
        userId: 'user-1',
        mode: 'site',
        nonce: 'abc',
        exp: Date.now() + 60_000,
      }),
    ).toThrow(/siteId is required/)
  })

  it('rejects tampered state', () => {
    const token = signGscOAuthState({
      userId: 'user-1',
      mode: 'site',
      siteId: 'site-1',
      nonce: 'abc',
      exp: Date.now() + 60_000,
    })
    expect(() => verifyGscOAuthState(token.replace(/\./, '.x'))).toThrow(/Invalid OAuth state/)
  })

  it('rejects expired state', () => {
    const token = signGscOAuthState({
      userId: 'user-1',
      mode: 'account',
      nonce: 'abc',
      exp: Date.now() - 1000,
    })
    expect(() => verifyGscOAuthState(token)).toThrow(/expired/i)
  })

  it('requests offline access and consent for a refresh token', () => {
    process.env.GOOGLE_GSC_CLIENT_ID = 'test-client-id'
    process.env.GOOGLE_GSC_CLIENT_SECRET = 'test-client-secret'
    process.env.GOOGLE_GSC_REDIRECT_URI = 'https://www.seoranko.com/api/gsc/callback'
    const url = new URL(buildGscAuthorizeUrl('state-token'))
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('scope')).toContain('webmasters.readonly')
  })
})
