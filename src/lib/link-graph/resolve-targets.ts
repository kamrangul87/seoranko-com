/**
 * Resolve distinct internal link targets — status, redirect chain, final URL.
 * Spec §4 S4 — HEAD first, GET fallback, max 10 hops, cache per audit.
 */

import type { LinkTarget, RedirectHop } from './types'

const MAX_HOPS = 10
const TIMEOUT_MS = 10_000
const USER_AGENT = 'SEORANKO-LinkGraph/1.0'

export type TargetFetcher = (url: string, method: 'HEAD' | 'GET') => Promise<{
  status: number
  location: string | null
  finalRequestUrl: string
}>

export function createDefaultFetcher(): TargetFetcher {
  return async (url, method) => {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return {
      status: res.status,
      location: res.headers.get('location'),
      finalRequestUrl: url,
    }
  }
}

export interface ResolveOptions {
  fetcher?: TargetFetcher
  /** Max concurrent resolutions. */
  concurrency?: number
}

function detectLoop(chain: RedirectHop[], nextUrl: string): boolean {
  return chain.some((h) => h.url === nextUrl)
}

export async function resolveOneTarget(
  urlNormalized: string,
  fetcher: TargetFetcher,
): Promise<Omit<LinkTarget, 'canonicalTarget' | 'isIndexable' | 'robotsDisallowed' | 'inSitemap' | 'inlinkCount' | 'depth'>> {
  const chain: RedirectHop[] = []
  let current = urlNormalized
  let isRedirectLoop = false

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      let result = await fetcher(current, 'HEAD')
      if (result.status === 405 || result.status === 501) {
        result = await fetcher(current, 'GET')
      }

      if (result.status >= 300 && result.status < 400) {
        chain.push({ url: current, status: result.status })
        const loc = result.location
        if (!loc) {
          return {
            urlNormalized,
            finalStatus: result.status,
            redirectHops: chain.length,
            redirectChain: chain,
            finalUrl: current,
            isRedirectLoop: false,
          }
        }
        let next: string
        try {
          next = new URL(loc, current).href
        } catch {
          return {
            urlNormalized,
            finalStatus: result.status,
            redirectHops: chain.length,
            redirectChain: chain,
            finalUrl: current,
            isRedirectLoop: false,
          }
        }
        if (detectLoop(chain, next) || next === current) {
          isRedirectLoop = true
          chain.push({ url: next, status: 0 })
          return {
            urlNormalized,
            finalStatus: result.status,
            redirectHops: chain.length,
            redirectChain: chain,
            finalUrl: next,
            isRedirectLoop: true,
          }
        }
        current = next
        continue
      }

      return {
        urlNormalized,
        finalStatus: result.status,
        redirectHops: chain.length,
        redirectChain: chain,
        finalUrl: current,
        isRedirectLoop: false,
      }
    }

    return {
      urlNormalized,
      finalStatus: null,
      redirectHops: chain.length,
      redirectChain: chain,
      finalUrl: current,
      isRedirectLoop,
    }
  } catch {
    return {
      urlNormalized,
      finalStatus: null,
      redirectHops: chain.length,
      redirectChain: chain,
      finalUrl: current,
      isRedirectLoop: false,
    }
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export async function resolveTargets(
  urls: string[],
  opts: ResolveOptions = {},
): Promise<
  Array<
    Omit<
      LinkTarget,
      'canonicalTarget' | 'isIndexable' | 'robotsDisallowed' | 'inSitemap' | 'inlinkCount' | 'depth'
    >
  >
> {
  const fetcher = opts.fetcher || createDefaultFetcher()
  const concurrency = opts.concurrency ?? 6
  const unique = Array.from(new Set(urls))
  const cache = new Map<
    string,
    Omit<
      LinkTarget,
      'canonicalTarget' | 'isIndexable' | 'robotsDisallowed' | 'inSitemap' | 'inlinkCount' | 'depth'
    >
  >()

  await mapPool(unique, concurrency, async (url) => {
    if (cache.has(url)) return
    const resolved = await resolveOneTarget(url, fetcher)
    cache.set(url, resolved)
  })

  return unique.map((u) => cache.get(u)!)
}
