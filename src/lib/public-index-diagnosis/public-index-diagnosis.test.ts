import { describe, expect, it } from 'vitest'
import {
  explainPublicCause,
  PUBLIC_REASON_AUTO_FIXABLE,
  upgradeCtaForCause,
} from './explanations'
import { PUBLIC_EXCLUSION_REASONS } from './types'
import { clientIpFromHeaders, validatePublicDomainInput } from './validate-domain'
import {
  PUBLIC_SCAN_DEADLINE_MS,
  PUBLIC_SCAN_MAX_DISCOVERED,
  PUBLIC_SCAN_MAX_FETCHED,
  PUBLIC_SCAN_RATE_LIMIT_PER_HOUR,
} from './rate-limit'

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

describe('public Index Diagnosis containment caps', () => {
  it('keeps a tight per-IP rate and crawl page budget', () => {
    expect(PUBLIC_SCAN_RATE_LIMIT_PER_HOUR).toBeLessThanOrEqual(2)
    expect(PUBLIC_SCAN_MAX_DISCOVERED).toBeLessThanOrEqual(50)
    expect(PUBLIC_SCAN_MAX_FETCHED).toBeLessThanOrEqual(50)
    expect(PUBLIC_SCAN_DEADLINE_MS).toBeLessThanOrEqual(30_000)
  })
})

describe('runPublicIndexDiagnosis robots_blocks_all', () => {
  it('exposes robots_blocks_all as a public failure code', async () => {
    const mod = await import('./run-public')
    expect(typeof mod.runPublicIndexDiagnosis).toBe('function')
    const sample: import('./run-public').PublicScanFailure = {
      ok: false,
      code: 'robots_blocks_all',
      message: 'robots.txt blocks crawling the homepage',
    }
    expect(sample.code).toBe('robots_blocks_all')
  })
})
