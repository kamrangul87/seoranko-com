/**
 * AI Visibility — diagnostic linkage, citation engines, and config unit tests.
 * Engine tests mock fetch — no live API calls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractCitationSignals, buildCitationDiagnostic, buildCheckFailedDiagnostic } from './diagnostic-linkage'
import { getAiVisibilityPromptCap, AI_VISIBILITY_PHASE_NOTE } from './config'
import { suggestPromptsForSite } from './run-citation-check'
import {
  checkOpenAICitation,
  checkPerplexityCitation,
  parseOpenAIResponseSourceUrls,
  parsePerplexityCitationUrls,
  urlMatchesHost,
  partitionUrlsByHost,
} from './citation-engines'

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

  it('builds a check_failed diagnostic that is distinct from not-cited', () => {
    const d = buildCheckFailedDiagnostic('OPENAI_API_KEY not configured')
    expect(d.status).toBe('check_failed')
    expect(d.finding).toMatch(/failed to run/i)
    expect(d.finding).not.toMatch(/^not cited/i)
    expect(d.error).toBe('OPENAI_API_KEY not configured')
  })
})

const openaiResponsesFixture = {
  id: 'resp_test',
  status: 'completed',
  output_text: 'Several installers operate in the UK, including Autodun.',
  output: [
    {
      type: 'web_search_call',
      status: 'completed',
      action: {
        type: 'search',
        query: 'best EV charger installer',
        sources: [
          { type: 'url', url: 'https://autodun.com/ev-chargers' },
          { type: 'url', url: 'https://example.org/guide' },
        ],
      },
    },
    {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: 'Several installers operate in the UK, including Autodun.',
          annotations: [
            {
              type: 'url_citation',
              start_index: 40,
              end_index: 47,
              url: 'https://www.autodun.com/install',
              title: 'Autodun',
            },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 120, output_tokens: 80 },
}

describe('OpenAI Responses source URL parsing', () => {
  it('reads url_citation annotations and web_search sources, not free-text URLs', () => {
    const urls = parseOpenAIResponseSourceUrls(openaiResponsesFixture)
    expect(urls).toContain('https://www.autodun.com/install')
    expect(urls).toContain('https://autodun.com/ev-chargers')
    expect(urls).toContain('https://example.org/guide')
  })

  it('does not treat a URL that only appears in free-text as a citation', () => {
    const urls = parseOpenAIResponseSourceUrls({
      output_text: 'See https://autodun.com for details.',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'See https://autodun.com for details.', annotations: [] }],
        },
      ],
    })
    expect(urls).toEqual([])
  })

  it('matches user domain via hostname parsing (gov.uk-safe)', () => {
    expect(urlMatchesHost('https://www.autodun.com/x', 'autodun.com')).toBe(true)
    expect(urlMatchesHost('https://energynetworks.org/page', 'autodun.com')).toBe(false)
    expect(urlMatchesHost('https://www.gov.uk/guidance', 'gov.uk')).toBe(true)
    const { citedUrls, competitorUrls } = partitionUrlsByHost(
      ['https://autodun.com/a', 'https://example.org/b'],
      'autodun.com',
    )
    expect(citedUrls).toEqual(['https://autodun.com/a'])
    expect(competitorUrls).toEqual(['https://example.org/b'])
  })
})

describe('OpenAI citation engine — Responses + web_search', () => {
  const originalKey = process.env.OPENAI_API_KEY
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalKey
  })

  it('returns a persisted-style error when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY
    const r = await checkOpenAICitation({ prompt: 'best widgets', brand: 'Autodun', domain: 'autodun.com' })
    expect(r.error).toMatch(/OPENAI_API_KEY/)
    expect(r.cited).toBe(false)
    expect(r.mentioned).toBe(false)
    expect(r.costUsd).toBe(0)
    expect(r.httpStatus).toBeUndefined()
  })

  it('returns httpStatus on 401 instead of a silent not-cited row', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    global.fetch = vi.fn(async () => new Response('invalid api key', { status: 401 })) as typeof fetch
    const r = await checkOpenAICitation({ prompt: 'best widgets', brand: 'Autodun', domain: 'autodun.com' })
    expect(r.error).toMatch(/401/)
    expect(r.httpStatus).toBe(401)
    expect(r.cited).toBe(false)
    expect(r.costUsd).toBe(0)
  })

  it('POSTs /v1/responses with web_search and parses structured source URLs + cost', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses')
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.tools).toEqual([{ type: 'web_search' }])
      expect(body.include).toContain('web_search_call.action.sources')
      expect(body.tool_choice).toBe('required')
      expect(String(init?.method || 'POST').toUpperCase()).toBe('POST')
      return new Response(JSON.stringify(openaiResponsesFixture), { status: 200 })
    })
    global.fetch = fetchMock as typeof fetch

    const r = await checkOpenAICitation({
      prompt: 'best EV charger installer',
      brand: 'Autodun',
      domain: 'autodun.com',
    })
    expect(r.error).toBeUndefined()
    expect(r.cited).toBe(true)
    expect(r.citedUrls.some((u) => u.includes('autodun.com'))).toBe(true)
    expect(r.competitorDomains).toContain('example.org')
    expect(r.costUsd).toBeGreaterThan(0)
    expect(r.usage?.inputTokens).toBe(120)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not mark cited from a free-text URL with no structured citations', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output_text: 'Visit https://autodun.com today.',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'Visit https://autodun.com today.', annotations: [] }],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
          { status: 200 },
        ),
    ) as typeof fetch

    const r = await checkOpenAICitation({ prompt: 'widgets', brand: 'Autodun', domain: 'autodun.com' })
    expect(r.error).toBeUndefined()
    expect(r.cited).toBe(false)
    expect(r.citedUrls).toEqual([])
    expect(r.mentioned).toBe(true)
    expect(r.costUsd).toBeGreaterThan(0)
  })
})

describe('Perplexity citation engine — errors persist, citations unchanged', () => {
  const originalKey = process.env.PERPLEXITY_API_KEY
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    if (originalKey === undefined) delete process.env.PERPLEXITY_API_KEY
    else process.env.PERPLEXITY_API_KEY = originalKey
  })

  it('parses data.citations the same as before', () => {
    const urls = parsePerplexityCitationUrls({
      citations: ['https://autodun.com/x', 'https://example.org/y'],
    })
    expect(urls).toEqual(['https://autodun.com/x', 'https://example.org/y'])
  })

  it('returns an error when PERPLEXITY_API_KEY is missing', async () => {
    delete process.env.PERPLEXITY_API_KEY
    const r = await checkPerplexityCitation({ prompt: 'best widgets', brand: 'Autodun', domain: 'autodun.com' })
    expect(r.error).toMatch(/PERPLEXITY_API_KEY/)
    expect(r.cited).toBe(false)
    expect(r.costUsd).toBe(0)
  })

  it('returns httpStatus on 429', async () => {
    process.env.PERPLEXITY_API_KEY = 'pplx-test'
    global.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as typeof fetch
    const r = await checkPerplexityCitation({ prompt: 'best widgets', brand: 'Autodun', domain: 'autodun.com' })
    expect(r.httpStatus).toBe(429)
    expect(r.error).toMatch(/429/)
    expect(r.cited).toBe(false)
  })

  it('still cites from the citations array on success', async () => {
    process.env.PERPLEXITY_API_KEY = 'pplx-test'
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('perplexity.ai/chat/completions')
      const body = JSON.parse(String(init?.body || '{}'))
      expect(body.return_citations).toBe(true)
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Autodun is an installer.' } }],
          citations: ['https://autodun.com/install', 'https://example.org/other'],
          usage: { prompt_tokens: 40, completion_tokens: 20 },
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const r = await checkPerplexityCitation({
      prompt: 'best EV charger installer',
      brand: 'Autodun',
      domain: 'autodun.com',
    })
    expect(r.error).toBeUndefined()
    expect(r.cited).toBe(true)
    expect(r.citedUrls).toEqual(['https://autodun.com/install'])
    expect(r.competitorDomains).toContain('example.org')
    expect(r.costUsd).toBeGreaterThan(0)
  })
})
