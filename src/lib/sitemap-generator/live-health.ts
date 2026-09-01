import { isSafePublicUrl } from '@/lib/fetch-page-content'

const USER_AGENT = 'SEORANKO-SitemapHealth/1.0'
const FETCH_TIMEOUT_MS = 8000
const MAX_CONCURRENT = 8

export interface LiveSitemapUrlHealth {
  url: string
  httpStatus: number
  /** True when the final response status is 200. */
  ok: boolean
  error?: string
}

async function fetchUrlStatus(url: string): Promise<LiveSitemapUrlHealth> {
  if (!isSafePublicUrl(url)) {
    return { url, httpStatus: 0, ok: false, error: 'URL blocked by safety policy' }
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    const ok = res.status === 200
    return { url, httpStatus: res.status, ok }
  } catch (err) {
    return {
      url,
      httpStatus: 0,
      ok: false,
      error: err instanceof Error ? err.message : 'fetch failed',
    }
  }
}

/** Fetch live HTTP status for every URL listed in the deployed sitemap. */
export async function checkLiveSitemapUrlHealth(urls: string[]): Promise<LiveSitemapUrlHealth[]> {
  const unique = Array.from(new Set(urls))
  const results: LiveSitemapUrlHealth[] = []

  for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
    const batch = unique.slice(i, i + MAX_CONCURRENT)
    const batchResults = await Promise.all(batch.map(fetchUrlStatus))
    results.push(...batchResults)
  }

  return results
}
