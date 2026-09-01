import { normalizeDomain, normalizeUrl } from '@/lib/supabase/audit-db'
import { isSafePublicUrl } from '@/lib/fetch-page-content'
import { matchRobotsForUrl } from './robots-parser'
import { discoverSitemapUrls, extractInternalLinks } from './sitemap-discovery'
import type {
  CrawlCoverage,
  CrawlExcludeReason,
  CrawlTerminationReason,
  DiscoveredUrlRecord,
  ExcludedUrlRecord,
  UrlDiscoverySource,
} from './types'

const USER_AGENT = 'SEORANKO-IndexDiagnosis/1.0'
const MAX_DISCOVERED = 200
const MAX_FETCHED = 50
const MAX_DEPTH = 4
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 8000

export interface FetchedPage {
  url: string
  finalUrl: string
  httpStatus: number
  html: string
  depth: number
  redirectCount: number
  xRobotsTag: string
  metaRobots: string
  canonicalUrl: string
  canonicalTags: string[]
  fetchError: string | null
  timedOut: boolean
}

export interface CrawlResult {
  coverage: CrawlCoverage
  fetchedPages: FetchedPage[]
  robotsTxt: string
  siteHost: string
  homepageUrl: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

async function fetchRobotsTxt(baseUrl: string): Promise<{ text: string; evidence: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { text: '', evidence: `robots.txt HTTP ${res.status}` }
    const text = await res.text()
    return { text, evidence: `robots.txt fetched (${text.length} bytes)` }
  } catch (e) {
    return { text: '', evidence: `robots.txt fetch failed: ${e instanceof Error ? e.message : 'error'}` }
  }
}

async function fetchWithRedirects(url: string): Promise<{
  finalUrl: string
  status: number
  html: string
  redirectCount: number
  xRobotsTag: string
  timedOut: boolean
  error: string | null
}> {
  let current = url
  let redirectCount = 0
  let lastStatus = 0
  let xRobotsTag = ''

  try {
    while (redirectCount <= MAX_REDIRECTS) {
      const res = await fetch(current, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'manual',
      })
      lastStatus = res.status
      xRobotsTag = res.headers.get('x-robots-tag') || ''

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) break
        current = new URL(loc, current).href
        redirectCount++
        continue
      }

      const html = await res.text()
      return {
        finalUrl: normalizeUrl(current),
        status: lastStatus,
        html,
        redirectCount,
        xRobotsTag,
        timedOut: false,
        error: null,
      }
    }
    return {
      finalUrl: normalizeUrl(current),
      status: lastStatus,
      html: '',
      redirectCount,
      xRobotsTag,
      timedOut: false,
      error: `Redirect chain exceeded ${MAX_REDIRECTS} hops`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed'
    const timedOut = /abort|timeout/i.test(msg)
    return {
      finalUrl: normalizeUrl(current),
      status: 0,
      html: '',
      redirectCount,
      xRobotsTag,
      timedOut,
      error: msg,
    }
  }
}

function parseMetaRobots(html: string): string {
  const m =
    html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']robots["']/i)
  return m?.[1]?.trim() || ''
}

