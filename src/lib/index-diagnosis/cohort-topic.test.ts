import { describe, expect, it } from 'vitest'
import { buildDuplicateCohortBriefContext, pagesInCohort } from './cohort-topic'
import { applyDuplicateCohortToBrief } from './duplicate-cohort-brief'
import type { PageIndexability } from './types'

function mockPage(url: string, title: string, pathPattern: string): PageIndexability {
  return {
    url,
    verdict: 'AT_RISK',
    decisiveStep: 'duplicate_cluster',
    decisiveEvidence: 'dup',
    steps: [],
    httpStatus: 200,
    crawlDepth: 2,
    internalLinksIn: 1,
    inboundLinks: [],
    duplicateClusterId: 'dup-1',
    duplicateClusterSize: 3,
    mainContentFingerprint: 'fp',
    pathPattern,
    depthBand: '2',
    pageTitle: title,
    pageH1: title,
  }
}

describe('cohort-topic', () => {
  it('matches cohort pages by path pattern id, not label prefix', () => {
    const pages = [
      mockPage('https://autodun.com/blog/mot-history-check-uk.html', 'MOT History Check UK', '/blog/:slug.html'),
      mockPage('https://autodun.com/blog/electric-car-charger-map-uk.html', 'Electric Car Charger Map UK', '/blog/:slug.html'),
    ]
    const matched = pagesInCohort(pages, 'path:/blog/:slug.html', 'Path /blog/:slug.html')
    expect(matched).toHaveLength(2)
  })

  it('derives UK EV shared topic from real blog URLs — not the path pattern', () => {
    const pages = [
      mockPage('https://autodun.com/blog/mot-history-check-uk.html', 'MOT History Check UK', '/blog/:slug.html'),
      mockPage('https://autodun.com/blog/electric-car-charger-map-uk.html', 'Electric Car Charger Map UK', '/blog/:slug.html'),
      mockPage(
        'https://autodun.com/blog/why-uk-councils-are-flying-blind-on-ev-charging-infrastructure.html',
        'Why UK Councils Are Flying Blind on EV Charging',
        '/blog/:slug.html',
      ),
    ]
    const ctx = buildDuplicateCohortBriefContext(
      'path:/blog/:slug.html',
      'Path /blog/:slug.html',
      '33% duplicate density',
      pages,
      0.33,
    )
    expect(ctx.sharedTopic).toMatch(/UK/i)
    expect(ctx.sharedTopic).not.toMatch(/Path \//)
    expect(ctx.suggestedBriefTitle).toMatch(/Differentiating/i)
    expect(ctx.pageSummaries).toHaveLength(3)
    expect(ctx.sharedTopic).not.toContain(':slug')
  })

  it('applyDuplicateCohortToBrief uses shared topic as seed and names each URL', () => {
    const pages = [
      mockPage('https://autodun.com/blog/mot-history-check-uk.html', 'MOT History Check UK', '/blog/:slug.html'),
      mockPage('https://autodun.com/blog/electric-car-charger-map-uk.html', 'Electric Car Charger Map UK', '/blog/:slug.html'),
    ]
    const ctx = buildDuplicateCohortBriefContext(
      'path:/blog/:slug.html',
      'Path /blog/:slug.html',
      'evidence',
      pages,
      0.33,
    )
    const brief = applyDuplicateCohortToBrief(
      {
        mode: 'content',
        seedKeyword: 'wrong',
        suggestedTitle: 'Path /blog/:slug.html means in practice',
        intent: 'informational',
        strategistNotes: [],
        sections: [],
        strippedInventedClaims: false,
      },
      ctx,
    )
    expect(brief.seedKeyword).toBe(ctx.sharedTopic)
    expect(brief.suggestedTitle).toBe(ctx.suggestedBriefTitle)
    expect(brief.sections.some((s) => s.guidance.includes('mot-history-check-uk.html'))).toBe(true)
    expect(brief.sections.some((s) => /Path \//i.test(s.heading))).toBe(false)
  })
})
