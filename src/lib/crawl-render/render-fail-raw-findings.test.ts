/**
 * Permanent guard: a headless render timeout must never discard raw-HTML findings.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { hashHtml } from '@/lib/crawl-render/hash'
import {
  clientOnlyAfterRender,
  isRenderDependentTopicUnavailable,
  renderUnavailableEmit,
} from '@/lib/crawl-render/render-fail-policy'
import type { CrawledPage } from '@/lib/fix-strategies/findings-ui/crawl/fetch-page'
import { runDetectorsOnPages } from '@/lib/fix-strategies/findings-ui/crawl/run-detectors'

const SPA_SHELL = `<!doctype html><html lang="en"><head><title>App</title></head>
<body><div id="root"></div>
<script type="module" src="/assets/index.js"></script>
</body></html>`

function spaPage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  const rawHtml = SPA_SHELL
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    html: rawHtml,
    rawHtml,
    headers: new Headers({ 'content-type': 'text/html' }),
    streamComplete: true,
    clientOnly: false,
    stable: true,
    crawlerCausedBackoff: false,
    evidence: {
      attempts: [
        {
          kind: 'http',
          status: 200,
          statusClass: '2xx',
          url: 'https://example.com/',
          headers: new Headers({ 'content-type': 'text/html' }),
          body: rawHtml,
          streamComplete: true,
          observedAtMs: Date.now(),
        },
      ],
      stable: true,
      reason: 'stable',
    },
    errorDetail: 'render_failed:render_timeout_5000ms',
    renderMode: 'render_failed',
    rawHtmlHash: hashHtml(rawHtml),
    renderedHtmlHash: null,
    renderEvidence: {
      url: 'https://example.com/',
      renderMode: 'render_failed',
      rawHtmlHash: hashHtml(rawHtml),
      renderedHtmlHash: null,
      renderNeeded: true,
      renderNeededReasons: ['zero_crawlable_anchors', 'thin_body_words'],
      rawHtml,
      renderedHtml: null,
      renderError: 'render_timeout_5000ms',
      renderTookMs: 5000,
    },
    ...overrides,
  }
}

describe('clientOnlyAfterRender', () => {
  it('keeps render_failed pages off the clientOnly discard path', () => {
    expect(
      clientOnlyAfterRender({
        shellLooksClientOnly: true,
        renderMode: 'render_failed',
      }),
    ).toBe(false)
  })

  it('still marks true client_only shells when render was not attempted', () => {
    expect(
      clientOnlyAfterRender({
        shellLooksClientOnly: true,
        renderMode: 'http',
      }),
    ).toBe(true)
  })
})

describe('render timeout → raw-HTML findings still produced', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs raw detectors on fetched HTML when render timed out', async () => {
    // Simulate the permanent policy: render_failed must not set clientOnly.
    const page = spaPage({
      clientOnly: clientOnlyAfterRender({
        shellLooksClientOnly: true,
        renderMode: 'render_failed',
      }),
    })
    expect(page.clientOnly).toBe(false)

    const emits = await runDetectorsOnPages('https://example.com', [page])

    const raw73 = emits.filter((e) => e.topicId === '73')
    expect(raw73.length).toBeGreaterThan(0)

    // Render-dependent topics must not judge the empty shell; marked unavailable.
    expect(isRenderDependentTopicUnavailable('30', 'render_failed')).toBe(true)
    expect(isRenderDependentTopicUnavailable('73', 'render_failed')).toBe(false)

    const unavailable = emits.filter((e) => e.verdict === 'render_unavailable')
    expect(unavailable.length).toBeGreaterThan(0)
    expect(unavailable.every((e) => e.bucket === 'informational')).toBe(true)

    // No missing-title false positive from judging the SPA shell as content.
    expect(emits.some((e) => e.topicId === '30' && e.bucket === 'actionable')).toBe(
      false,
    )
  })

  it('renderUnavailableEmit names the render error', () => {
    const e = renderUnavailableEmit({
      pageUrl: 'https://example.com/',
      renderError: 'render_timeout_5000ms',
      skippedTopicIds: ['30', '49'],
    })
    expect(e.verdict).toBe('render_unavailable')
    expect(e.detail).toMatch(/render_timeout_5000ms/)
    expect(e.evidenceValues?.skippedTopicIds).toEqual(['30', '49'])
  })
})
