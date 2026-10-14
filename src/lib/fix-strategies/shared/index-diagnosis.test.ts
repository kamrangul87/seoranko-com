import { describe, expect, it } from 'vitest'
import {
  buildIndexDiagnosis,
  countInboundInternalLinksRaw,
} from './index-diagnosis'

const AUTODUN_HOME_RAW = `<!doctype html>
<html><head><link rel="canonical" href="https://autodun.com" />
<meta name="robots" content="index, follow" /></head>
<body><div id="root"></div></body></html>`

const BLOG_RAW = `<html><head>
<link rel="canonical" href="https://autodun.com/blog/ev-charging-reliability-uk.html" />
</head><body>
<a href="/">Home</a>
<a href="/blog">Blog</a>
<p>${'word '.repeat(120)}</p>
</body></html>`

describe('index diagnosis (autodun GSC not-indexed case)', () => {
  it('counts zero inbound raw links to a blog when homepage has no <a href>', () => {
    const n = countInboundInternalLinksRaw(
      'https://autodun.com/blog/ev-charging-reliability-uk.html',
      [
        { pageUrl: 'https://autodun.com/', rawHtml: AUTODUN_HOME_RAW },
        {
          pageUrl: 'https://autodun.com/blog/mot-cost-uk-2026.html',
          rawHtml: BLOG_RAW,
        },
      ],
    )
    // Blog links to / and /blog only — not to the reliability URL.
    expect(n).toBe(0)
  })

  it('classifies crawled-not-indexed blog with self-canonical as no technical blocker when linked and indexable', () => {
    const linkedBlog = `<html><head>
<link rel="canonical" href="https://autodun.com/blog/ev-charging-reliability-uk.html" />
</head><body><a href="/blog/ev-charging-reliability-uk.html">Reliability</a>
<p>${'content '.repeat(80)}</p></body></html>`

    const d = buildIndexDiagnosis({
      pageUrl: 'https://autodun.com/blog/ev-charging-reliability-uk.html',
      coverageState: 'Crawled - currently not indexed',
      page: {
        pageUrl: 'https://autodun.com/blog/ev-charging-reliability-uk.html',
        rawHtml: `<html><head>
<link rel="canonical" href="https://autodun.com/blog/ev-charging-reliability-uk.html" />
<meta name="robots" content="index,follow" />
</head><body><p>${'content '.repeat(80)}</p>
<a href="/blog">Blog</a></body></html>`,
        httpStatus: 200,
        headers: new Headers({ 'last-modified': 'Tue, 10 Feb 2026 00:00:00 GMT' }),
      },
      sitePagesRaw: [
        { pageUrl: 'https://autodun.com/', rawHtml: linkedBlog },
      ],
    })
    expect(d.inboundInternalLinksRaw).toBe(1)
    expect(d.wordCount).toBeGreaterThan(50)
    expect(d.canonical).toMatch(/ev-charging-reliability/)
    expect(d.robots).toMatch(/index/)
    expect(d.lastModified).toMatch(/2026/)
    expect(d.classification).toBe('no_technical_blocker')
    expect(d.classificationDetail).toMatch(/quality or priority/i)
    expect(d.neverPromiseIndexing).toBe(true)
  })

  it('classifies technical cause when homepage has zero raw anchors and orphan target', () => {
    const d = buildIndexDiagnosis({
      pageUrl: 'https://autodun.com/about',
      coverageState: 'Discovered - currently not indexed',
      page: {
        pageUrl: 'https://autodun.com/about',
        rawHtml: AUTODUN_HOME_RAW.replace('autodun.com"', 'autodun.com/about"'),
        httpStatus: 200,
      },
      sitePagesRaw: [
        { pageUrl: 'https://autodun.com/', rawHtml: AUTODUN_HOME_RAW },
      ],
      independentFindings: ['topic-73: zero-raw-crawlable-anchors'],
    })
    expect(d.classification).toBe('technical_cause_found')
    expect(d.technicalCauses.some((c) => c.includes('zero_inbound') || c.includes('73'))).toBe(
      true,
    )
  })
})
