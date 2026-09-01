import { describe, expect, it } from 'vitest'
import {
  canonicalUrlsEquivalent,
  expandCanonicalUrlVariants,
  isIndexHtmlCanonicalMisconfiguration,
  parseCanonicalMismatchEvidence,
} from './canonical-equivalence'
import { evaluatePageIndexability } from './indexability'
import type { FetchedPage } from './crawler'

describe('canonical-equivalence', () => {
  it('treats /blog and /blog/index.html as equivalent', () => {
    expect(
      canonicalUrlsEquivalent('https://example.com/blog', 'https://example.com/blog/index.html'),
    ).toBe(true)
    expect(
      canonicalUrlsEquivalent('https://example.com/blog/index.html', 'https://example.com/blog/'),
    ).toBe(true)
  })

  it('does not treat unrelated paths as equivalent', () => {
    expect(
      canonicalUrlsEquivalent('https://example.com/blog', 'https://example.com/news'),
    ).toBe(false)
  })

  it('flags index.html → directory as misconfiguration', () => {
    expect(
      isIndexHtmlCanonicalMisconfiguration(
        'https://autodun.com/blog/index.html',
        'https://autodun.com/blog/',
      ),
    ).toBe(true)
  })

  it('does not flag directory → index.html as misconfiguration', () => {
    expect(
      isIndexHtmlCanonicalMisconfiguration(
        'https://autodun.com/blog',
        'https://autodun.com/blog/index.html',
      ),
    ).toBe(false)
  })

  it('parses mismatch evidence strings', () => {
    const parsed = parseCanonicalMismatchEvidence(
      'Canonical points to different same-host URL: https://autodun.com/blog/ (page https://autodun.com/blog/index.html)',
    )
    expect(parsed).toEqual({
      canonicalUrl: 'https://autodun.com/blog/',
      pageUrl: 'https://autodun.com/blog/index.html',
    })
  })

  it('expands index.html to directory variant', () => {
    const variants = expandCanonicalUrlVariants('https://example.com/blog/index.html')
    expect(variants.has('https://example.com/blog/index.html')).toBe(true)
    expect(variants.has('https://example.com/blog')).toBe(true)
  })
})

describe('indexability canonical (autodun blog)', () => {
  function mockPage(overrides: Partial<FetchedPage> & { url: string; canonicalTags: string[] }): FetchedPage {
    const canon = overrides.canonicalTags[0] || overrides.url
    return {
      finalUrl: overrides.url,
      httpStatus: 200,
      html: `<html><head><link rel="canonical" href="${canon}"></head><body></body></html>`,
      depth: 1,
      redirectCount: 0,
      xRobotsTag: '',
      metaRobots: '',
      canonicalUrl: canon,
      canonicalTags: overrides.canonicalTags,
      pageTitle: 'Blog',
      pageH1: 'Blog',
      fetchError: null,
      timedOut: false,
      ...overrides,
    }
  }

  it('passes /blog when canonical points to /blog/index.html', () => {
    const page = mockPage({
      url: 'https://autodun.com/blog',
      canonicalTags: ['https://autodun.com/blog/index.html'],
    })
    const result = evaluatePageIndexability(page, '', [{ fromUrl: 'https://autodun.com/', fromDepth: 0 }], null, 1, 'text')
    const canon = result.steps.find((s) => s.step === 'canonical')
    expect(canon?.passed).toBe(true)
    expect(canon?.evidence).toContain('equivalent URL')
  })

  it('passes /blog/index.html with self-referencing canonical', () => {
    const page = mockPage({
      url: 'https://autodun.com/blog/index.html',
      canonicalTags: ['https://autodun.com/blog/index.html'],
    })
    const result = evaluatePageIndexability(page, '', [], null, 1, 'text')
    const canon = result.steps.find((s) => s.step === 'canonical')
    expect(canon?.passed).toBe(true)
  })

  it('flags /blog/index.html when canonical points to directory URL', () => {
    const page = mockPage({
      url: 'https://autodun.com/blog/index.html',
      canonicalTags: ['https://autodun.com/blog/'],
    })
    const result = evaluatePageIndexability(page, '', [], null, 1, 'text')
    const canon = result.steps.find((s) => s.step === 'canonical')
    expect(canon?.passed).toBe(false)
    expect(canon?.evidence).toContain('https://autodun.com/blog/')
  })
})
