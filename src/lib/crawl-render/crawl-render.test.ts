import { describe, expect, it } from 'vitest'
import { detectRenderNeeded } from '@/lib/crawl-render/detect'
import { hashHtml } from '@/lib/crawl-render/hash'
import { buildRawRenderMismatch } from '@/lib/crawl-render/raw-render-mismatch'
import { representationForTopic, htmlForTopic } from '@/lib/crawl-render/detector-representation'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

describe('detectRenderNeeded', () => {
  it('flags empty #root SPA shell (zero anchors + thin words)', () => {
    const html = `<!doctype html><html lang="en"><body><div id="root"></div>
      <script type="module" src="/assets/app.js"></script></body></html>`
    const r = detectRenderNeeded(html)
    expect(r.needed).toBe(true)
    expect(r.reasons).toContain('zero_crawlable_anchors')
    expect(r.reasons).toContain('thin_body_words')
    expect(r.bodyWords).toBeLessThan(
      FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderMinBodyWords,
    )
  })

  it('does not flag rich static HTML with links and body text', () => {
    const paras = Array.from(
      { length: 20 },
      (_, i) => `<p>Paragraph ${i} with enough words for body text content here.</p>`,
    ).join('')
    const html = `<!doctype html><html><body><h1>Guide</h1>${paras}<a href="/a">A</a><a href="/b">B</a></body></html>`
    expect(detectRenderNeeded(html).needed).toBe(false)
  })

  it('flags zero crawlable anchors even with some body text', () => {
    const paras = Array.from(
      { length: 8 },
      (_, i) => `<p>Paragraph ${i} with enough words for body text content here.</p>`,
    ).join('')
    const html = `<!doctype html><html><body><h1>Guide</h1>${paras}</body></html>`
    const r = detectRenderNeeded(html)
    expect(r.needed).toBe(true)
    expect(r.reasons).toContain('zero_crawlable_anchors')
  })

  it('timeout product decision sits well inside the 12s budget', () => {
    expect(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderTimeoutMs).toBeLessThan(
      FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderBudgetMs,
    )
    expect(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderTimeoutMs).toBe(5_000)
    expect(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderChunkSize).toBe(2)
    expect(FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderMaxPerTick).toBe(2)
  })
})

describe('buildRawRenderMismatch', () => {
  it('emits informational finding when thin raw becomes rich rendered', () => {
    const raw = `<html><body><div id="root"></div><script type="module" src="/x.js"></script></body></html>`
    const rendered = `<html><body><nav><a href="/">Home</a><a href="/blog">Blog</a></nav>
      ${'<p>Word '.repeat(120)} done</p></body></html>`
    const m = buildRawRenderMismatch({
      pageUrl: 'https://example.com/',
      originHost: 'example.com',
      evidence: {
        url: 'https://example.com/',
        renderMode: 'rendered',
        rawHtmlHash: hashHtml(raw),
        renderedHtmlHash: hashHtml(rendered),
        renderNeeded: true,
        renderNeededReasons: ['zero_crawlable_anchors', 'thin_body_words'],
        rawHtml: raw,
        renderedHtml: rendered,
        renderError: null,
        renderTookMs: 1200,
      },
    })
    expect(m).not.toBeNull()
    expect(m!.code).toBe('RAW_RENDER_MISMATCH')
    expect(m!.bucket).toBe('informational')
  })
})

describe('detector representation', () => {
  it('uses rendered HTML for content topics when available', () => {
    expect(representationForTopic('49')).toBe('rendered')
    expect(representationForTopic('1')).toBe('raw')
    expect(htmlForTopic('49', 'RAW', 'RENDERED')).toBe('RENDERED')
    expect(htmlForTopic('1', 'RAW', 'RENDERED')).toBe('RAW')
  })
})
