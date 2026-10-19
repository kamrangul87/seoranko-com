import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { redirectAuthCodeIfNeeded } from './auth-callback-middleware'

function req(path: string) {
  return new NextRequest(new URL(path, 'https://www.seoranko.com'))
}

describe('redirectAuthCodeIfNeeded', () => {
  it('ignores /auth/callback itself', () => {
    expect(
      redirectAuthCodeIfNeeded(
        req('/auth/callback?code=abc&next=/reset-password'),
      ),
    ).toBeNull()
  })

  it('ignores pages without code', () => {
    expect(redirectAuthCodeIfNeeded(req('/'))).toBeNull()
    expect(redirectAuthCodeIfNeeded(req('/login'))).toBeNull()
  })

  it('sends recovery codes to reset-password via callback', () => {
    const res = redirectAuthCodeIfNeeded(
      req('/?code=abc123&type=recovery'),
    )
    expect(res).not.toBeNull()
    expect(res!.headers.get('location')).toBe(
      'https://www.seoranko.com/auth/callback?code=abc123&next=%2Freset-password',
    )
  })

  it('treats bare /?code= (Site URL fallback) as recovery → reset-password', () => {
    const res = redirectAuthCodeIfNeeded(req('/?code=xyz'))
    expect(res!.headers.get('location')).toBe(
      'https://www.seoranko.com/auth/callback?code=xyz&next=%2Freset-password',
    )
  })

  it('defaults unknown type on other paths to /dashboard', () => {
    const res = redirectAuthCodeIfNeeded(req('/pricing?code=xyz'))
    expect(res!.headers.get('location')).toBe(
      'https://www.seoranko.com/auth/callback?code=xyz&next=%2Fdashboard',
    )
  })
})
