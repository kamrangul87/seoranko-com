/**
 * Citation engines for AI Visibility Phase 1.
 *
 * OpenAI: Responses API + hosted `{ type: "web_search" }` — the only path
 * that can browse and return live source URLs. Chat Completions cannot.
 * Perplexity: Sonar chat completions with `return_citations: true`.
 *
 * Source URLs are taken from structured citation fields only — never by
 * regex-matching a URL that might appear in free-text output.
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
  /** Set when the check did not complete — never treat as a real "not cited". */
  error?: string
  httpStatus?: number
}

export function normalizeDomain(d: string): string {
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

export function brandMentioned(text: string, brand: string, domain: string): boolean {
  const lower = text.toLowerCase()
  const brandTok = brand.toLowerCase().trim()
  const host = normalizeDomain(domain)
  const root = host.split('.')[0] || ''
  if (brandTok.length >= 3 && lower.includes(brandTok)) return true
  if (host && lower.includes(host)) return true
  if (root.length >= 4 && lower.includes(root)) return true
  return false
}

/** Hostname match via URL parsing — never a naive period-split of the full string. */
export function urlMatchesHost(url: string, host: string): boolean {
  const target = normalizeDomain(host)
  if (!target) return false
  try {
    const h = normalizeDomain(new URL(url).hostname)
    return h === target || h.endsWith(`.${target}`) || target.endsWith(`.${h}`)
  } catch {
    return false
  }
}

export function partitionUrlsByHost(
  urls: string[],
  host: string,
): { citedUrls: string[]; competitorUrls: string[] } {
  const citedUrls: string[] = []
  const competitorUrls: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    const u = String(raw || '').trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    if (urlMatchesHost(u, host)) citedUrls.push(u)
    else competitorUrls.push(u)
  }
  return { citedUrls, competitorUrls }
}

function openaiCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1000) * AI_VISIBILITY_COST.openaiInputPer1k +
    (outputTokens / 1000) * AI_VISIBILITY_COST.openaiOutputPer1k
  )
}

function clipError(message: string, httpStatus?: number): string {
  const trimmed = message.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (httpStatus && !trimmed.includes(String(httpStatus))) {
    return `${trimmed} (HTTP ${httpStatus})`.slice(0, 240)
  }
  return trimmed
}

export function engineFailure(
  engine: AiVisibilityEngine,
  error: string,
  httpStatus?: number,
): EngineCheckResult {
  return {
    engine,
    mentioned: false,
    cited: false,
    citedUrls: [],
    competitorUrls: [],
    competitorDomains: [],
    responseSnippet: '',
    costUsd: 0,
    error: clipError(error, httpStatus),
    httpStatus,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function pushUrl(out: string[], seen: Set<string>, raw: unknown) {
  if (typeof raw !== 'string') return
  const u = raw.trim()
  if (!u || seen.has(u)) return
  if (!/^https?:\/\//i.test(u)) return
  seen.add(u)
  out.push(u)
}

function annotationUrl(ann: unknown): string | null {
  if (!isRecord(ann)) return null
  if (ann.type === 'url_citation' && typeof ann.url === 'string') return ann.url
  const nested = ann.url_citation
  if (isRecord(nested) && typeof nested.url === 'string') return nested.url
  return null
}

/**
 * Collect live source URLs from a Responses API payload:
 * - `url_citation` annotations on message content (cited in the answer)
 * - `web_search_call.action.sources` when `include` requested them
 */
export function parseOpenAIResponseSourceUrls(data: unknown): string[] {
  if (!isRecord(data)) return []
  const urls: string[] = []
  const seen = new Set<string>()

  const output = Array.isArray(data.output) ? data.output : []
  for (const item of output) {
    if (!isRecord(item)) continue

    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!isRecord(part) || !Array.isArray(part.annotations)) continue
        for (const ann of part.annotations) {
          pushUrl(urls, seen, annotationUrl(ann))
        }
      }
    }

    if (item.type === 'web_search_call' && isRecord(item.action) && Array.isArray(item.action.sources)) {
      for (const src of item.action.sources) {
        if (isRecord(src)) pushUrl(urls, seen, src.url)
        else pushUrl(urls, seen, src)
      }
    }
  }

  return urls
}

