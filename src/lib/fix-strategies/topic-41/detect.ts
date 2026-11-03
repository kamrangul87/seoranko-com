/**
 * Topic 41 — FAQPage JSON-LD absent where visible Q&A/FAQ exists.
 *
 * Finds visible Q/A pairs (details/summary, or a FAQ section of headings
 * with following paragraphs) and proposes a minimal FAQPage JSON-LD that
 * mirrors the actual text. Never invents questions or answers.
 *
 * Representation: rendered (prefer hydrated DOM when available).
 */

import { extractStructuredData, type StructuredDataExtraction } from '@/lib/fix-strategies/shared'

export type Topic41Verdict = 'auto-add-faq-json-ld' | 'ok' | 'suppress-no-faq'

export type Topic41Finding = {
  kind: 'structured-data/missing-faq'
  verdict: Topic41Verdict
  severity: 'moderate' | null
  detail: string
  pageUrl: string
  autoFixable: true
  proposed: { jsonLd: Record<string, unknown> }
}

export type DetectTopic41Result = {
  findings: Topic41Finding[]
  suppressed: Array<{ verdict: Topic41Verdict; detail: string }>
}

function hasFaqJsonLd(extraction: StructuredDataExtraction): boolean {
  return extraction.nodes.some((n) => n.types.includes('FAQPage'))
}

function extractDetailsPairs(html: string): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = []
  const re = /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) != null) {
    const q = (m[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    const a = (m[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (q && a) out.push({ q, a })
  }
  return out
}

function extractHeadingPairs(html: string): Array<{ q: string; a: string }> {
  // Look for an FAQ heading then h3/h4 question + following paragraph
  if (!/(faq|frequently asked questions)/i.test(html)) return []
  const out: Array<{ q: string; a: string }> = []
  const re = /<(h3|h4)\b[^>]*>([\s\S]*?)<\/\1>\s*<p\b[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) != null) {
    const q = (m[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    const a = (m[3] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (q && a) out.push({ q, a })
  }
  return out
}

export function detectFaqSchemaMissing(input: {
  html: string
  pageUrl: string
  extraction?: StructuredDataExtraction
}): DetectTopic41Result {
  const findings: Topic41Finding[] = []
  const suppressed: DetectTopic41Result['suppressed'] = []
  const extraction = input.extraction ?? extractStructuredData(input.html, input.pageUrl)

  if (hasFaqJsonLd(extraction)) {
    suppressed.push({ verdict: 'ok', detail: 'FAQPage JSON-LD already present' })
    return { findings, suppressed }
  }

  const pairs = [...extractDetailsPairs(input.html), ...extractHeadingPairs(input.html)]
  if (pairs.length < 2) {
    suppressed.push({ verdict: 'suppress-no-faq', detail: 'No visible FAQ/Q&A section detected' })
    return { findings, suppressed }
  }

  const mainEntity = pairs.map((p) => ({
    '@type': 'Question',
    name: p.q,
    acceptedAnswer: { '@type': 'Answer', text: p.a },
  }))
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity,
  }

  findings.push({
    kind: 'structured-data/missing-faq',
    verdict: 'auto-add-faq-json-ld',
    severity: 'moderate',
    detail:
      'Add FAQPage JSON-LD mirroring the visible Q&A content. Uses only on-page text; never invents questions or answers.',
    pageUrl: input.pageUrl,
    autoFixable: true,
    proposed: { jsonLd },
  })

  return { findings, suppressed }
}

