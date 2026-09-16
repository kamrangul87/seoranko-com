/**
 * Topic 26 — structural signals from a fetched response (headers + HTML tree).
 * Uses the shared HTML parser — not regex on page prose.
 */

import { normalizeFixStrategyUrl } from '../shared/url-normalize'

/** Re-export shared helpers so topic-26 callers keep a single import surface. */
export {
  extractHtmlCanonical,
  hasNoindexDirective,
  isSelfCanonical,
} from '../shared/response-signals'

export function isNonHtmlIndexableResource(
  contentType: string | null,
  url: string,
): boolean {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('application/pdf')) return true
  if (ct.includes('image/')) return true
  if (ct.includes('application/xml') && url.toLowerCase().endsWith('.xml')) {
    return false
  }
  // URL heuristic only when content-type absent (fixture convenience).
  if (!ct && /\.pdf(\?|$)/i.test(url)) return true
  return false
}

// Keep normalize available for local tests that imported via this module path.
export { normalizeFixStrategyUrl }
