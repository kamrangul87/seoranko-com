/**
 * Discover same-host URLs from robots Sitemap: + /sitemap.xml.
 */

import { CRAWL_MAX_DISCOVERED } from './constants'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function sameHost(a: string, b: string): boolean {
  return hostOf(a) === hostOf(b) && hostOf(a) !== ''
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'SEORANKO-FixStrategiesCrawl/1.0' },
      cache: 'no-store',
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch {
    return { ok: false, status: 0, text: '' }
  }
}

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)).map((m) =>
    m[1]!.trim(),
  )
}

/**
 * Returns absolute http(s) URLs on the same host as `origin`.
 * Applies CRAWL_MAX_DISCOVERED at enqueue time — capped runs are partial.
 */
export async function discoverSameHostUrls(origin: string): Promise<{
  /** Enqueued subset (≤ CRAWL_MAX_DISCOVERED). */
  urls: string[]
  /** Total same-host locs found before the product cap. */
  foundTotal: number
  skippedOffHost: number
  capped: boolean
  notes: string[]
}> {
  const originUrl = origin.replace(/\/$/, '')
  const notes: string[] = []
  const candidates = new Set<string>()
  let skippedOffHost = 0

  const robots = await fetchText(`${originUrl}/robots.txt`)
  if (robots.ok) {
    const sitemapLines = robots.text
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter((l) => /^sitemap\s*:/i.test(l))
      .map((l) => l.split(/:\s*/).slice(1).join(':').trim())
      .filter(Boolean)
    for (const sm of sitemapLines) {
      if (!sameHost(sm, originUrl)) {
        skippedOffHost++
        continue
      }
      const doc = await fetchText(sm)
      if (!doc.ok) {
        notes.push(`sitemap fetch failed: ${sm} (${doc.status})`)
        continue
      }
      for (const loc of extractLocs(doc.text)) {
        if (!sameHost(loc, originUrl)) {
          skippedOffHost++
          continue
        }
        candidates.add(loc.split('#')[0]!)
      }
    }
  }

  if (candidates.size === 0) {
    const sm = await fetchText(`${originUrl}/sitemap.xml`)
    if (sm.ok) {
      for (const loc of extractLocs(sm.text)) {
        if (!sameHost(loc, originUrl)) {
          skippedOffHost++
          continue
        }
        candidates.add(loc.split('#')[0]!)
      }
    } else {
      notes.push(`fallback /sitemap.xml failed (${sm.status})`)
    }
  }

  // Always include homepage
  candidates.add(`${originUrl}/`)

  const foundTotal = candidates.size
  const capped = foundTotal > CRAWL_MAX_DISCOVERED
  const urls = Array.from(candidates).slice(0, CRAWL_MAX_DISCOVERED)
  if (capped) {
    notes.push(
      `discovery capped at ${CRAWL_MAX_DISCOVERED}: found ${foundTotal} same-host URLs, enqueued ${urls.length}, ${foundTotal - urls.length} not crawled`,
    )
  }

  return { urls, foundTotal, skippedOffHost, capped, notes }
}
