/**
 * Deterministic representative page_url for rollup / group findings.
 * Rule: shortest URL path, then lexicographic full URL. Never crawl order.
 */

export function urlPathnameLength(url: string): number {
  try {
    return new URL(url).pathname.length
  } catch {
    const path = url.includes('://') ? url : url.startsWith('/') ? url : `/${url}`
    const noQuery = path.split('?')[0] ?? path
    try {
      return new URL(noQuery).pathname.length
    } catch {
      return noQuery.length
    }
  }
}

/** Ascending: shorter pathname first, then lexicographic URL. */
export function compareUrlsForRepresentative(a: string, b: string): number {
  const la = urlPathnameLength(a)
  const lb = urlPathnameLength(b)
  if (la !== lb) return la - lb
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Deduped member URLs in representative order. */
export function sortMemberUrls(urls: readonly string[]): string[] {
  return Array.from(new Set(urls.filter(Boolean))).sort(compareUrlsForRepresentative)
}

/** Fixed-rule representative from a member set (shortest path, then lex). */
export function selectRepresentativePageUrl(urls: readonly string[]): string | null {
  const sorted = sortMemberUrls(urls)
  return sorted[0] ?? null
}
