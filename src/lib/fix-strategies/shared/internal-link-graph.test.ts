import { describe, expect, it } from 'vitest'
import {
  buildInternalLinkGraph,
  extractPageLinkSignals,
} from './internal-link-graph'
import { detectCrawlDepth } from '@/lib/fix-strategies/topic-45'

const ORIGIN = 'https://seoranko-fixture.vercel.app'

describe('topic 74 malformed hrefs excluded from link graph / depth metrics', () => {
  it('extractPageLinkSignals skips origin-prefixed external hrefs', () => {
    const html = `
      <a href="/about.html">About</a>
      <a href="/https://www.gov.uk/check-mot-history">MOT</a>
      <a href=“/https://www.gov.uk/getting-an-mot”>curly</a>
    `
    const signals = extractPageLinkSignals(html, `${ORIGIN}/`)
    const norms = signals.crawlable.map((c) => c.normalized)
    expect(norms.some((u) => u.includes('/about.html'))).toBe(true)
    expect(norms.every((u) => !/\/https?:\/\//i.test(u))).toBe(true)
    expect(norms.every((u) => !/%E2%80%9C/i.test(u))).toBe(true)
  })

  it('topic 45 does not emit metric-click-depth for origin-prefixed URLs', () => {
    const homeHtml = `
      <a href="/about.html">About</a>
      <a href="/https://www.gov.uk/check-mot-history">MOT</a>
    `
    const aboutHtml = `<a href="/">Home</a>`
    const graph = buildInternalLinkGraph({
      originUrl: ORIGIN,
      homepageUrl: `${ORIGIN}/`,
      pages: [
        { url: `${ORIGIN}/`, html: homeHtml, status: 200 },
        { url: `${ORIGIN}/about.html`, html: aboutHtml, status: 200 },
      ],
    })
    const depth = detectCrawlDepth({ graph })
    const pages = [...depth.metrics, ...depth.findings].map((f) => f.pageUrl)
    expect(pages.every((u) => !/\/https?:\/\//i.test(u))).toBe(true)
    expect(
      graph.nodes.every((n) => !/\/https?:\/\//i.test(n.urlNormalized)),
    ).toBe(true)
  })
})
