/**
 * Diagnostic linkage: when a competitor is cited instead of the user,
 * compare real page signals only — never invent reasons.
 */

import { anonymizeDomain } from '../competitor-privacy'
import { isSafePublicUrl } from '../fetch-page-content'

export interface PageCitationSignals {
  url: string
  fetchOk: boolean
  hasFaqSchema: boolean
  hasOrganizationSchema: boolean
  hasArticleSchema: boolean
  hasDateModified: boolean
  dateModifiedValue: string | null
  answerFirst: boolean
  firstParagraph: string
  wordCount: number
}

export interface CitationDiagnostic {
  status: 'compared' | 'insufficient_data' | 'user_cited' | 'no_competitor'
  /** User-facing finding — competitor domains anonymized. */
  finding: string
  userSignals: Partial<PageCitationSignals>
  competitorSignals?: Partial<PageCitationSignals>
  gaps: string[]
  competitorLabel?: string
}

function extractJsonLdBlocks(html: string): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) blocks.push(...parsed.filter((x) => x && typeof x === 'object'))
      else if (parsed && typeof parsed === 'object') blocks.push(parsed)
    } catch {
      /* ignore bad JSON-LD */
    }
  }
  return blocks
}

function typeIncludes(block: Record<string, unknown>, type: string): boolean {
  const t = block['@type']
  if (typeof t === 'string') return t.toLowerCase() === type.toLowerCase()
  if (Array.isArray(t)) return t.some((x) => String(x).toLowerCase() === type.toLowerCase())
  const graph = block['@graph']
  if (Array.isArray(graph)) {
    return graph.some((g) => g && typeof g === 'object' && typeIncludes(g as Record<string, unknown>, type))
  }
  return false
}

function findDateModified(blocks: Array<Record<string, unknown>>): string | null {
  for (const b of blocks) {
    if (typeof b.dateModified === 'string' && b.dateModified.trim()) return b.dateModified
    const graph = b['@graph']
    if (Array.isArray(graph)) {
      for (const g of graph) {
        if (g && typeof g === 'object' && typeof (g as { dateModified?: string }).dateModified === 'string') {
          return (g as { dateModified: string }).dateModified
        }
      }
    }
  }
  return null
}

function firstParagraphText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const pMatch = body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
  const raw = pMatch ? pMatch[1] : body.slice(0, 800)
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
}

function looksAnswerFirst(firstPara: string, prompt: string): boolean {
  if (firstPara.length < 40) return false
  const tokens = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 6)
  if (tokens.length === 0) return firstPara.length >= 80
  const lower = firstPara.toLowerCase()
  const hits = tokens.filter((t) => lower.includes(t)).length
  return hits >= Math.min(2, tokens.length) && firstPara.length >= 60
}

export function extractCitationSignals(html: string, url: string): PageCitationSignals {
  const blocks = extractJsonLdBlocks(html)
  const hasFaqSchema = blocks.some((b) => typeIncludes(b, 'FAQPage'))
  const hasOrganizationSchema = blocks.some((b) => typeIncludes(b, 'Organization'))
  const hasArticleSchema = blocks.some(
    (b) => typeIncludes(b, 'Article') || typeIncludes(b, 'BlogPosting') || typeIncludes(b, 'NewsArticle'),
  )
  const dateModifiedValue = findDateModified(blocks)
  const firstParagraph = firstParagraphText(html)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    url,
    fetchOk: html.length > 50,
    hasFaqSchema,
    hasOrganizationSchema,
    hasArticleSchema,
    hasDateModified: !!dateModifiedValue,
    dateModifiedValue,
    answerFirst: false, // filled by caller with prompt
    firstParagraph,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  }
}

