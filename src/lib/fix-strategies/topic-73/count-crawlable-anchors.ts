import {
  extractAnchors,
  isSkippableHref,
} from '@/lib/fix-strategies/topic-1/extract-anchors'

/**
 * Count `<a href>` values Googlebot can follow without executing JS:
 * non-skippable http(s) or root-relative / path-relative URLs.
 * Fragments, mailto, javascript:, data: do not count.
 */
export function countCrawlableAnchors(html: string): number {
  let n = 0
  for (const a of extractAnchors(html)) {
    if (isSkippableHref(a.href)) continue
    const h = a.href.trim()
    const lower = h.toLowerCase()
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      n++
      continue
    }
    if (h.startsWith('/') || h.startsWith('./') || h.startsWith('../')) {
      n++
      continue
    }
    // Bare path segment (no scheme) — still crawlable as a relative URL.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(h)) {
      n++
    }
  }
  return n
}

export function isHomepageUrl(pageUrl: string, origin: string): boolean {
  try {
    const page = new URL(pageUrl)
    const base = new URL(origin)
    if (page.host !== base.host) return false
    const path = page.pathname.replace(/\/+$/, '') || '/'
    return path === '/'
  } catch {
    return false
  }
}
