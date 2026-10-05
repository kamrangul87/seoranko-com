/**
 * Fixture: a valid sitemap.xml (urlset) must produce zero HTML-detector
 * findings. Sitemap documents are INPUT for topics 24–28 only.
 */
import { describe, expect, it } from 'vitest'
import {
  SITEMAP_NAMESPACE,
  documentFromBody,
  buildSitemapInspection,
  robotsInspectionFromBody,
} from '@/lib/fix-strategies/shared'
import { detectSitemapXmlInvalid } from '@/lib/fix-strategies/topic-25'
import type { CrawledPage } from '@/lib/fix-strategies/findings-ui/crawl/fetch-page'
import {
  runDetectorsOnPages,
  runWholeSiteDetectorsOnCrawl,
} from '@/lib/fix-strategies/findings-ui/crawl/run-detectors'

const ORIGIN = 'https://example.com'
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`

const VALID_URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="${ORIGIN}/wp-sitemap.xsl" ?>
<urlset xmlns="${SITEMAP_NAMESPACE}">
  <url><loc>${ORIGIN}/</loc></url>
  <url><loc>${ORIGIN}/about/</loc></url>
</urlset>
`

/** HTML topics that must never fire against a sitemap document URL. */
const HTML_TOPIC_IDS = new Set([
  '1',
  '2b',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '19',
  '20',
  '21',
  '27', // as an HTML-page check (indexable omission)
  '29',
  '30',
  '31',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '42',
  '43',
  '45',
  '46',
  '47',
  '48',
  '49',
  '71',
])

function crawledSitemap(body = VALID_URLSET): CrawledPage {
  return {
    requestedUrl: SITEMAP_URL,
    finalUrl: SITEMAP_URL,
    status: 200,
    html: body,
    rawHtml: body,
    headers: new Headers({ 'content-type': 'application/xml' }),
    streamComplete: true,
    clientOnly: false,
    stable: true,
    crawlerCausedBackoff: false,
    evidence: {
      stable: true,
      outcome: {
        kind: 'http',
        status: 200,
        statusClass: '2xx',
        headers: new Headers({ 'content-type': 'application/xml' }),
        body,
        url: SITEMAP_URL,
        observedAtMs: Date.now(),
        streamComplete: true,
      },
      attempts: [
        {
          kind: 'http',
          status: 200,
          statusClass: '2xx',
          headers: new Headers({ 'content-type': 'application/xml' }),
          body,
          url: SITEMAP_URL,
          observedAtMs: Date.now(),
          streamComplete: true,
        },
      ],
    },
    errorDetail: null,
    renderMode: 'http',
    rawHtmlHash: null,
    renderedHtmlHash: null,
    renderEvidence: null,
  }
}

function homepageHtml(): string {
  return `<!doctype html><html lang="en"><head><title>Home</title>
<meta name="description" content="Home page for fixture"/>
<link rel="canonical" href="${ORIGIN}/"/>
</head><body><main><h1>Home</h1><p>Welcome to the site with enough words for detectors.</p>
<a href="${ORIGIN}/about/">About</a></main></body></html>`
}

describe('sitemap XML is not an HTML page', () => {
  it('valid sitemap.xml produces zero HTML-detector findings (per-page)', async () => {
    const emits = await runDetectorsOnPages(ORIGIN, [crawledSitemap()])
    const htmlHits = emits.filter((e) => HTML_TOPIC_IDS.has(e.topicId))
    expect(htmlHits).toEqual([])
    expect(emits).toEqual([])
  })

  it('valid sitemap.xml produces zero HTML findings on whole-site pass for that URL', async () => {
    const home = homepageHtml()
    const emits = await runWholeSiteDetectorsOnCrawl(ORIGIN, [
      {
        url: `${ORIGIN}/`,
        html: home,
        status: 200,
        clientOnly: false,
        headers: new Headers({ 'content-type': 'text/html' }),
      },
      {
        url: SITEMAP_URL,
        html: VALID_URLSET,
        status: 200,
        clientOnly: false,
        inSitemap: true,
        headers: new Headers({ 'content-type': 'application/xml' }),
      },
    ])
    const onSitemapHtml = emits.filter(
      (e) =>
        HTML_TOPIC_IDS.has(e.topicId) &&
        (e.pageUrl === SITEMAP_URL ||
          e.pageUrl.replace(/\/$/, '') === SITEMAP_URL.replace(/\/$/, '')),
    )
    expect(onSitemapHtml).toEqual([])
  })

  it('topic 25 still validates sitemap XML (sitemap detector path)', () => {
    const inspection = buildSitemapInspection({
      originUrl: ORIGIN,
      robots: robotsInspectionFromBody(`Sitemap: ${SITEMAP_URL}\n`),
      documents: [documentFromBody(SITEMAP_URL, VALID_URLSET)],
    })
    const result = detectSitemapXmlInvalid({ inspection })
    expect(result.findings).toHaveLength(0)
    expect(result.suppressed.some((s) => s.verdict === 'ok')).toBe(true)
  })
})