async function fetchHtml(url: string): Promise<string> {
  if (!isSafePublicUrl(url)) return ''
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKO-AI-Visibility/1.0' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

function guessUserPageUrl(siteUrl: string, prompt: string): string {
  // Prefer site root — we don't invent deep URLs. Caller may override.
  try {
    const u = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`)
    void prompt
    return `${u.origin}/`
  } catch {
    return siteUrl
  }
}

function competitorPageUrl(domain: string, citedUrls: string[]): string | null {
  const hit = citedUrls.find((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '').includes(domain.replace(/^www\./, ''))
    } catch {
      return u.includes(domain)
    }
  })
  if (hit && isSafePublicUrl(hit)) return hit
  const fallback = `https://${domain.replace(/^https?:\/\//, '')}/`
  return isSafePublicUrl(fallback) ? fallback : null
}

/**
 * Build an evidence-based diagnostic for a citation gap.
 * Never invents reasons — only reports detected signal differences.
 */
export async function buildCitationDiagnostic(opts: {
  prompt: string
  userDomain: string
  userSiteUrl: string
  userPageUrl?: string
  mentioned: boolean
  cited: boolean
  competitorDomains: string[]
  competitorCitedUrls: string[]
}): Promise<CitationDiagnostic> {
  if (opts.cited || opts.mentioned) {
    return {
      status: 'user_cited',
      finding: 'Your brand/domain was mentioned or cited for this prompt.',
      userSignals: {},
      gaps: [],
    }
  }

  const competitors = opts.competitorDomains.filter(Boolean)
  if (competitors.length === 0 && opts.competitorCitedUrls.length === 0) {
    return {
      status: 'no_competitor',
      finding: 'No competitor sources were returned for this prompt — gap only; insufficient data to diagnose why.',
      userSignals: {},
      gaps: ['Not mentioned or cited'],
    }
  }

  const compDomain = competitors[0] || (() => {
    try {
      return new URL(opts.competitorCitedUrls[0]).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()

  if (!compDomain) {
    return {
      status: 'insufficient_data',
      finding: 'Insufficient data to diagnose why — no comparable competitor page could be identified.',
      userSignals: {},
      gaps: ['Not mentioned or cited'],
    }
  }

  const userUrl = opts.userPageUrl || guessUserPageUrl(opts.userSiteUrl, opts.prompt)
  const compUrl = competitorPageUrl(compDomain, opts.competitorCitedUrls)

  if (!compUrl) {
    return {
      status: 'insufficient_data',
      finding: 'Insufficient data to diagnose why — competitor URL was not crawlable.',
      userSignals: {},
      competitorLabel: anonymizeDomain(compDomain),
      gaps: ['Not mentioned or cited'],
    }
  }

  const [userHtml, compHtml] = await Promise.all([fetchHtml(userUrl), fetchHtml(compUrl)])
  if (!userHtml || !compHtml) {
    return {
      status: 'insufficient_data',
      finding: 'Insufficient data to diagnose why — could not fetch both pages for comparison.',
      userSignals: { url: userUrl, fetchOk: !!userHtml },
      competitorSignals: { url: compUrl, fetchOk: !!compHtml },
      competitorLabel: anonymizeDomain(compDomain),
      gaps: ['Not mentioned or cited'],
    }
  }

  const userSig = extractCitationSignals(userHtml, userUrl)
  userSig.answerFirst = looksAnswerFirst(userSig.firstParagraph, opts.prompt)
  const compSig = extractCitationSignals(compHtml, compUrl)
  compSig.answerFirst = looksAnswerFirst(compSig.firstParagraph, opts.prompt)

  const gaps: string[] = []
  if (compSig.hasFaqSchema && !userSig.hasFaqSchema) gaps.push('FAQ schema')
  if (compSig.hasOrganizationSchema && !userSig.hasOrganizationSchema) gaps.push('Organization schema')
  if (compSig.hasArticleSchema && !userSig.hasArticleSchema) gaps.push('Article schema')
  if (compSig.hasDateModified && !userSig.hasDateModified) gaps.push('dateModified freshness signal')
  if (compSig.answerFirst && !userSig.answerFirst) gaps.push('direct answer in the first paragraph')

  const label = anonymizeDomain(compDomain)

  if (gaps.length === 0) {
    return {
      status: 'insufficient_data',
      finding: `${label} was cited for this query. Compared pages did not show a clear schema/freshness/answer-first gap we could detect — insufficient data to diagnose why.`,
      userSignals: userSig,
      competitorSignals: compSig,
      competitorLabel: label,
      gaps: [],
    }
  }

  return {
    status: 'compared',
    finding: `${label} was cited for this query. Their page has ${gaps.join(' and ')}. Your equivalent page is missing ${gaps.length === 1 ? 'that' : 'those'}.`,
    userSignals: userSig,
    competitorSignals: compSig,
    competitorLabel: label,
    gaps,
  }
}
