/**
 * Safe fetch for findings crawl: isSafePublicUrl on every hop, crawler UA,
 * manual redirect following (refuse public→private).
 */

import { isSafePublicUrl } from '@/lib/fetch-page-content'
import { SEORANKO_CRAWLER_HEADERS } from './crawler-identity'

export type SafeFetchResult =
  | {
      ok: true
      status: number
      url: string
      finalUrl: string
      text: string
      headers: Headers
      redirectHops: string[]
    }
  | {
      ok: false
      error: string
      url: string
      redirectHops: string[]
    }

const MAX_REDIRECTS = 8

/**
 * GET with redirect:manual; each Location target must pass isSafePublicUrl.
 */
export async function safeCrawlFetch(
  startUrl: string,
  opts?: { timeoutMs?: number; headers?: HeadersInit },
): Promise<SafeFetchResult> {
  const hops: string[] = []
  let current = startUrl

  if (!isSafePublicUrl(current)) {
    return {
      ok: false,
      error: 'URL blocked by isSafePublicUrl (private/metadata/non-http)',
      url: startUrl,
      redirectHops: hops,
    }
  }

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    hops.push(current)
    try {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { ...SEORANKO_CRAWLER_HEADERS, ...(opts?.headers ?? {}) },
        signal: AbortSignal.timeout(opts?.timeoutMs ?? 20_000),
        cache: 'no-store',
      })

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) {
          return {
            ok: false,
            error: `Redirect ${res.status} without Location`,
            url: startUrl,
            redirectHops: hops,
          }
        }
        const next = new URL(loc, current).toString()
        if (!isSafePublicUrl(next)) {
          return {
            ok: false,
            error: `Redirect hop refused by isSafePublicUrl: ${next}`,
            url: startUrl,
            redirectHops: [...hops, next],
          }
        }
        current = next
        continue
      }

      const text = await res.text()
      return {
        ok: true,
        status: res.status,
        url: startUrl,
        finalUrl: current,
        text,
        headers: res.headers,
        redirectHops: hops,
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        url: startUrl,
        redirectHops: hops,
      }
    }
  }

  return {
    ok: false,
    error: `Too many redirects (>${MAX_REDIRECTS})`,
    url: startUrl,
    redirectHops: hops,
  }
}
