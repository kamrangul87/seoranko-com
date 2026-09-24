/**
 * Render-needed detection for the crawl render guard.
 * Only flag when rendering would change the detector answer:
 *   - zero crawlable <a href> in served HTML, or
 *   - main content below the word threshold, or
 *   - a content/meta detector needs signals the raw HTML does not contain
 * Server-rendered sites with links + body text pay no render cost.
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export type RenderNeededReason =
  | 'zero_crawlable_anchors'
  | 'thin_body_words'
  | 'detector_needs_content'

export type RenderNeededResult = {
  needed: boolean
  reasons: RenderNeededReason[]
  bodyTextChars: number
  bodyWords: number
  crawlableAnchorCount: number
  hasFrameworkRoot: boolean
  hasNoscript: boolean
}

function bodyText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function crawlableAnchorCount(html: string): number {
  const hrefs = Array.from(
    html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi),
  ).map((m) => m[1].trim())
  return hrefs.filter((h) => {
    if (!h || h === '#' || /^javascript:/i.test(h) || /^mailto:/i.test(h)) {
      return false
    }
    return true
  }).length
}

function hasJsAppShell(html: string): boolean {
  return (
    /id\s*=\s*["']__next["']|id\s*=\s*["']root["']|data-reactroot/i.test(html) ||
    /type\s*=\s*["']module["']/i.test(html) ||
    (/<script[^>]+src=["'][^"']+\.js["']/i.test(html) &&
      (html.match(/<script\b/gi) || []).length >= 2)
  )
}

/**
 * Content/meta detectors need title, heading, or paragraph text. When the
 * raw shell has a JS app but none of those, rendering changes the answer.
 */
function detectorNeedsMissingContent(html: string): boolean {
  if (!hasJsAppShell(html) && !/<noscript\b/i.test(html)) return false
  const hasTitle = /<title\b[^>]*>\s*\S+/i.test(html)
  const hasHeading = /<h[1-6]\b[^>]*>\s*\S/i.test(html)
  const hasParagraph = /<p\b[^>]*>\s*\S/i.test(html)
  return !(hasTitle && (hasHeading || hasParagraph))
}

/**
 * Flag render_needed only when the raw HTML would change detector answers.
 * Non-HTML payloads (CSS/JS/images mis-fetched as pages) never trigger render.
 */
export function detectRenderNeeded(html: string): RenderNeededResult {
  const looksLikeHtml = /<html\b|<body\b|<head\b/i.test(html)
  const text = bodyText(html)
  const chars = text.length
  const words = text.split(' ').filter(Boolean).length
  const anchors = crawlableAnchorCount(html)
  const hasFrameworkRoot =
    /id\s*=\s*["']__next["']|id\s*=\s*["']root["']|data-reactroot/i.test(html)
  const hasNoscript = /<noscript\b/i.test(html)
  const minWords = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderMinBodyWords
  const reasons: RenderNeededReason[] = []

  if (!looksLikeHtml) {
    return {
      needed: false,
      reasons: [],
      bodyTextChars: chars,
      bodyWords: words,
      crawlableAnchorCount: anchors,
      hasFrameworkRoot,
      hasNoscript,
    }
  }

  // Link detectors: zero crawlable anchors in served HTML → render may reveal them.
  if (anchors === 0) {
    reasons.push('zero_crawlable_anchors')
  }
  // Content detectors: thin main body → render may reveal real copy.
  if (words < minWords) {
    reasons.push('thin_body_words')
  }
  // Explicit gap: JS shell without the head/body signals content detectors read.
  if (detectorNeedsMissingContent(html)) {
    reasons.push('detector_needs_content')
  }

  return {
    needed: reasons.length > 0,
    reasons,
    bodyTextChars: chars,
    bodyWords: words,
    crawlableAnchorCount: anchors,
    hasFrameworkRoot,
    hasNoscript,
  }
}
