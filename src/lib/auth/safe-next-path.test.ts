import { describe, expect, it } from 'vitest'
import {
  authCallbackRedirectTo,
  safeNextPath,
} from './safe-next-path'

describe('safeNextPath', () => {
  it('allows relative paths starting with /', () => {
    expect(safeNextPath('/reset-password')).toBe('/reset-password')
    expect(safeNextPath('/dashboard')).toBe('/dashboard')
    expect(safeNextPath('/dashboard/settings')).toBe('/dashboard/settings')
  })

  it('rejects open redirects', () => {
    expect(safeNextPath('https://evil.com')).toBe('/dashboard')
    expect(safeNextPath('//evil.com')).toBe('/dashboard')
    expect(safeNextPath('/\\evil.com')).toBe('/dashboard')
    expect(safeNextPath('../etc')).toBe('/dashboard')
    expect(safeNextPath('/foo/../bar')).toBe('/dashboard')
  })

  it('falls back when missing', () => {
    expect(safeNextPath(null)).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
  })
})

describe('authCallbackRedirectTo', () => {
  it('builds origin + /auth/callback?next=…', () => {
    expect(
      authCallbackRedirectTo('https://www.seoranko.com', '/reset-password'),
    ).toBe(
      'https://www.seoranko.com/auth/callback?next=%2Freset-password',
    )
    expect(
      authCallbackRedirectTo('https://seoranko.com/', '/dashboard'),
    ).toBe('https://seoranko.com/auth/callback?next=%2Fdashboard')
  })
})
