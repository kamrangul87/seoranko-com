/**
 * Topic 40 — Article/BlogPosting JSON-LD absent on apparent article pages.
 *
 * Proposes minimal Article JSON-LD using only facts present on the page
 * (headline from H1, published/modified dates from meta/time, author from
 * meta when available). Never invents facts.
 *
 * Representation: rendered (prefer hydrated DOM when available).
 */

import {
  extractStructuredData,
  type StructuredDataExtraction,
} from '@/lib/fix-strategies/shared'

export type Topic40Verdict = 'auto-add-article-json-ld' | 'ok' | 'suppress-not-article'

export type Topic40Finding = {
  kind: 'structured-data/missing-article'
  verdict: Topic40Verdict
  severity: 'moderate' | null
  detail: string
  pageUrl: string
  autoFixable: true
  proposed: { jsonLd: Record<string, unknown> }
}

export type DetectTopic40Result = {
  findings: Topic40Finding[]
  suppressed: Array<{ verdict: Topic40Verdict; detail: string }>
}

function hasArticleJsonLd(extraction: StructuredDataExtraction): boolean {
  return extraction.nodes.some((n) =>
    n.types.some((t) =>
      /^(Article|BlogPosting|NewsArticle)$/i.test(String(t)),
    ),
  )
}

function pickText(html: string, selector: RegExp): string | null {
  const m = html.match(selector)
  if (!m) return null
  const raw = m[1] ?? ''
  const txt = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return txt || null
}

function isLikelyArticle(html: string): boolean {
  if (/<article\b/i.test(html)) return true
  if (/<meta\s+property=["']og:type["']\s+content=["']article["']/i.test(html)) return true
  if (/<meta\s+property=["']article:published_time["']/i.test(html)) return true
  if (/<time\b[^>]*datetime=["'][^"']+["']/i.test(html) && /<h1\b/i.test(html)) return true
  return false
}

function extractArticleFacts(html: string): {
  headline: string | null
  datePublished: string | null
  dateModified: string | null
  authorName: string | null
} {
  const headline =
    pickText(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ??
    pickText(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
  const publishedMeta =
    html.match(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)?.[1] ??
    null
  const modifiedMeta =
    html.match(/<meta\s+property=["']article:modified_time["']\s+content=["']([^"']+)["']/i)?.[1] ??
    null
  const authorMeta =
    html.match(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i)?.[1] ??
    null
  const authorName = authorMeta ? authorMeta.trim() : null
  return {
    headline: headline ?? null,
    datePublished: publishedMeta,
    dateModified: modifiedMeta,
    authorName,
  }
}

export function detectArticleSchemaMissing(input: {
  html: string
  pageUrl: string
  extraction?: StructuredDataExtraction
}): DetectTopic40Result {
  const findings: Topic40Finding[] = []
  const suppressed: DetectTopic40Result['suppressed'] = []
  const extraction = input.extraction ?? extractStructuredData(input.html, input.pageUrl)

  if (hasArticleJsonLd(extraction)) {
    suppressed.push({ verdict: 'ok', detail: 'Article/BlogPosting JSON-LD already present' })
    return { findings, suppressed }
  }
  if (!isLikelyArticle(input.html)) {
    suppressed.push({ verdict: 'suppress-not-article', detail: 'Page does not look like an article' })
    return { findings, suppressed }
  }

  const facts = extractArticleFacts(input.html)
  if (!facts.headline) {
    suppressed.push({
      verdict: 'suppress-not-article',
      detail: 'No H1/headline found — avoid inventing Article JSON-LD',
    })
    return { findings, suppressed }
  }

  const jsonLd: {
    '@context': 'https://schema.org'
    '@type': 'Article'
    headline: string
    mainEntityOfPage: string
    datePublished?: string
    dateModified?: string
    author?: { '@type': 'Person'; name: string }
  } = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: facts.headline,
    mainEntityOfPage: input.pageUrl,
  }
  if (facts.datePublished) jsonLd.datePublished = facts.datePublished
  if (facts.dateModified) jsonLd.dateModified = facts.dateModified
  if (facts.authorName) {
    jsonLd.author = { '@type': 'Person', name: facts.authorName }
  }

  findings.push({
    kind: 'structured-data/missing-article',
    verdict: 'auto-add-article-json-ld',
    severity: 'moderate',
    detail:
      'Add minimal Article JSON-LD based on page facts (headline, dates, author if present). Never invent values.',
    pageUrl: input.pageUrl,
    autoFixable: true,
    proposed: { jsonLd },
  })

  return { findings, suppressed }
}

