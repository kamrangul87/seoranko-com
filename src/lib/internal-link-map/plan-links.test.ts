import { describe, expect, it } from 'vitest'
import { extractPageSignals } from './page-signals'
import {
  planSitewideInternalLinks,
  type PlanPageInput,
} from './plan-links'
import type { CrawlLinkEdge } from './types'

const ORIGIN = 'https://example.com'

function page(
  path: string,
  extra: Partial<PlanPageInput> & { title?: string; h1?: string } = {},
): PlanPageInput {
  const url = `${ORIGIN}${path}`
  const title = extra.title ?? extra.h1 ?? path.replace(/[-_/]+/g, ' ').trim()
  const h1 = extra.h1 ?? title
  return {
    url,
    finalUrl: extra.finalUrl ?? url,
    httpStatus: extra.httpStatus ?? 200,
    jobStatus: extra.jobStatus ?? 'crawled',
    title,
    h1,
    text: extra.text ?? `${title} ${h1}`,
    noindex: extra.noindex ?? false,
  }
}

function edge(sourcePath: string, targetPath: string): CrawlLinkEdge {
  return {
    sourceUrl: `${ORIGIN}${sourcePath}`,
    targetUrl: `${ORIGIN}${targetPath}`,
    hrefRaw: targetPath,
    anchorText: 'existing',
    isNofollow: false,
    targetHttpStatus: 200,
    targetFinalUrl: `${ORIGIN}${targetPath}`,
    isRedirect: false,
  }
}

describe('extractPageSignals', () => {
  it('reads title, h1, noindex, and stripped text from HTML', () => {
    const s = extractPageSignals(
      `<html><head><title> MOT Cost UK </title><meta name="robots" content="noindex,follow"></head><body><h1>MOT cost in the UK</h1><p>A <b>guide</b> for drivers.</p></body></html>`,
    )
    expect(s.title).toBe('MOT Cost UK')
    expect(s.h1).toBe('MOT cost in the UK')
    expect(s.noindex).toBe(true)
    expect(s.text).toMatch(/guide for drivers/i)
  })
})

