/**
 * Render-needed detection for the crawl render guard.
 * Product thresholds live in product-decisions (body text < 200 chars, etc.).
 */

import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

const FRAMEWORK_ROOT_RE =
  /id\s*=\s*["']__next["']|id\s*=\s*["']root["']|data-reactroot/i

export type RenderNeededReason =
  | 'thin_body_text'
  | 'framework_root_thin'
  | 'noscript_warning'

export type RenderNeededResult = {
  needed: boolean
  reasons: RenderNeededReason[]
  bodyTextChars: number
  hasFrameworkRoot: boolean
  hasNoscript: boolean
}

function bodyTextChars(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length
}

/**
 * Flag render_needed when served HTML looks like a pre-hydration shell.
 */
export function detectRenderNeeded(html: string): RenderNeededResult {
  const minChars = FIX_STRATEGY_PRODUCT_DECISIONS.crawlRenderMinBodyTextChars
  const chars = bodyTextChars(html)
  const hasFrameworkRoot = FRAMEWORK_ROOT_RE.test(html)
  const hasNoscript = /<noscript\b/i.test(html)
  const reasons: RenderNeededReason[] = []

  if (chars < minChars) {
    reasons.push('thin_body_text')
  }
  if (hasFrameworkRoot && chars < minChars * 2) {
    reasons.push('framework_root_thin')
  }
  // Noscript that warns about enabling JS / app shell
  if (
    hasNoscript &&
    /enable\s+javascript|requires?\s+javascript|you\s+need\s+to\s+enable/i.test(html)
  ) {
    reasons.push('noscript_warning')
  }

  return {
    needed: reasons.length > 0,
    reasons,
    bodyTextChars: chars,
    hasFrameworkRoot,
    hasNoscript,
  }
}
