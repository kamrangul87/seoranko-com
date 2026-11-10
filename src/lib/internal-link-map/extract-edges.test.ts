import { describe, expect, it } from 'vitest'
import {
  AUTODUN_LIKE_HOME_HTML,
  AUTODUN_LIKE_ORIGIN,
  AUTODUN_LIKE_POST_HTML,
} from './autodun-like-html'
import { extractCrawlLinkEdges } from './extract-edges'

const PAGE = 'https://example.com/blog/one'
const ORIGIN = 'https://example.com'

describe('extractCrawlLinkEdges', () => {
  it('extracts internal anchors with text, raw href, and nofollow', () => {
    const html = `
      <nav><a href="/">Home</a></nav>
      <a href="/blog/two" rel="nofollow">Two page</a>
      <a href="https://example.com/about">About us</a>
    `
    const edges = extractCrawlLinkEdges(html, PAGE, ORIGIN)
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUrl: 'https://example.com/blog/one',
          targetUrl: 'https://example.com/',
          hrefRaw: '/',
          anchorText: 'Home',
          isNofollow: false,
        }),
        expect.objectContaining({
          sourceUrl: 'https://example.com/blog/one',
          targetUrl: 'https://example.com/blog/two',
          hrefRaw: '/blog/two',
          anchorText: 'Two page',
          isNofollow: true,
        }),
        expect.objectContaining({
          targetUrl: 'https://example.com/about',
          anchorText: 'About us',
          isNofollow: false,
        }),
      ]),
    )
  })

  it('skips mailto, javascript, hash-only, and external hrefs', () => {
    const html = `
      <a href="mailto:hi@example.com">mail</a>
      <a href="javascript:void(0)">js</a>
      <a href="#section">frag</a>
      <a href="https://other.test/x">external</a>
      <a href="/keep">Keep</a>
    `
    const edges = extractCrawlLinkEdges(html, PAGE, ORIGIN)
    expect(edges).toHaveLength(1)
    expect(edges[0]?.targetUrl).toBe('https://example.com/keep')
  })

  it('skips origin-prefixed external malformations (topic 74)', () => {
    const html = `
      <a href="/https://www.example.org/check">malformed</a>
      <a href="/real">Real</a>
    `
    const edges = extractCrawlLinkEdges(
      html,
      'https://seoranko-fixture.vercel.app/',
      'https://seoranko-fixture.vercel.app',
    )
    expect(edges.map((e) => e.targetUrl)).toEqual([
      'https://seoranko-fixture.vercel.app/real',
    ])
  })

  it('strips fragments and collapses inner-tag whitespace in anchors', () => {
    const html = `<a href="/tools/x#top"><span>  Tool   X  </span></a>`
    const edges = extractCrawlLinkEdges(html, PAGE, ORIGIN)
    expect(edges).toHaveLength(1)
    expect(edges[0]?.targetUrl).toBe('https://example.com/tools/x')
    expect(edges[0]?.anchorText).toBe('Tool X')
  })

  it('extracts autodun-like relative nav and .html blog URLs, skipping tool subdomains', () => {
    const edges = extractCrawlLinkEdges(
      AUTODUN_LIKE_HOME_HTML,
      `${AUTODUN_LIKE_ORIGIN}/`,
      AUTODUN_LIKE_ORIGIN,
    )
    const targets = edges.map((e) => e.targetUrl).sort()
    expect(targets).toEqual([
      'https://autodun.com/about',
      'https://autodun.com/blog',
      'https://autodun.com/blog/electric-car-charger-map-uk.html',
      'https://autodun.com/blog/mot-cost-uk-2026.html',
      'https://autodun.com/blog/mot-history-check-uk.html',
      'https://autodun.com/contact',
      'https://autodun.com/privacy',
    ])
    expect(targets.some((t) => t.includes('ev.autodun.com'))).toBe(false)
    expect(targets.some((t) => t.includes('mot.autodun.com'))).toBe(false)
    expect(edges.find((e) => e.targetUrl.endsWith('/about'))?.anchorText).toBe(
      'About Autodun',
    )
  })

  it('treats www and apex as the same site so clean-URL blog pages keep autodun links', () => {
    const edges = extractCrawlLinkEdges(
      AUTODUN_LIKE_POST_HTML,
      `${AUTODUN_LIKE_ORIGIN}/blog/mot-cost-uk-2026.html`,
      AUTODUN_LIKE_ORIGIN,
    )
    const targets = edges.map((e) => e.targetUrl)
    expect(targets).toContain('https://autodun.com/')
    expect(targets).toContain('https://autodun.com/blog')
    expect(targets).toContain('https://autodun.com/blog/mot-history-check-uk.html')
    expect(targets).toContain('https://autodun.com/about')
  })
})
