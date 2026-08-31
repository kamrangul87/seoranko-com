/**
 * Citation engines for AI Visibility Phase 1: OpenAI chat + Perplexity Sonar.
 * No browser automation. Perplexity returns real source citations; OpenAI is
 * mention/brand detection from the model response (no citation list API).
 */

import { AI_VISIBILITY_COST, type AiVisibilityEngine } from './config'

export interface EngineCheckResult {
  engine: AiVisibilityEngine
  mentioned: boolean
  cited: boolean
  citedUrls: string[]
  competitorUrls: string[]
  competitorDomains: string[]
  responseSnippet: string
  costUsd: number
  usage?: { inputTokens?: number; outputTokens?: number }
  error?: string
}

function normalizeDomain(d: string): string {
  return d
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
}

function extractDomains(urls: string[]): string[] {
  return urls
    .map((url) => {
      try {
        return normalizeDomain(new URL(url).hostname)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

function brandMentioned(text: string, brand: string, domain: string): boolean {
  const lower = text.toLowerCase()
  const brandTok = brand.toLowerCase().trim()
  const host = normalizeDomain(domain)
  const root = host.split('.')[0] || ''
  if (brandTok.length >= 3 && lower.includes(brandTok)) return true
  if (host && lower.includes(host)) return true
  if (root.length >= 4 && lower.includes(root)) return true
  return false
}

function openaiCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1000) * AI_VISIBILITY_COST.openaiInputPer1k +
    (outputTokens / 1000) * AI_VISIBILITY_COST.openaiOutputPer1k
  )
}

export async function checkOpenAICitation(opts: {
  prompt: string
  brand: string
  domain: string
}): Promise<EngineCheckResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      engine: 'openai',
      mentioned: false,
      cited: false,
      citedUrls: [],
      competitorUrls: [],
      competitorDomains: [],
      responseSnippet: '',
      costUsd: 0,
      error: 'OPENAI_API_KEY not configured',
    }
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CITATION_MODEL || 'gpt-4o-mini',
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              'Answer helpfully and specifically. When recommending companies, products, or websites, name them and include URLs when you know them.',
          },
          { role: 'user', content: opts.prompt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return {
        engine: 'openai',
        mentioned: false,
        cited: false,
        citedUrls: [],
        competitorUrls: [],
        competitorDomains: [],
        responseSnippet: '',
        costUsd: 0,
        error: `OpenAI API error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`,
      }
    }

    const data = await res.json()
    const content = String(data.choices?.[0]?.message?.content || '')
    const inputTokens = Number(data.usage?.prompt_tokens || 0)
    const outputTokens = Number(data.usage?.completion_tokens || 0)
    const host = normalizeDomain(opts.domain)
    const mentioned = brandMentioned(content, opts.brand, opts.domain)
    const urlHits = Array.from(content.matchAll(/https?:\/\/[^\s)\]>"']+/gi)).map((m) => m[0])
    const citedUrls = urlHits.filter((u) => {
      const h = normalizeDomain(u)
      return h === host || h.endsWith(`.${host}`) || host.includes(h.split('.')[0] || '___')
    })
    const competitorUrls = urlHits.filter((u) => !citedUrls.includes(u))
    const competitorDomains = extractDomains(competitorUrls).filter((d) => d !== host)

    return {
      engine: 'openai',
      mentioned,
      cited: citedUrls.length > 0,
      citedUrls,
      competitorUrls: competitorUrls.slice(0, 8),
      competitorDomains: competitorDomains.slice(0, 8),
      responseSnippet: content.slice(0, 400),
      costUsd: openaiCost(inputTokens, outputTokens),
      usage: { inputTokens, outputTokens },
    }
  } catch (err) {
    return {
      engine: 'openai',
      mentioned: false,
      cited: false,
      citedUrls: [],
      competitorUrls: [],
      competitorDomains: [],
      responseSnippet: '',
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function checkPerplexityCitation(opts: {
  prompt: string
  brand: string
  domain: string
}): Promise<EngineCheckResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) {
    return {
      engine: 'perplexity',
      mentioned: false,
      cited: false,
      citedUrls: [],
      competitorUrls: [],
      competitorDomains: [],
      responseSnippet: '',
      costUsd: 0,
      error: 'PERPLEXITY_API_KEY not configured',
    }
  }

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.PERPLEXITY_CITATION_MODEL || 'sonar',
        messages: [{ role: 'user', content: opts.prompt }],
        return_citations: true,
        return_images: false,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(45000),
    })

    if (!res.ok) {
      return {
        engine: 'perplexity',
        mentioned: false,
        cited: false,
        citedUrls: [],
        competitorUrls: [],
        competitorDomains: [],
        responseSnippet: '',
        costUsd: 0,
        error: `Perplexity API error ${res.status}`,
      }
    }

    const data = await res.json()
    const content = String(data.choices?.[0]?.message?.content || '')
    const citations: string[] = Array.isArray(data.citations) ? data.citations : []
    const host = normalizeDomain(opts.domain)
    const citedUrls = citations.filter((u) => {
      try {
        const h = normalizeDomain(new URL(u).hostname)
        return h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`)
      } catch {
        return u.includes(host)
      }
    })
    const competitorUrls = citations.filter((u) => !citedUrls.includes(u))
    const competitorDomains = extractDomains(competitorUrls).filter((d) => d !== host)
    const mentioned = brandMentioned(content, opts.brand, opts.domain) || citedUrls.length > 0

    const inputTokens = Number(data.usage?.prompt_tokens || 0)
    const outputTokens = Number(data.usage?.completion_tokens || 0)
    const costUsd =
      inputTokens || outputTokens
        ? openaiCost(inputTokens, outputTokens)
        : AI_VISIBILITY_COST.perplexityPerRequest

    return {
      engine: 'perplexity',
      mentioned,
      cited: citedUrls.length > 0,
      citedUrls,
      competitorUrls: competitorUrls.slice(0, 8),
      competitorDomains: competitorDomains.slice(0, 8),
      responseSnippet: content.slice(0, 400),
      costUsd,
      usage: { inputTokens, outputTokens },
    }
  } catch (err) {
    return {
      engine: 'perplexity',
      mentioned: false,
      cited: false,
      citedUrls: [],
      competitorUrls: [],
      competitorDomains: [],
      responseSnippet: '',
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
