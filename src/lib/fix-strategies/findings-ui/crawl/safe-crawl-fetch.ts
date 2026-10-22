/**
 * Safe fetch for findings crawl: resolve+IP check on every hop, crawler UA,
 * manual redirect following (refuse public→private).
 *
 * Never uses redirect:'follow' — undici throws on loops. Max 10 hops; URL
 * seen twice in the chain → redirect-loop (full chain in error).
 */

import { assertSafePublicUrlResolved } from '@/lib/assert-safe-public-url-resolved'
import { isSafePublicUrl } from '@/lib/fetch-page-content'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'
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

/** Googlebot hard limit — match hop-recording-fetch default. */
const MAX_REDIRECTS = 10

/**
 * GET with redirect:manual; each Location target must pass
 * assertSafePublicUrlResolved (string gate + DNS → public IP).
 */
export async function safeCrawlFetch(
  startUrl: string,
  opts?: { timeoutMs?: number; headers?: HeadersInit },
): Promise<SafeFetchResult> {
  const hops: string[] = []
  const visited = new Set<string>()
  let current = startUrl

  if (!isSafePublicUrl(current) || !(await assertSafePublicUrlResolved(current))) {
    return {
      ok: false,
      error: 'URL blocked by assertSafePublicUrlResolved (private/metadata/non-http/DNS)',
      url: startUrl,
      redirectHops: hops,
    }
  }

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const key = normalizeFixStrategyUrl(current) ?? current.toLowerCase()
    if (visited.has(key)) {
      hops.push(current)
      return {
        ok: false,
        error: `Redirect loop: ${hops.join(' → ')}`,
        url: startUrl,
        redirectHops: hops,
      }
    }
    visited.add(key)
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
        let next: string
        try {
          next = new URL(loc, current).toString()
        } catch {
          return {
            ok: false,
            error: `Redirect ${res.status} with unparseable Location`,
            url: startUrl,
            redirectHops: hops,
          }
        }
        const nextKey = normalizeFixStrategyUrl(next) ?? next.toLowerCase()
        if (visited.has(nextKey)) {
          hops.push(next)
          return {
            ok: false,
            error: `Redirect loop: ${hops.join(' → ')}`,
            url: startUrl,
            redirectHops: hops,
          }
        }
        if (!isSafePublicUrl(next) || !(await assertSafePublicUrlResolved(next))) {
          return {
            ok: false,
            error: `Redirect hop refused by assertSafePublicUrlResolved: ${next}`,
            url: startUrl,
            redirectHops: [...hops, next],
          }
        }
        if (i === MAX_REDIRECTS) {
          return {
            ok: false,
            error: `Too many redirects (>${MAX_REDIRECTS}): ${[...hops, next].join(' → ')}`,
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
    error: `Too many redirects (>${MAX_REDIRECTS}): ${hops.join(' → ')}`,
    url: startUrl,
    redirectHops: hops,
  }
}
