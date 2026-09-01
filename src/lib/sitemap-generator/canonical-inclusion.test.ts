import { describe, expect, it } from 'vitest'
import {
  canonicalVariantGroupKey,
  filterPagesForSitemapInclusion,
  pickSitemapRepresentative,
} from './canonical-inclusion'
import type { PageIndexability } from '@/lib/index-diagnosis/types'

function page(url: string, verdict: PageIndexability['verdict'] = 'INDEXABLE'): PageIndexability {
  return {
    url,
    verdict,
    decisiveStep: null,
    decisiveEvidence: verdict,
    steps: [],
    httpStatus: 200,
    crawlDepth: 1,
    internalLinksIn: 1,
    inboundLinks: [],
    duplicateClusterId: null,
    duplicateClusterSize: 1,
    mainContentFingerprint: 'fp',
    pathPattern: '/blog',
    depthBand: '1',
    pageTitle: 'Blog',
    pageH1: 'Blog',
  }
}

describe('canonical-inclusion', () => {
  it('groups /blog and /blog/index.html as one cluster', () => {
    expect(canonicalVariantGroupKey('https://autodun.com/blog')).toBe(
      canonicalVariantGroupKey('https://autodun.com/blog/index.html'),
    )
  })

  it('prefers directory URL over index.html for sitemap representative', () => {
    const kept = pickSitemapRepresentative([
      page('https://autodun.com/blog/index.html'),
      page('https://autodun.com/blog'),
    ])
    expect(kept.url).toBe('https://autodun.com/blog')
  })

  it('excludes /blog/index.html when /blog is also INDEXABLE (autodun fixed canonicals)', () => {
    const blog = page('https://autodun.com/blog')
    blog.steps = [
      {
        step: 'canonical',
        passed: true,
        evidence:
          'Canonical matches this page (equivalent URL): https://autodun.com/blog/index.html',
      },
    ]
    const indexHtml = page('https://autodun.com/blog/index.html')
    indexHtml.steps = [
      {
        step: 'canonical',
        passed: true,
        evidence: 'Canonical self-reference: https://autodun.com/blog/index.html',
      },
    ]

    const { pages, exclusions } = filterPagesForSitemapInclusion([blog, indexHtml])
    expect(pages.map((p) => p.url)).toEqual(['https://autodun.com/blog'])
    expect(exclusions.some((e) => e.url.includes('blog/index.html'))).toBe(true)
  })

  it('includes index.html alone when directory URL is not indexable', () => {
    const indexHtml = page('https://autodun.com/blog/index.html')
    const { pages } = filterPagesForSitemapInclusion([indexHtml])
    expect(pages.map((p) => p.url)).toEqual(['https://autodun.com/blog/index.html'])
  })
})