function parseCanonicalTags(html: string): { urls: string[]; primary: string } {
  const matches = Array.from(
    html.matchAll(/<link[^>]+rel=["']canonical["'][^>]*>/gi),
  )
  const urls: string[] = []
  for (const tag of matches) {
    const href = tag[0].match(/href=["']([^"']+)["']/i)?.[1]?.trim()
    if (href) urls.push(href)
  }
  return { urls, primary: urls[0] || '' }
}

function initExcludeCounts(): Record<CrawlExcludeReason, number> {
  return {
    ROBOTS_DISALLOWED: 0,
    META_NOINDEX: 0,
    X_ROBOTS_NOINDEX: 0,
    NON_200: 0,
    DEPTH_LIMIT: 0,
    TIMEOUT: 0,
    PLAN_LIMIT: 0,
    REDIRECT_CHAIN: 0,
    NOT_REACHED: 0,
  }
}

export async function runIndexCrawl(seedUrl: string): Promise<CrawlResult> {
  const normalizedSeed = normalizeUrl(seedUrl.startsWith('http') ? seedUrl : `https://${seedUrl}`)
  if (!isSafePublicUrl(normalizedSeed)) {
    throw new Error('URL is not allowed for index diagnosis crawl')
  }

  const domain = normalizeDomain(normalizedSeed)
  const siteHost = hostOf(normalizedSeed)
  const baseUrl = `https://${domain.replace(/^www\./, '')}`

  const { text: robotsTxt, evidence: robotsEvidence } = await fetchRobotsTxt(baseUrl)
  const sitemap = await discoverSitemapUrls(baseUrl, robotsTxt)

  const discovered = new Map<string, DiscoveredUrlRecord>()
  const addDiscovered = (url: string, source: UrlDiscoverySource, depth: number | null) => {
    const u = normalizeUrl(url)
    if (!u.startsWith('http')) return
    try {
      const h = hostOf(u).replace(/^www\./, '')
      if (h !== siteHost.replace(/^www\./, '')) return
    } catch {
      return
    }
    const existing = discovered.get(u)
    if (!existing) {
      discovered.set(u, { url: u, sources: [source], depth })
      return
    }
    if (!existing.sources.includes(source)) {
      if (existing.sources.length === 1 && source !== existing.sources[0]) {
        existing.sources = ['both']
      } else if (!existing.sources.includes('both')) {
        existing.sources.push(source)
      }
    }
    if (depth != null && (existing.depth == null || depth < existing.depth)) {
      existing.depth = depth
    }
  }

  const fetchedPages: FetchedPage[] = []
  const fetchedSet = new Set<string>()
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizedSeed, depth: 0 }]
  const queued = new Set<string>([normalizedSeed])

  addDiscovered(normalizedSeed, 'seed', 0)
  for (const u of sitemap.urls.slice(0, MAX_DISCOVERED)) {
    addDiscovered(u, 'sitemap', null)
    if (u !== normalizedSeed && !queued.has(u)) {
      queue.push({ url: u, depth: 1 })
      queued.add(u)
    }
  }

  const excluded: ExcludedUrlRecord[] = []
  const excludedByReason = initExcludeCounts()
  const pushExcluded = (url: string, reason: CrawlExcludeReason, evidence: string) => {
    excluded.push({ url, reason, evidence })
    excludedByReason[reason]++
  }

  let terminationReason: CrawlTerminationReason = 'QUEUE_EMPTY'
  let terminationEvidence = 'Crawl queue exhausted'

  while (queue.length > 0 && fetchedPages.length < MAX_FETCHED) {
    if (discovered.size >= MAX_DISCOVERED) {
      terminationReason = 'DISCOVERY_CAP_REACHED'
      terminationEvidence = `Discovery cap ${MAX_DISCOVERED} URLs reached`
      break
    }

    const { url, depth } = queue.shift()!
    queued.delete(url)

    if (depth > MAX_DEPTH) {
      if (!fetchedSet.has(url)) {
        pushExcluded(url, 'DEPTH_LIMIT', `Depth ${depth} exceeds max ${MAX_DEPTH}`)
      }
      continue
    }

    const robotsMatch = matchRobotsForUrl(robotsTxt, url)
    if (!robotsMatch.allowed) {
      pushExcluded(url, 'ROBOTS_DISALLOWED', robotsMatch.evidence)
      continue
    }

    if (fetchedSet.has(url)) continue

    const fetchResult = await fetchWithRedirects(url)
    fetchedSet.add(url)
    addDiscovered(url, url === normalizedSeed ? 'seed' : 'links', depth)

    if (fetchResult.timedOut) {
      pushExcluded(url, 'TIMEOUT', `Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${fetchResult.error}`)
      continue
    }

    if (fetchResult.error?.includes('Redirect chain')) {
      pushExcluded(url, 'REDIRECT_CHAIN', fetchResult.error)
      continue
    }

    if (fetchResult.status < 200 || fetchResult.status >= 300) {
      pushExcluded(url, 'NON_200', `HTTP ${fetchResult.status} at ${fetchResult.finalUrl}`)
      continue
    }

    const metaRobots = parseMetaRobots(fetchResult.html)
    const canon = parseCanonicalTags(fetchResult.html)

    const page: FetchedPage = {
      url,
      finalUrl: fetchResult.finalUrl,
      httpStatus: fetchResult.status,
      html: fetchResult.html,
      depth,
      redirectCount: fetchResult.redirectCount,
      xRobotsTag: fetchResult.xRobotsTag,
      metaRobots,
      canonicalUrl: canon.primary,
      canonicalTags: canon.urls,
      fetchError: null,
      timedOut: false,
    }
    fetchedPages.push(page)

    // Extract links for BFS (only from successfully fetched pages)
    const links = extractInternalLinks(fetchResult.html, fetchResult.finalUrl, siteHost)
    for (const link of links) {
      if (discovered.size >= MAX_DISCOVERED) break
      const linkSource: UrlDiscoverySource = sitemap.urls.includes(link) ? 'both' : 'links'
      addDiscovered(link, discovered.has(link) ? linkSource : 'links', depth + 1)
      if (!queued.has(link) && !fetchedSet.has(link) && depth + 1 <= MAX_DEPTH) {
        queue.push({ url: link, depth: depth + 1 })
        queued.add(link)
      }
    }
  }

  if (fetchedPages.length >= MAX_FETCHED) {
    terminationReason = 'FETCH_BUDGET_EXHAUSTED'
    terminationEvidence = `Fetch budget ${MAX_FETCHED} pages exhausted`
    for (const u of Array.from(discovered.keys())) {
      if (!fetchedSet.has(u) && !excluded.some((e) => e.url === u)) {
        pushExcluded(u, 'PLAN_LIMIT', `Not fetched — plan limit ${MAX_FETCHED} pages per run`)
      }
    }
  } else if (queue.length > 0 && terminationReason === 'QUEUE_EMPTY') {
    terminationReason = 'PLAN_LIMIT_REACHED'
    terminationEvidence = `${queue.length} URLs remained in queue when crawl stopped`
    for (const item of queue) {
      if (!fetchedSet.has(item.url) && !excluded.some((e) => e.url === item.url)) {
        pushExcluded(item.url, 'NOT_REACHED', `Queued at depth ${item.depth} but not reached before crawl ended`)
      }
    }
  }

  // Mark remaining discovered-but-not-fetched
  for (const u of Array.from(discovered.keys())) {
    if (fetchedSet.has(u)) continue
    if (excluded.some((e) => e.url === u)) continue
    pushExcluded(u, 'NOT_REACHED', 'Discovered but not fetched in this crawl pass')
  }

  const sitemapSet = new Set(sitemap.urls.map(normalizeUrl))
  const linkDiscovered = new Set(
    Array.from(discovered.values())
      .filter((d) => d.sources.includes('links') || d.sources.includes('both'))
      .map((d) => d.url),
  )

  const sitemapOnlyUrls = Array.from(sitemapSet).filter((u) => !linkDiscovered.has(u)).slice(0, 100)
  const linkedOnlyUrls = Array.from(linkDiscovered).filter((u) => !sitemapSet.has(u)).slice(0, 100)

  const sourceCounts = { sitemap: 0, links: 0, both: 0, seed: 0 }
  for (const d of Array.from(discovered.values())) {
    for (const s of d.sources) sourceCounts[s]++
  }

  const coverage: CrawlCoverage = {
    domain,
    seedUrl: normalizedSeed,
    discoveredCount: discovered.size,
    fetchedCount: fetchedPages.length,
    excluded,
    excludedByReason,
    terminationReason,
    terminationEvidence,
    discoverySources: sourceCounts,
    sitemapOnlyUrls,
    linkedOnlyUrls,
    robotsTxtFetched: robotsTxt.length > 0,
    robotsTxtEvidence: robotsEvidence,
  }

  return {
    coverage,
    fetchedPages,
    robotsTxt,
    siteHost,
    homepageUrl: normalizedSeed,
  }
}
