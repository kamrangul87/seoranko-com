/**
 * CI rule: every at-risk / actionable Diagnostics signal must map to an Audit
 * finding that Fix my site can count (auto-fixable or honestly labelled).
 *
 * Seed: autodun /privacy → homepage canonical (fixture privacy.html + topic 14).
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { detectCanonicalTargetNot200 } from '@/lib/fix-strategies/topic-14'
import { classifyVerdictBucket, classifySurfaceClass } from './buckets'
import { isTransformRegistered } from './fix-run/apply-registry'
import { detectMissingOutboundInternalLinks } from '@/lib/fix-strategies/related-articles/detect'

const FIXTURE_PRIVACY = join(
  process.cwd(),
  'fixtures/seoranko-fixture-site/privacy.html',
)

describe('diagnostics ↔ audit parity', () => {
  it('fixture privacy.html wrong-elsewhere canonical is topic 14 auto-self-canonical', async () => {
    const body = readFileSync(FIXTURE_PRIVACY, 'utf8')
    expect(body).toMatch(/rel=["']canonical["'][^>]*href=["']\/["']/)

    const fetchMock = vi.fn(async () =>
      new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const origin = 'https://seoranko-fixture.vercel.app'
    const result = await detectCanonicalTargetNot200(
      [
        {
          url: `${origin}/privacy.html`,
          body,
          pageReturns200: true,
          repoSiteKind: 'page',
        },
      ],
      {
        deps: { fetch: fetchMock as unknown as typeof fetch },
        siteOrigin: origin,
      },
    )
    const f = result.findings[0]
    expect(f?.verdict).toBe('auto-self-canonical')
    expect(classifyVerdictBucket(f!.verdict)).toBe('actionable')
    expect(
      classifySurfaceClass(f!.verdict, { autoFixable: true }),
    ).toBe('auto-fixable')
    expect(isTransformRegistered('14', 'auto-self-canonical')).toBe(true)
  })

  it('crawled-not-indexed is informational (not Audit actionable)', async () => {
    const { detectCrawledNotIndexed } = await import(
      '@/lib/fix-strategies/topic-57'
    )
    const r = detectCrawledNotIndexed({
      gsc: {
        siteId: 's',
        propertyUrl: 'sc-domain:example.com',
        connectionStatus: 'active',
        inspections: [
          {
            url: 'https://example.com/x',
            urlNormalized: 'https://example.com/x',
            coverageState: 'Crawled - currently not indexed',
            indexingState: null,
            googleCanonical: null,
            userCanonical: null,
            canonicalMismatch: false,
            lastCrawlTime: '2026-01-01',
            inspectedAt: '2026-01-02',
          },
        ],
        inspectionsByUrl: new Map(),
        metrics: [],
        metricsByUrl: new Map(),
        inspectionCoveragePartial: true,
        inspectionRowCount: 1,
      },
    })
    expect(r.findings[0]?.verdict).toBe('informational-crawled-not-indexed')
    expect(classifyVerdictBucket(r.findings[0]!.verdict)).toBe('informational')
  })

  it('related-articles and nav-link transforms are registered (approval fixes)', () => {
    expect(isTransformRegistered('43', 'auto-add-nav-link')).toBe(true)
    expect(isTransformRegistered('related', 'auto-add-related-articles')).toBe(
      true,
    )
  })

  it('detects missing outbound links on blog siblings', () => {
    const r = detectMissingOutboundInternalLinks({
      pages: [
        {
          url: 'https://example.com/blog/a.html',
          html: '<html><body><p>no links</p></body></html>',
          title: 'A',
          h1: 'A',
        },
        {
          url: 'https://example.com/blog/b.html',
          html: '<html><body><p>no links</p></body></html>',
          title: 'B',
          h1: 'B',
        },
        {
          url: 'https://example.com/blog/c.html',
          html: '<html><body><p>no links</p></body></html>',
          title: 'C',
          h1: 'C',
        },
      ],
    })
    expect(r.findings.length).toBeGreaterThanOrEqual(1)
    expect(r.findings[0]?.verdict).toBe('auto-add-related-articles')
    expect(r.findings[0]?.relatedTargets.length).toBeGreaterThanOrEqual(1)
  })
})