export function extractOpenAIResponseText(data: unknown): string {
  if (!isRecord(data)) return ''
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text
  const parts: string[] = []
  const output = Array.isArray(data.output) ? data.output : []
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isRecord(part)) continue
      if (typeof part.text === 'string') parts.push(part.text)
    }
  }
  return parts.join('\n')
}

function readUsageTokens(data: unknown): { inputTokens: number; outputTokens: number } {
  if (!isRecord(data) || !isRecord(data.usage)) return { inputTokens: 0, outputTokens: 0 }
  const usage = data.usage
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0
  return { inputTokens, outputTokens }
}

export function parsePerplexityCitationUrls(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.citations)) return []
  const urls: string[] = []
  const seen = new Set<string>()
  for (const c of data.citations) pushUrl(urls, seen, c)
  return urls
}

export async function checkOpenAICitation(opts: {
  prompt: string
  brand: string
  domain: string
}): Promise<EngineCheckResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return engineFailure('openai', 'OPENAI_API_KEY not configured')
  }

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CITATION_MODEL || 'gpt-4o-mini',
        tools: [{ type: 'web_search' }],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        max_output_tokens: 500,
        input: opts.prompt,
      }),
      signal: AbortSignal.timeout(45000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return engineFailure(
        'openai',
        `OpenAI API error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`,
        res.status,
      )
    }

    const data: unknown = await res.json()
    if (isRecord(data) && data.status === 'failed') {
      const errObj = isRecord(data.error) ? data.error : null
      const msg = errObj && typeof errObj.message === 'string' ? errObj.message : 'OpenAI response status failed'
      return engineFailure('openai', msg)
    }

    const content = extractOpenAIResponseText(data)
    const sourceUrls = parseOpenAIResponseSourceUrls(data)
    const host = normalizeDomain(opts.domain)
    const { citedUrls, competitorUrls } = partitionUrlsByHost(sourceUrls, host)
    const mentioned = brandMentioned(content, opts.brand, opts.domain) || citedUrls.length > 0
    const { inputTokens, outputTokens } = readUsageTokens(data)

    return {
      engine: 'openai',
      mentioned,
      cited: citedUrls.length > 0,
      citedUrls,
      competitorUrls: competitorUrls.slice(0, 8),
      competitorDomains: extractDomains(competitorUrls).filter((d) => d !== host).slice(0, 8),
      responseSnippet: content.slice(0, 400),
      costUsd: openaiCost(inputTokens, outputTokens),
      usage: { inputTokens, outputTokens },
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    const message = err instanceof Error ? err.message : String(err)
    if (name === 'TimeoutError' || /timeout|aborted/i.test(message)) {
      return engineFailure('openai', 'OpenAI request timed out')
    }
    return engineFailure('openai', message)
  }
}

export async function checkPerplexityCitation(opts: {
  prompt: string
  brand: string
  domain: string
}): Promise<EngineCheckResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) {
    return engineFailure('perplexity', 'PERPLEXITY_API_KEY not configured')
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
      const detail = await res.text().catch(() => '')
      return engineFailure(
        'perplexity',
        `Perplexity API error ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`,
        res.status,
      )
    }

    const data: unknown = await res.json()
    const content = isRecord(data)
      ? String(
          (Array.isArray(data.choices) && isRecord(data.choices[0]) && isRecord(data.choices[0].message)
            ? data.choices[0].message.content
            : '') || '',
        )
      : ''
    const citations = parsePerplexityCitationUrls(data)
    const host = normalizeDomain(opts.domain)
    const { citedUrls, competitorUrls } = partitionUrlsByHost(citations, host)
    const mentioned = brandMentioned(content, opts.brand, opts.domain) || citedUrls.length > 0

    const { inputTokens, outputTokens } = readUsageTokens(data)
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
      competitorDomains: extractDomains(competitorUrls).filter((d) => d !== host).slice(0, 8),
      responseSnippet: content.slice(0, 400),
      costUsd,
      usage: { inputTokens, outputTokens },
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    const message = err instanceof Error ? err.message : String(err)
    if (name === 'TimeoutError' || /timeout|aborted/i.test(message)) {
      return engineFailure('perplexity', 'Perplexity request timed out')
    }
    return engineFailure('perplexity', message)
  }
}
