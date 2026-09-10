import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  explainPublicCause,
  PUBLIC_REASON_AUTO_FIXABLE,
  upgradeCtaForCause,
} from './explanations'
import { PUBLIC_EXCLUSION_REASONS } from './types'
import { clientIpFromHeaders, validatePublicDomainInput } from './validate-domain'

describe('public Index Diagnosis explanations', () => {
  it('has a template for every reason code', () => {
    for (const reason of PUBLIC_EXCLUSION_REASONS) {
      const copy = explainPublicCause(reason, 3, 'https://example.com/page')
      expect(copy.headline.length).toBeGreaterThan(5)
      expect(copy.explanation).toContain('https://example.com/page')
      expect(copy.explanation).toMatch(/3/)
      expect(copy.action.length).toBeGreaterThan(10)
      expect(copy.autoFixable).toBe(PUBLIC_REASON_AUTO_FIXABLE[reason])
    }
  })

  it('keeps action lines concrete and imperative', () => {
    const redirect = explainPublicCause('REDIRECT_CHAIN', 2, 'https://example.com/a')
    expect(redirect.action.toLowerCase()).toMatch(/replace|href|final destination/)
    expect(redirect.autoFixable).toBe(true)

    const thin = explainPublicCause('THIN_CONTENT', 2, 'https://example.com/')
    expect(thin.action.toLowerCase()).toMatch(/expand|200|noindex/)
    expect(thin.autoFixable).toBe(false)

    const dead = explainPublicCause('HTTP_4XX', 1, 'https://example.com/missing')
    expect(dead.action.toLowerCase()).toMatch(/restore|remove|href/)
    expect(dead.autoFixable).toBe(true)
  })

  it('does not claim Fix Agent auto-fix for editorial findings', () => {
    expect(PUBLIC_REASON_AUTO_FIXABLE.THIN_CONTENT).toBe(false)
    expect(PUBLIC_REASON_AUTO_FIXABLE.NEAR_DUPLICATE).toBe(false)
    expect(PUBLIC_REASON_AUTO_FIXABLE.ORPHAN_NO_INLINKS).toBe(false)
    expect(upgradeCtaForCause(true)).toMatch(/Fix Agent can apply this automatically/)
    expect(upgradeCtaForCause(false)).not.toMatch(/automatically/)
  })
})

describe('clientIpFromHeaders', () => {
  it('prefers x-vercel-forwarded-for over x-forwarded-for', () => {
    const h = new Headers({
      'x-forwarded-for': '1.1.1.1, 2.2.2.2',
      'x-vercel-forwarded-for': '9.9.9.9',
    })
    expect(clientIpFromHeaders(h)).toBe('9.9.9.9')
  })
})

describe('validatePublicDomainInput', () => {
  it('rejects localhost and private hosts', async () => {
    const r = await validatePublicDomainInput('http://localhost/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('private')
  })

  it('rejects IP literals', async () => {
    const r = await validatePublicDomainInput('8.8.8.8')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(['ip_literal', 'private', 'unresolvable']).toContain(r.code)
  })

  it('accepts a resolvable public domain', async () => {
    const r = await validatePublicDomainInput('example.com')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.normalizedUrl).toMatch(/^https:\/\/example\.com/)
      expect(r.domain).toBe('example.com')
    }
  })
})

describe('runPublicIndexDiagnosis robots_blocks_all', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.doUnmock('@/lib/index-diagnosis/crawler')
    vi.doUnmock('@/lib/index-diagnosis/robots-parser')
  })

  it('returns robots_blocks_all when homepage is disallowed', async () => {
    vi.doMock('@/lib/index-diagnosis/crawler', () => ({
      runIndexCrawl: vi.fn(async () => ({
        homepageUrl: 'https://blocked.example/',
        robotsTxt: { raw: 'User-agent: *\nDisallow: /\n', groups: [] },
        fetchedPages: [],
        coverage: {
          domain: 'blocked.example',
          seedUrl: 'https://blocked.example/',
          discoveredCount: 1,
          fetchedCount: 0,
          excluded: [
            {
              url: 'https://blocked.example/',
              reason: 'ROBOTS_DISALLOWED',
              evidence: 'Disallow: /',
            },
          ],
          excludedByReason: {
            ROBOTS_DISALLOWED: 1,
            META_NOINDEX: 0,
            X_ROBOTS_NOINDEX: 0,
            NON_200: 0,
            DEPTH_LIMIT: 0,
            TIMEOUT: 0,
            PLAN_LIMIT: 0,
            REDIRECT_CHAIN: 0,
            NOT_REACHED: 0,
          },
          terminationReason: 'ROBOTS',
          terminationEvidence: 'blocked',
          discoverySources: { sitemap: 0, links: 0, both: 0, seed: 1 },
          sitemapOnlyUrls: [],
          linkedOnlyUrls: [],
          sitemapDiscoveredUrls: [],
          robotsTxtFetched: true,
          robotsTxtEvidence: 'ok',
        },
      })),
    }))
    vi.doMock('@/lib/index-diagnosis/robots-parser', () => ({
      matchRobotsForUrl: () => ({
        allowed: false,
        ruleLine: 'Disallow: /',
        evidence: 'UA * Disallow: /',
      }),
    }))

    const { runPublicIndexDiagnosis } = await import('./run-public')
    const result = await runPublicIndexDiagnosis('https://blocked.example/')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('robots_blocks_all')
      expect(result.message.toLowerCase()).toContain('robots')
    }
  })
})