describe('planSitewideInternalLinks', () => {
  const pages: PlanPageInput[] = [
    page('/'),
    page('/blog', { title: 'Blog', h1: 'Blog' }),
    page('/blog/mot-cost-uk-2026.html', {
      title: 'MOT Cost in the UK 2026',
      h1: 'MOT Cost in the UK 2026',
      text: 'MOT test fee UK 2026 garage',
    }),
    page('/blog/mot-history-check-uk.html', {
      title: 'MOT History Check UK',
      h1: 'MOT History Check UK',
      text: 'MOT history check vehicle lookup',
    }),
    page('/blog/ev-charging-reliability-uk.html', {
      title: 'EV Charging Reliability UK',
      h1: 'EV Charging Reliability UK',
      text: 'EV chargepoint uptime motorway',
    }),
    page('/about', { title: 'About Autodun', h1: 'About Autodun' }),
    page('/contact', { title: 'Contact', h1: 'Contact Autodun' }),
    page('/gone', { httpStatus: 404, jobStatus: 'failed', title: 'Gone' }),
    page('/old', {
      httpStatus: 301,
      finalUrl: `${ORIGIN}/about`,
      title: 'Old about',
    }),
    page('/draft', {
      title: 'Draft notes',
      h1: 'Draft notes',
      noindex: true,
    }),
  ]

  it('clusters by path, names hubs, and links hub to spokes and spokes back', () => {
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages,
      edges: [edge('/', '/blog')],
    })
    const blogHub = plan.clusters.find((c) => c.id === 'blog')
    expect(blogHub?.hubUrl).toBe(`${ORIGIN}/blog`)
    expect(blogHub?.memberUrls).toEqual(
      expect.arrayContaining([
        `${ORIGIN}/blog/mot-cost-uk-2026.html`,
        `${ORIGIN}/blog/mot-history-check-uk.html`,
      ]),
    )

    const hubToSpoke = plan.links.find(
      (l) =>
        l.sourceUrl === `${ORIGIN}/blog` &&
        l.targetUrl === `${ORIGIN}/blog/mot-cost-uk-2026.html`,
    )
    expect(hubToSpoke?.kind).toBe('hub-to-spoke')
    expect(hubToSpoke?.anchorText).toBe('MOT Cost in the UK 2026')
    expect(hubToSpoke?.reason).toMatch(/hub/i)

    const spokeToHub = plan.links.find(
      (l) =>
        l.sourceUrl === `${ORIGIN}/blog/mot-cost-uk-2026.html` &&
        l.targetUrl === `${ORIGIN}/blog`,
    )
    expect(spokeToHub?.kind).toBe('spoke-to-hub')
    expect(spokeToHub?.anchorText).toBe('Blog')
  })

  it('skips noindex, redirecting, and broken targets and never links a page to itself', () => {
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages,
      edges: [],
    })
    const targets = plan.links.map((l) => l.targetUrl)
    expect(targets).not.toContain(`${ORIGIN}/gone`)
    expect(targets).not.toContain(`${ORIGIN}/old`)
    expect(targets).not.toContain(`${ORIGIN}/draft`)
    expect(plan.links.every((l) => l.sourceUrl !== l.targetUrl)).toBe(true)
  })

  it('does not re-add a link that already exists', () => {
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages,
      edges: [edge('/', '/blog')],
    })
    expect(
      plan.links.some(
        (l) => l.sourceUrl === `${ORIGIN}/` && l.targetUrl === `${ORIGIN}/blog`,
      ),
    ).toBe(false)
  })

  it('gives every remaining orphan at least two inbound planned or existing links', () => {
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        page('/'),
        page('/lonely-a', { title: 'Lonely A', h1: 'Lonely A guide' }),
        page('/lonely-b', { title: 'Lonely B', h1: 'Lonely B notes' }),
      ],
      edges: [],
    })
    for (const url of [`${ORIGIN}/lonely-a`, `${ORIGIN}/lonely-b`]) {
      const inbound =
        plan.links.filter((l) => l.targetUrl === url).length
      expect(inbound).toBeGreaterThanOrEqual(2)
    }
  })

  it('caps new links per source page at 5 and varies repeated exact-match anchors', () => {
    const many = [
      page('/'),
      page('/blog', { title: 'Blog', h1: 'Blog' }),
      ...Array.from({ length: 12 }, (_, i) =>
        page(`/blog/post-${i}.html`, {
          title: 'Exact Match Keyword',
          h1: 'Exact Match Keyword',
        }),
      ),
    ]
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: many,
      edges: [],
      maxNewLinksPerSource: 5,
    })
    const bySource = new Map<string, number>()
    for (const l of plan.links) {
      bySource.set(l.sourceUrl, (bySource.get(l.sourceUrl) ?? 0) + 1)
    }
    for (const n of bySource.values()) {
      expect(n).toBeLessThanOrEqual(5)
    }
    expect(plan.links.every((l) => l.anchorText.trim().length > 0)).toBe(true)
    expect(plan.links.every((l) => !l.anchorText.trim().endsWith(':'))).toBe(true)
    expect(plan.links.some((l) => /click here|read more/i.test(l.anchorText))).toBe(
      false,
    )
  })

  it('adds a hub or home shortcut so a 4-click page can sit within 3 clicks', () => {
    const chain = [
      page('/'),
      page('/d1', { title: 'D1', h1: 'Section one' }),
      page('/d1/d2', { title: 'D2', h1: 'Section two' }),
      page('/d1/d2/d3', { title: 'D3', h1: 'Section three' }),
      page('/d1/d2/d3/d4', { title: 'Deep page', h1: 'Deep page title' }),
    ]
    const existing: CrawlLinkEdge[] = [
      edge('/', '/d1'),
      edge('/d1', '/d1/d2'),
      edge('/d1/d2', '/d1/d2/d3'),
      edge('/d1/d2/d3', '/d1/d2/d3/d4'),
    ]
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: chain,
      edges: existing,
    })
    const deep = `${ORIGIN}/d1/d2/d3/d4`
    const shortcut = plan.links.find(
      (l) =>
        l.targetUrl === deep &&
        (l.sourceUrl === `${ORIGIN}/` || l.sourceUrl === `${ORIGIN}/d1`),
    )
    expect(shortcut).toBeTruthy()
    expect(shortcut?.kind).toBe('depth-shortcut')
    expect(shortcut?.anchorText).toBe('Deep page title')
  })

  // Default Vitest 5s timeout is the CI budget. The 2000-page empty-edge
  // case must stay Hobby-safe — do not raise this timeout to hide O(n²) scans.
  it('is deterministic and stays within a 2000-page cap', () => {
    const pages2k = [
      page('/'),
      ...Array.from({ length: 12 }, (_, i) =>
        page(`/blog/p-${i}`, { title: `Post ${i}`, h1: `Post ${i}` }),
      ),
    ]
    const a = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: pages2k,
      edges: [],
    })
    const b = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: pages2k,
      edges: [],
    })
    expect(a.links.map((l) => l.id)).toEqual(b.links.map((l) => l.id))
    const huge = [
      page('/'),
      ...Array.from({ length: 2010 }, (_, i) =>
        page(`/p/${i}`, { title: `P${i}`, h1: `P${i}` }),
      ),
    ]
    const capped = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: huge,
      edges: [],
      maxPages: 2000,
    })
    const plannedUrls = new Set(capped.links.flatMap((l) => [l.sourceUrl, l.targetUrl]))
    expect(plannedUrls.size).toBeLessThanOrEqual(2000)
  })

  it('uses a clean H1/title anchor, not a 2-word or colon-truncated slice', () => {
    const autodun: PlanPageInput[] = [
      page('/'),
      page('/blog/mot-history-check-uk.html', {
        title: 'Free MOT History Check UK: How to Use the DVSA Service',
        h1: 'How to check a vehicle’s MOT history in the UK (free DVSA MOT check)',
        text: 'MOT history check vehicle lookup garage',
      }),
      page('/blog/mot-changes-2026-dvsa-updates.html', {
        title:
          'MOT Changes 2026 – DVSA Updates, New Rules & What UK Drivers Need to Know | Autodun',
        h1: 'MOT Changes 2026: DVSA Updates, New Rules & What UK Drivers Need to Know',
        text: 'MOT changes 2026 DVSA updates new rules drivers',
      }),
      page('/blog/ev-charging-reliability-uk.html', {
        title:
          'EV Charging Reliability UK: What the 99% Rule Covers — and What It Doesn’t',
        h1: 'EV charging reliability in the UK: what the 99% rule covers — and what it doesn’t',
        text: 'EV chargepoint uptime motorway reliability',
      }),
    ]
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: autodun,
      edges: [],
    })
    const toMotChanges = plan.links.find(
      (l) => l.targetUrl === `${ORIGIN}/blog/mot-changes-2026-dvsa-updates.html`,
    )
    const toEv = plan.links.find(
      (l) => l.targetUrl === `${ORIGIN}/blog/ev-charging-reliability-uk.html`,
    )
    expect(toMotChanges?.anchorText).not.toBe('MOT Changes 2026:')
    expect(toMotChanges?.anchorText.endsWith(':')).toBe(false)
    expect(toMotChanges?.anchorText).toMatch(/MOT Changes 2026/i)
    expect(toMotChanges?.anchorText).not.toMatch(/Autodun/i)
    expect(toEv?.anchorText).not.toBe('EV charging')
    expect(toEv?.anchorText.toLowerCase()).toMatch(/ev charging reliability/)
  })

  it('does not suggest EV charging on UK motorways → MOT cost UK 2026', () => {
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        page('/'),
        page('/blog', { title: 'Blog', h1: 'Blog' }),
        page('/blog/ev-charging-on-uk-motorways.html', {
          title: 'EV charging on UK motorways',
          h1: 'EV charging on UK motorways',
          text: 'Electric vehicle charge points along motorway services. RAPID CCS Tesla Supercharger queues.',
        }),
        page('/blog/mot-cost-uk-2026.html', {
          title: 'MOT cost UK 2026',
          h1: 'MOT cost UK 2026',
          text: 'MOT test fee for cars in 2026. DVSA class 4 garage prices and retest charges.',
        }),
        page('/blog/mot-history-check-uk.html', {
          title: 'How to check a vehicle MOT history in the UK',
          h1: 'How to check a vehicle MOT history in the UK',
          text: 'Look up MOT history and mileage on the DVSA service. Free vehicle test records.',
        }),
      ],
      edges: [],
    })
    const bad = plan.links.filter(
      (l) =>
        (l.sourceUrl.includes('ev-charging-on-uk-motorways') &&
          l.targetUrl.includes('mot-cost-uk-2026')) ||
        (l.sourceUrl.includes('mot-cost-uk-2026') &&
          l.targetUrl.includes('ev-charging-on-uk-motorways')),
    )
    expect(bad).toEqual([])
    const motToMot = plan.links.find(
      (l) =>
        l.sourceUrl.includes('mot-cost-uk-2026') &&
        l.targetUrl.includes('mot-history-check-uk'),
    )
    expect(motToMot).toBeTruthy()
    expect(motToMot?.score).toBeGreaterThan(0.28)
    expect(motToMot?.reason.toLowerCase()).toMatch(/mot/)
    expect(plan.links.every((l) => typeof l.score === 'number')).toBe(true)
    expect(plan.links.every((l) => l.reason.trim().length > 0)).toBe(true)
  })

  it('uses path-form hrefs the related-articles transform can write', () => {
    const plan = planSitewideInternalLinks({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [page('/'), page('/about', { title: 'About Autodun', h1: 'About Autodun' })],
      edges: [],
    })
    const toAbout = plan.links.find((l) => l.targetUrl === `${ORIGIN}/about`)
    expect(toAbout?.href).toBe('/about')
  })
})
