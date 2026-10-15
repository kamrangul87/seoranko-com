import { describe, expect, it } from 'vitest'
import type { FetchedPage } from '@/lib/index-diagnosis/crawler'
import type { PublicUrlEvidence } from './types'
import { buildPublicFixPreviews } from './fix-preview'

function page(over: Partial<FetchedPage> & { finalUrl: string }): FetchedPage {
  const finalUrl = over.finalUrl
  const base: FetchedPage = {
    url: finalUrl,
    finalUrl,
    httpStatus: 200,
    html: '<html><head></head><body></body></html>',
    depth: 0,
    redirectCount: 0,
    xRobotsTag: '',
    metaRobots: '',
    canonicalUrl: finalUrl,
    canonicalTags: [finalUrl],
    pageTitle: '',
    pageH1: '',
    fetchError: null,
    timedOut: false,
  }
  return { ...base, ...over, finalUrl, url: over.url ?? finalUrl }
}

function evidence(
  over: Partial<PublicUrlEvidence> & {
    url: string
    reason: PublicUrlEvidence['reason']
  },
): PublicUrlEvidence {
  return {
    httpStatus: 200,
    robotsRuleLine: null,
    metaRobots: null,
    xRobotsTag: null,
    canonicalTarget: null,
    canonicalIsSelf: null,
    crawlDepth: 0,
    internalInlinkCount: 1,
    mainContentWordCount: 100,
    nearDuplicateSimilarity: null,
    soft404Signals: [],
    evidenceNotes: '',
    ...over,
  }
}

describe('buildPublicFixPreviews', () => {
  it('builds a canonical before/after HTML preview (self-referencing href)', () => {
    const url = 'https://example.com/old-path'
    const html = `<html><head>
<link rel="canonical" href="https://example.com/new-path">
<title>Old</title>
</head><body><p>content</p></body></html>`
    const previews = buildPublicFixPreviews({
      urls: [
        evidence({
          url,
          reason: 'CANONICAL_POINTS_ELSEWHERE',
          canonicalTarget: 'https://example.com/new-path',
          canonicalIsSelf: false,
        }),
      ],
      fetchedPages: [
        page({
          finalUrl: url,
          html,
          canonicalUrl: 'https://example.com/new-path',
          canonicalTags: ['https://example.com/new-path'],
        }),
      ],
      max: 2,
    })
    expect(previews).toHaveLength(1)
    const p = previews[0]!
    expect(p.reason).toBe('CANONICAL_POINTS_ELSEWHERE')
    expect(p.exampleUrl).toBe(url)
    expect(p.autoFixable).toBe(true)
    expect(p.beforeHtml).toContain('rel="canonical"')
    expect(p.beforeHtml).toContain('https://example.com/new-path')
    expect(p.afterHtml).toContain('rel="canonical"')
    expect(p.afterHtml).toContain(url)
    expect(p.afterHtml).not.toContain('https://example.com/new-path')
    expect(p.changeSummary.toLowerCase()).toMatch(/canonical/)
    // Never claim this is a code diff
    expect(JSON.stringify(p).toLowerCase()).not.toMatch(/\bdiff\b/)
  })

  it('builds a noindex meta before/after HTML preview', () => {
    const url = 'https://example.com/hidden'
    const html =
      '<html><head><meta name="robots" content="noindex, follow"><title>Hidden</title></head><body><p>hi</p></body></html>'
    const previews = buildPublicFixPreviews({
      urls: [
        evidence({
          url,
          reason: 'NOINDEX_TAG',
          metaRobots: 'noindex, follow',
        }),
      ],
      fetchedPages: [page({ finalUrl: url, html, metaRobots: 'noindex, follow' })],
      max: 2,
    })
    expect(previews).toHaveLength(1)
    const p = previews[0]!
    expect(p.beforeHtml.toLowerCase()).toContain('noindex')
    expect(p.afterHtml.toLowerCase()).not.toContain('noindex')
    expect(p.afterHtml.toLowerCase()).toMatch(/robots/)
    expect(p.autoFixable).toBe(false)
  })

  it('prefers auto-fixable causes and caps at max', () => {
    const canonUrl = 'https://example.com/a'
    const thinUrl = 'https://example.com/thin'
    const noindexUrl = 'https://example.com/n'
    const previews = buildPublicFixPreviews({
      urls: [
        evidence({ url: thinUrl, reason: 'THIN_CONTENT' }),
        evidence({
          url: canonUrl,
          reason: 'CANONICAL_POINTS_ELSEWHERE',
          canonicalTarget: 'https://example.com/b',
          canonicalIsSelf: false,
        }),
        evidence({
          url: noindexUrl,
          reason: 'NOINDEX_TAG',
          metaRobots: 'noindex',
        }),
      ],
      fetchedPages: [
        page({
          finalUrl: canonUrl,
          html: '<html><head><link rel="canonical" href="https://example.com/b"></head><body></body></html>',
          canonicalTags: ['https://example.com/b'],
        }),
        page({
          finalUrl: noindexUrl,
          html: '<html><head><meta name="robots" content="noindex"></head><body></body></html>',
          metaRobots: 'noindex',
        }),
        page({
          finalUrl: thinUrl,
          html: '<html><head><title>t</title></head><body><p>hi</p></body></html>',
        }),
      ],
      max: 2,
    })
    expect(previews.length).toBeLessThanOrEqual(2)
    expect(previews[0]?.reason).toBe('CANONICAL_POINTS_ELSEWHERE')
    expect(previews.map((x) => x.reason)).not.toContain('THIN_CONTENT')
  })

  it('returns empty when no previewable HTML evidence exists', () => {
    const previews = buildPublicFixPreviews({
      urls: [
        evidence({
          url: 'https://example.com/gone',
          reason: 'HTTP_4XX',
          httpStatus: 404,
        }),
      ],
      fetchedPages: [],
      max: 2,
    })
    expect(previews).toEqual([])
  })
})
