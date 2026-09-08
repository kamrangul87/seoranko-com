/**
 * Fetch options for Index Diagnosis / Link Graph live HTTP.
 * Next.js App Router caches `fetch` by default — crawls must opt out or a
 * "fresh" run can re-serve HTML from before a client deploy.
 */
export const CRAWL_FETCH_CACHE = 'no-store' as const

export function crawlFetchInit(
  init: RequestInit & { next?: { revalidate?: number | false } } = {},
): RequestInit {
  const headers = new Headers(init.headers || {})
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-cache')
  if (!headers.has('Pragma')) headers.set('Pragma', 'no-cache')
  return {
    ...init,
    headers,
    cache: CRAWL_FETCH_CACHE,
  }
}
