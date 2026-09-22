/**
 * Discover same-host URLs from robots Sitemap: + /sitemap.xml, then expand
 * via the crawlable link graph during ticks (see orchestrator).
 */

import { CRAWL_MAX_DISCOVERED } from './constants'
import { isSafePublicUrl } from '@/lib/fetch-page-content'
import {
  isDisallowedByRobots,
  parseRobotsForCrawler,
  type RobotsRules,
} from './crawler-identity'
import { safeCrawlFetch } from './safe-crawl-fetch'

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

async function fetchText(
  url: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  if (!isSafePublicUrl(url)) {
    return { ok: false, status: 0, text: '' }
  }
  const res = await safeCrawlFetch(url)
  if (!res.ok) return { ok: false, status: 0, text: '' }
  return {
    ok: res.status >= 200 && res.status < 400,
    status: res.status,
    text: res.text,
  }
}

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)).map((m) =>
    m[1]!.trim(),
  )
}

export type DiscoverySeedCounts = {
  /** Locs from robots.txt Sitemap: documents. */
  fromRobotsSitemaps: number
  /** Locs from fallback /sitemap.xml when robots yielded none. */
  fromSitemapFallback: number
  /** Homepage always seeded. */
  fromHomepage: number
  /** Added later from crawlable <a href> during ticks. */
  fromLinkGraph: number
}

/**
 * Seed frontier from robots.txt Sitemap: records and/or /sitemap.xml, plus
 * the homepage. Link-graph expansion happens during the crawl (not here).
 * Every fetch uses assertSafePublicUrlResolved (DNS→IP, incl. redirect hops)
 * and SEORANKOBot UA; robots.txt Disallow for our agent is respected.
 */
export async function discoverSameHostUrls(origin: string): Promise<{
  urls: string[]
  foundTotal: number
  skippedOffHost: number
  skippedRobots: number
  capped: boolean
  notes: string[]
  seeds: DiscoverySeedCounts
  robotsRules: RobotsRules
}> {
  const originUrl = origin.replace(/\/$/, '')
  const notes: string[] = []
  const candidates = new Set<string>()
  let skippedOffHost = 0
  let skippedRobots = 0
  let fromRobotsSitemaps = 0
  let fromSitemapFallback = 0

  const robots = await fetchText(`${originUrl}/robots.txt`)
  const robotsRules: RobotsRules = robots.ok
    ? parseRobotsForCrawler(robots.text)
    : { disallows: [], allows: [] }

  if (robots.ok) {
    const sitemapLines = robots.text
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter((l) => /^sitemap\s*:/i.test(l))
      .map((l) => l.split(/:\s*/).slice(1).join(':').trim())
      .filter(Boolean)
    for (const sm of sitemapLines) {
      if (!sameHost(sm, originUrl) || !isSafePublicUrl(sm)) {
        skippedOffHost++
        continue
      }
      const doc = await fetchText(sm)
      if (!doc.ok) {
        notes.push(`sitemap fetch failed: ${sm}`)
        continue
      }
      for (const loc of extractLocs(doc.text)) {
        if (!sameHost(loc, originUrl) || !isSafePublicUrl(loc)) {
          skippedOffHost++
          continue
        }
        if (isDisallowedByRobots(loc, robotsRules)) {
          skippedRobots++
          continue
        }
        const clean = loc.split('#')[0]!
        if (!candidates.has(clean)) {
          candidates.add(clean)
          fromRobotsSitemaps++
        }
      }
    }
  }

  if (candidates.size === 0) {
    const sm = await fetchText(`${originUrl}/sitemap.xml`)
    if (sm.ok) {
      for (const loc of extractLocs(sm.text)) {
        if (!sameHost(loc, originUrl) || !isSafePublicUrl(loc)) {
          skippedOffHost++
          continue
        }
        if (isDisallowedByRobots(loc, robotsRules)) {
          skippedRobots++
          continue
        }
        const clean = loc.split('#')[0]!
        if (!candidates.has(clean)) {
          candidates.add(clean)
          fromSitemapFallback++
        }
      }
    } else {
      notes.push(`fallback /sitemap.xml failed (${sm.status})`)
    }
  }

  // Always include homepage when robots allows
  const home = `${originUrl}/`
  let fromHomepage = 0
  if (isDisallowedByRobots(home, robotsRules)) {
    skippedRobots++
    notes.push('homepage disallowed by robots.txt for SEORANKO crawler')
  } else if (isSafePublicUrl(home)) {
    if (!candidates.has(home)) candidates.add(home)
    fromHomepage = 1
  }

  const foundTotal = candidates.size
  const capped = foundTotal > CRAWL_MAX_DISCOVERED
  const urls = Array.from(candidates).slice(0, CRAWL_MAX_DISCOVERED)
  if (capped) {
    notes.push(
      `discovery capped at ${CRAWL_MAX_DISCOVERED}: found ${foundTotal} same-host URLs, enqueued ${urls.length}, ${foundTotal - urls.length} not crawled`,
    )
  }

  return {
    urls,
    foundTotal,
    skippedOffHost,
    skippedRobots,
    capped,
    notes,
    seeds: {
      fromRobotsSitemaps,
      fromSitemapFallback,
      fromHomepage,
      fromLinkGraph: 0,
    },
    robotsRules,
  }
}

/**
 * Extract same-host absolute http(s) URLs from crawlable <a href> in HTML.
 */
export function extractSameHostLinks(
  html: string,
  pageUrl: string,
  origin: string,
): string[] {
  const originHost = hostOf(origin)
  if (!originHost) return []
  const out = new Set<string>()
  const re = /<a\s[^>]*href\s*=\s*(["'])([^"']+)\1/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = m[2]!.trim()
    if (!raw || raw.startsWith('#') || raw.toLowerCase().startsWith('javascript:')) {
      continue
    }
    let abs: string
    try {
      abs = new URL(raw, pageUrl).href
    } catch {
      continue
    }
    if (hostOf(abs) !== originHost) continue
    if (!isSafePublicUrl(abs)) continue
    out.add(abs.split('#')[0]!)
  }
  return Array.from(out)
}
