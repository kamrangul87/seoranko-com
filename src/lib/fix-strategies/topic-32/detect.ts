/**
 * Topic 32 — client-rendered shell served with little/no real content.
 *
 * Flags pages whose raw HTML looks like a JS app shell (Next/React root)
 * while missing core content signals (no <title>, no <h1>) or with too few
 * words in the visible body text. This suggests Google may see an almost
 * empty page without rendering.
 *
 * Representation: raw (judge the server HTML body as-served).
 */

import { detectRenderNeeded } from '@/lib/crawl-render'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export type Topic32Verdict =
  | 'finding-client-rendered-thin-or-missing-headings'
  | 'ok'
  | 'suppress-non-html'

export type Topic32Finding = {
  kind: 'content/client-rendered-shell'
  verdict: Topic32Verdict
  severity: 'high' | 'moderate' | 'informational' | null
  detail: string
  pageUrl: string
  autoFixable: false
}

export type DetectTopic32Result = {
  findings: Topic32Finding[]
  suppressed: Array<{ verdict: Topic32Verdict; detail: string }>
  observations: Array<{
    pageUrl: string
    bodyWords: number
    crawlableAnchorCount: number
    hasFrameworkRoot: boolean
    hasNoscript: boolean
  }>
}

/** Basic HTML-ish sniff to skip CSS/JS/images mis-fetched as HTML. */
function looksLikeHtml(html: string): boolean {
  return /<html\b|<body\b|<head\b/i.test(html)
}

function hasTitle(html: string): boolean {
  return /<title\b[^>]*>\s*\S+[\s\S]*?<\/title>/i.test(html)
}

function hasH1(html: string): boolean {
  return /<h1\b[^>]*>\s*\S+[\s\S]*?<\/h1>/i.test(html)
}

export function detectClientRenderedThinOrMissingHeadings(input: {
  html: string
  pageUrl: string
}): DetectTopic32Result {
  const findings: Topic32Finding[] = []
  const suppressed: DetectTopic32Result['suppressed'] = []
  const observations: DetectTopic32Result['observations'] = []

  if (!looksLikeHtml(input.html)) {
    suppressed.push({
      verdict: 'suppress-non-html',
      detail: 'Non-HTML payload — not a page shell',
    })
    return { findings, suppressed, observations }
  }

  const rn = detectRenderNeeded(input.html)
  const minWords = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderMinBodyWords
  const missingCoreSignals = !hasTitle(input.html) || !hasH1(input.html)
  const thinByWords = rn.bodyWords < (typeof minWords === 'number' ? minWords : 50)
  const appShellLikely =
    rn.hasFrameworkRoot ||
    rn.reasons.includes('detector_needs_content') ||
    // Safety net: multiple script tags with a JS module strongly hint at a shell
    (/<script[^>]+type\s*=\s*["']module["'][^>]*>/i.test(input.html) &&
      (input.html.match(/<script\b/gi) || []).length >= 2)

  observations.push({
    pageUrl: input.pageUrl,
    bodyWords: rn.bodyWords,
    crawlableAnchorCount: rn.crawlableAnchorCount,
    hasFrameworkRoot: rn.hasFrameworkRoot,
    hasNoscript: rn.hasNoscript,
  })

  // Only flag when the HTML likely comes from a JS shell AND is thin/missing.
  if (appShellLikely && (missingCoreSignals || thinByWords)) {
    // Elevate to high when both <title> and <h1> are missing; else moderate.
    const severe = !hasTitle(input.html) && !hasH1(input.html)
    findings.push({
      kind: 'content/client-rendered-shell',
      verdict: 'finding-client-rendered-thin-or-missing-headings',
      severity: severe ? 'high' : 'moderate',
      pageUrl: input.pageUrl,
      autoFixable: false,
      detail:
        'Server HTML looks like a JS app shell with little or no content. Google may see an almost empty page. Server‑render a meaningful <title>, an <h1>, and an intro paragraph so key content is present without JS.',
    })
  } else {
    suppressed.push({
      verdict: 'ok',
      detail: 'Served HTML has core content signals or is not a JS shell',
    })
  }

  return { findings, suppressed, observations }
}

