/**
 * AI Visibility — diagnostic linkage + config unit tests (no live API calls).
 */

import { describe, expect, it } from 'vitest'
import { extractCitationSignals, buildCitationDiagnostic } from './diagnostic-linkage'
import { getAiVisibilityPromptCap, AI_VISIBILITY_PHASE_NOTE } from './config'
import { suggestPromptsForSite } from './run-citation-check'

describe('ai-visibility config', () => {
  it('exposes phase limitation note and prompt cap', () => {
    expect(AI_VISIBILITY_PHASE_NOTE).toMatch(/OpenAI/i)
    expect(AI_VISIBILITY_PHASE_NOTE).toMatch(/Perplexity/i)
    expect(AI_VISIBILITY_PHASE_NOTE).toMatch(/Google AI Overviews|not available via API/i)
    expect(getAiVisibilityPromptCap()).toBeGreaterThanOrEqual(1)
  })

  it('suggests prompts from brand/domain without inventing claims', () => {
    const prompts = suggestPromptsForSite({ brand: 'Autodun', domain: 'autodun.com', market: 'UK' })
    expect(prompts.length).toBeGreaterThanOrEqual(5)
    expect(prompts.every((p) => p.toLowerCase().includes('autodun') || p.includes('UK'))).toBe(true)
  })
})

describe('diagnostic linkage — evidence only', () => {
  const userHtml = `
    <html><body>
      <h1>Chargers</h1>
      <p>Welcome to our shop.</p>
    </body></html>`

  const competitorHtml = `
    <html><body>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
      <script type="application/ld+json">{"@type":"Article","headline":"Guide","dateModified":"2026-08-01"}</script>
      <p>The best EV charger installer UK depends on your driveway and grid capacity — here is how to choose.</p>
    </body></html>`

  it('extracts FAQ, Article, dateModified, and answer-first signals', () => {
    const sig = extractCitationSignals(competitorHtml, 'https://example.com/guide')
    expect(sig.hasFaqSchema).toBe(true)
    expect(sig.hasArticleSchema).toBe(true)
    expect(sig.hasDateModified).toBe(true)
    expect(sig.firstParagraph.toLowerCase()).toMatch(/ev charger|best/)
  })

  it('reports evidence-based gaps when competitor has signals user lacks', async () => {
    const originalFetch = global.fetch
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      const html = url.includes('autodun') ? userHtml : competitorHtml
      return new Response(html, { status: 200 })
    }) as typeof fetch

    try {
      const d = await buildCitationDiagnostic({
        prompt: 'best EV charger installer UK',
        userDomain: 'autodun.com',
        userSiteUrl: 'https://autodun.com',
        mentioned: false,
        cited: false,
        competitorDomains: ['competitor.example'],
        competitorCitedUrls: ['https://competitor.example/guide'],
      })
      expect(d.status).toBe('compared')
      expect(d.finding).toMatch(/another site/i)
      expect(d.gaps.length).toBeGreaterThan(0)
      expect(d.gaps.some((g) => /FAQ|Article|dateModified|first paragraph/i.test(g))).toBe(true)
      // Never invent competitor brand names in user-facing finding
      expect(d.finding).not.toMatch(/competitor\.example/i)
    } finally {
      global.fetch = originalFetch
    }
  })

  it('flags insufficient data when no competitor can be compared', async () => {
    const d = await buildCitationDiagnostic({
      prompt: 'best widgets',
      userDomain: 'autodun.com',
      userSiteUrl: 'https://autodun.com',
      mentioned: false,
      cited: false,
      competitorDomains: [],
      competitorCitedUrls: [],
    })
    expect(d.status).toBe('no_competitor')
    expect(d.finding).toMatch(/insufficient data|gap only/i)
  })
})
