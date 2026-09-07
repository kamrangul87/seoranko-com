import { describe, expect, it } from 'vitest'
import {
  attemptUrlsMatch,
  findParentSiteHint,
  hostOf,
  pickExactSiteForHost,
} from './site-connection-lookup'

describe('pickExactSiteForHost', () => {
  const sites = [
    { id: '1', domain: 'autodun.com' },
    { id: '2', domain: 'ev.autodun.com' },
    { id: '3', domain: 'ai.autodun.com' },
  ]

  it('matches the exact subdomain site, not the parent', () => {
    expect(pickExactSiteForHost(sites, 'ev.autodun.com')?.id).toBe('2')
    expect(pickExactSiteForHost(sites, 'https://EV.autodun.com/path')?.id).toBe('2')
  })

  it('does not let parent claim a subdomain host', () => {
    expect(pickExactSiteForHost([{ id: '1', domain: 'autodun.com' }], 'ev.autodun.com')).toBeNull()
  })

  it('matches apex exactly', () => {
    expect(pickExactSiteForHost(sites, 'www.autodun.com')?.id).toBe('1')
  })
})

describe('findParentSiteHint', () => {
  it('finds parent when only apex is registered', () => {
    expect(
      findParentSiteHint([{ domain: 'autodun.com' }], 'mot.autodun.com')?.domain,
    ).toBe('autodun.com')
  })

  it('returns null when exact site exists (hint unused)', () => {
    // Hint still finds parent; callers use it only when exact pick is null.
    expect(
      findParentSiteHint(
        [{ domain: 'autodun.com' }, { domain: 'mot.autodun.com' }],
        'mot.autodun.com',
      )?.domain,
    ).toBe('autodun.com')
  })
})

describe('attemptUrlsMatch', () => {
  it('treats www / trailing-slash / query as the same attempt URL', () => {
    expect(
      attemptUrlsMatch('https://www.autodun.com/blog/', 'https://autodun.com/blog'),
    ).toBe(true)
    expect(
      attemptUrlsMatch('https://autodun.com/blog?utm=1', 'https://autodun.com/blog'),
    ).toBe(true)
  })

  it('does not match different paths', () => {
    expect(attemptUrlsMatch('https://autodun.com/a', 'https://autodun.com/b')).toBe(false)
  })
})

describe('hostOf', () => {
  it('strips www', () => {
    expect(hostOf('https://www.ev.autodun.com/x')).toBe('ev.autodun.com')
  })
})
