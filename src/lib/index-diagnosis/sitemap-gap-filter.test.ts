import { describe, expect, it } from 'vitest'
import {
  filterLinkedOnlyUrls,
  sitemapGapExcludeReason,
  shouldFlagAsMissingFromSitemap,
} from './sitemap-gap-filter'
import type { FetchedPage } from './crawler'
import type { PageIndexability } from './types'

const sitemapUrls = [
  'https://autodun.com/',
  'https://autodun.com/blog',
  'https://mot.autodun.com/',
]

function page(overrides: Partial<PageIndexability> & { url: string }): PageIndexability {
  return {
    verdict: 'INDEXABLE',
    decisiveStep: null,
    decisiveEvidence: '',
    steps: [],
    httpStatus: 200,
    crawlDepth: 1,
    internalLinksIn: 1,
    inboundLinks: [],
    duplicateClusterId: null,
    duplicateClusterSize: 1,
    mainContentFingerprint: 'fp',
    pathPattern: '/',
    depthBand: '1',
    pageTitle: '',
    pageH1: '',
    ...overrides,
  }
}

describe('sitemap-gap-filter', () => {
  const baseCtx = {
    sitemapUrls,
    excluded: [
      { url: 'https://autodun.com/charging-map', reason: 'NON_200' as const, evidence: 'HTTP 404' },
      { url: 'https://autodun.com/privacy', reason: 'NON_200' as const, evidence: 'HTTP 404' },
    ],
    fetchedPages: [
      {
        url: 'https://autodun.com/mot-predictor',
        finalUrl: 'https://mot.autodun.com/',
        redirectCount: 1,
        httpStatus: 200,
        html: '',
        depth: 1,
        canonicalTags: [],
      } as FetchedPage,
      {
        url: 'https://autodun.com/blog/index.html',
        finalUrl: 'https://autodun.com/blog/index.html',
        redirectCount: 0,
        httpStatus: 200,
        html: '<link rel="canonical" href="https://autodun.com/blog/">',
        depth: 2,
        canonicalUrl: 'https://autodun.com/blog/',
        canonicalTags: ['https://autodun.com/blog/'],
      } as FetchedPage,
    ],
    pages: [
      page({
        url: 'https://autodun.com/blog/index.html',
        verdict: 'AT_RISK',
        steps: [
          {
            step: 'canonical',
            passed: false,
            evidence:
              'Canonical points to different same-host URL: https://autodun.com/blog/ (page https://autodun.com/blog/index.html)',
          },
        ],
      }),
    ],
  }

  it('excludes non-200 URLs from missing-from-sitemap', () => {
    expect(sitemapGapExcludeReason('https://autodun.com/privacy', baseCtx)).toBe('non_200')
    expect(shouldFlagAsMissingFromSitemap('https://autodun.com/charging-map', baseCtx)).toBe(false)
  })

  it('excludes redirect aliases when destination is in sitemap', () => {
    expect(sitemapGapExcludeReason('https://autodun.com/mot-predictor', baseCtx)).toBe(
      'redirect_target_in_sitemap',
    )
  })

  it('excludes canonical duplicates when target is in sitemap', () => {
    expect(sitemapGapExcludeReason('https://autodun.com/blog/index.html', baseCtx)).toBe(
      'canonical_duplicate_in_sitemap',
    )
  })

  it('filters autodun false-positive quartet from linkedOnlyUrls', () => {
    const raw = [
      'https://autodun.com/mot-predictor',
      'https://autodun.com/charging-map',
      'https://autodun.com/blog/index.html',
      'https://autodun.com/privacy',
      'https://autodun.com/genuinely-missing',
    ]
    const filtered = filterLinkedOnlyUrls(raw, baseCtx)
    expect(filtered).toEqual(['https://autodun.com/genuinely-missing'])
  })
})
