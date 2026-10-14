import { describe, expect, it } from 'vitest'
import { countCrawlableAnchors } from './count-crawlable-anchors'
import { detectZeroRawCrawlableAnchors } from './detect'

/** Minimal autodun-like SPA shell: meta + root, zero <a href>. */
const AUTODUN_RAW = `<!doctype html>
<html lang="en"><head>
<link rel="canonical" href="https://autodun.com" />
<link rel="stylesheet" href="/assets/index.css" />
</head><body><div id="root"></div>
<script type="module" src="/assets/index.js"></script>
</body></html>`

const RENDERED_WITH_LINKS = `<html><body>
<a href="/blog">Blog</a>
<a href="/about">About</a>
<a href="https://ev.autodun.com">EV</a>
</body></html>`

describe('topic 73 zero raw crawlable anchors', () => {
  it('counts zero crawlable anchors in autodun-like raw shell', () => {
    expect(countCrawlableAnchors(AUTODUN_RAW)).toBe(0)
    expect(countCrawlableAnchors(RENDERED_WITH_LINKS)).toBe(3)
  })

  it('flags homepage when raw has zero links and records raw vs rendered evidence', () => {
    const r = detectZeroRawCrawlableAnchors({
      origin: 'https://autodun.com',
      pages: [
        {
          pageUrl: 'https://autodun.com/',
          rawHtml: AUTODUN_RAW,
          renderedHtml: RENDERED_WITH_LINKS,
        },
      ],
    })
    expect(r.findings).toHaveLength(1)
    const f = r.findings[0]!
    expect(f.verdict).toBe('zero-raw-crawlable-anchors')
    expect(f.detail).toMatch(/before JavaScript runs/i)
    expect(f.evidenceValues.rawCrawlableAnchorCount).toBe(0)
    expect(f.evidenceValues.renderedCrawlableAnchorCount).toBe(3)
    expect(f.autoFixable).toBe(false)
  })

  it('does not flag a blog page that is neither homepage nor high-impression', () => {
    const r = detectZeroRawCrawlableAnchors({
      origin: 'https://autodun.com',
      pages: [
        {
          pageUrl: 'https://autodun.com/privacy',
          rawHtml: AUTODUN_RAW,
          renderedHtml: null,
        },
      ],
    })
    expect(r.findings).toHaveLength(0)
    expect(r.suppressed[0]?.reason).toBe('not_homepage_or_high_impression')
  })

  it('flags high-impression non-homepage with zero raw anchors', () => {
    const r = detectZeroRawCrawlableAnchors({
      origin: 'https://autodun.com',
      pages: [
        {
          pageUrl: 'https://autodun.com/about',
          rawHtml: AUTODUN_RAW,
          renderedHtml: RENDERED_WITH_LINKS,
        },
      ],
      highImpressionNormalized: new Set(['https://autodun.com/about']),
    })
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]!.evidenceValues.highImpression).toBe(true)
  })
})
