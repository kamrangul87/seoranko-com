// src/lib/rank-tracker.ts
// Global SERP rank tracking via DataForSEO
// Supports 14 countries + global (US proxy)
// Default: US/Global (2840)
/* eslint-disable @typescript-eslint/no-explicit-any */

// §8: normalizeUrl() before every URL comparison / Supabase write.
import { normalizeUrl, normalizeDomain } from './supabase/audit-db'

export const LOCATION_CODES: Record<string, { code: number; name: string; flag: string }> = {
  global: { code: 2840, name: 'Global / US',   flag: '🌍' },
  us:     { code: 2840, name: 'United States',  flag: '🇺🇸' },
  uk:     { code: 2826, name: 'United Kingdom', flag: '🇬🇧' },
  au:     { code: 2036, name: 'Australia',      flag: '🇦🇺' },
  ca:     { code: 2124, name: 'Canada',         flag: '🇨🇦' },
  de:     { code: 2276, name: 'Germany',        flag: '🇩🇪' },
  fr:     { code: 2250, name: 'France',         flag: '🇫🇷' },
  in:     { code: 2356, name: 'India',          flag: '🇮🇳' },
  pk:     { code: 2586, name: 'Pakistan',       flag: '🇵🇰' },
  ae:     { code: 2784, name: 'UAE',            flag: '🇦🇪' },
  sg:     { code: 2702, name: 'Singapore',      flag: '🇸🇬' },
  za:     { code: 2710, name: 'South Africa',   flag: '🇿🇦' },
  ng:     { code: 2566, name: 'Nigeria',        flag: '🇳🇬' },
  nz:     { code: 2554, name: 'New Zealand',    flag: '🇳🇿' },
  ie:     { code: 2372, name: 'Ireland',        flag: '🇮🇪' },
}

export const LOCATION_OPTIONS = Object.entries(LOCATION_CODES).map(([key, val]) => ({
  value: val.code,
  label: `${val.flag} ${val.name}`,
  key
})).filter((v, i, arr) => arr.findIndex(x => x.value === v.value) === i) // deduplicate US/global

export interface RankCheckResult {
  keyword: string
  articleUrl: string
  position: number | null       // null = not in top 100
  previousPosition: number | null
  positionChange: number | null // positive = improved, negative = dropped
  locationCode: number
  locationName: string
  checkedAt: string
  serpFeatures: string[]
  topCompetitor: string | null
  /** §10 item 1 — populated for the rank_checks log. */
  diagnostics?: RankCheckDiagnostics
}

export type MatchMethod = 'exact-url' | 'same-domain' | 'none'

/** §10 item 1 — everything the rank_checks log needs from a single check. */
export interface RankCheckDiagnostics {
  rankGroup: number | null
  rankAbsolute: number | null
  matchedUrl: string | null
  matchedDomain: string | null
  storedUrlNormalised: string
  matchMethod: MatchMethod
  organicCount: number
  apiError: string | null
}

export interface SERPItem {
  position: number
  rankGroup: number | null
  rankAbsolute: number | null
  url: string
  domain: string
  title: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDataForSEO(endpoint: string, body: object): Promise<any> {
  const email = process.env.DATAFORSEO_EMAIL
  const password = process.env.DATAFORSEO_PASSWORD
  if (!email || !password) throw new Error('DataForSEO credentials not configured')

  const credentials = Buffer.from(`${email}:${password}`).toString('base64')
  const res = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  })

  if (!res.ok) throw new Error(`DataForSEO error: ${res.status}`)
  return res.json()
}

// §10 item 1 — the exact request parameters, surfaced so the log records what
// was actually sent rather than what we assume was sent (item 3, data-in check).
export const RANK_CHECK_PARAMS = {
  endpoint: 'serp/google/organic/live/regular',
  language_code: 'en',
  device: 'desktop',
  os: 'windows',
  depth: 100
} as const

export async function checkKeywordRank(
  keyword: string,
  targetUrl: string,
  locationCode: number = 2840
): Promise<RankCheckResult> {
  // §8: normalizeUrl() on our side of the comparison. The previous code used
  // .replace('www.', '') — an unanchored replace that mangles hosts like
  // "my-www-site.com" — and never normalised at all.
  const storedNormalised = normalizeUrl(targetUrl)
  const targetDomain = normalizeDomain(targetUrl)

  const locationEntry = Object.values(LOCATION_CODES).find(l => l.code === locationCode)
  const locationName = locationEntry?.name || 'Global'

  try {
    const data = await fetchDataForSEO(RANK_CHECK_PARAMS.endpoint, [{
      keyword,
      location_code: locationCode,
      language_code: RANK_CHECK_PARAMS.language_code,
      device: RANK_CHECK_PARAMS.device,
      os: RANK_CHECK_PARAMS.os,
      depth: RANK_CHECK_PARAMS.depth
    }])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allItems = data?.tasks?.[0]?.result?.[0]?.items || []

    // Keep BOTH rank fields. rank_group is the organic position; rank_absolute
    // counts ads and snippets too, so it reads higher than what a user sees.
    // Item 2/3 ground truth decides which we report — until then, log both.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const organicItems: SERPItem[] = allItems
      .filter((item: any) => item.type === 'organic')
      .map((item: any) => ({
        position: item.rank_group ?? item.rank_absolute,
        rankGroup: item.rank_group ?? null,
        rankAbsolute: item.rank_absolute ?? null,
        url: item.url || '',
        domain: item.domain || '',
        title: item.title || ''
      }))

    // §10 item 4 — matching. Prefer the exact tracked page; fall back to the
    // same registered domain. The old `domain.includes(targetDomain)` test
    // matched "notautodun.com" for "autodun.com", and matched the homepage
    // when a specific article was being tracked.
    let ourResult = organicItems.find(r => normalizeUrl(r.url) === storedNormalised)
    let matchMethod: MatchMethod = ourResult ? 'exact-url' : 'none'

    if (!ourResult) {
      ourResult = organicItems.find(r => normalizeDomain(r.url || r.domain) === targetDomain)
      if (ourResult) matchMethod = 'same-domain'
    }

    const serpFeatures = Array.from(new Set(
      allItems
        .filter((item: any) => item.type !== 'organic')
        .map((item: any) => item.type as string)
    )) as string[]

    const topCompetitor = organicItems.find(r =>
      r.position === 1 && normalizeDomain(r.url || r.domain) !== targetDomain
    )?.domain || null

    return {
      keyword,
      articleUrl: targetUrl,
      position: ourResult?.position ?? null,
      previousPosition: null,
      positionChange: null,
      locationCode,
      locationName,
      checkedAt: new Date().toISOString(),
      serpFeatures,
      topCompetitor,
      diagnostics: {
        rankGroup: ourResult?.rankGroup ?? null,
        rankAbsolute: ourResult?.rankAbsolute ?? null,
        matchedUrl: ourResult?.url ?? null,
        matchedDomain: ourResult?.domain ?? null,
        storedUrlNormalised: storedNormalised,
        matchMethod,
        organicCount: organicItems.length,
        apiError: null
      }
    }
  } catch (err) {
    return {
      keyword,
      articleUrl: targetUrl,
      position: null,
      previousPosition: null,
      positionChange: null,
      locationCode,
      locationName,
      checkedAt: new Date().toISOString(),
      serpFeatures: [],
      topCompetitor: null,
      diagnostics: {
        rankGroup: null,
        rankAbsolute: null,
        matchedUrl: null,
        matchedDomain: null,
        storedUrlNormalised: storedNormalised,
        matchMethod: 'none',
        organicCount: 0,
        // A null rank from an API failure is not the same as "not ranking".
        apiError: err instanceof Error ? err.message : String(err)
      }
    }
  }
}

export async function checkBatchRanks(
  articles: Array<{
    keyword: string
    url: string
    previousPosition?: number | null
    locationCode?: number
  }>
): Promise<RankCheckResult[]> {
  const results: RankCheckResult[] = []

  for (let i = 0; i < articles.length; i += 5) {
    const batch = articles.slice(i, i + 5)

    const batchResults = await Promise.all(
      batch.map(a => checkKeywordRank(a.keyword, a.url, a.locationCode || 2840))
    )

    batchResults.forEach((result, idx) => {
      const prev = batch[idx].previousPosition ?? null
      result.previousPosition = prev
      if (result.position !== null && prev !== null) {
        result.positionChange = prev - result.position
      }
    })

    results.push(...batchResults)

    if (i + 5 < articles.length) {
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  return results
}

export function positionLabel(position: number | null): string {
  if (position === null) return 'Not ranked'
  if (position === 1) return '#1 🏆'
  if (position <= 3) return `#${position} Top 3`
  if (position <= 10) return `#${position} Page 1`
  if (position <= 20) return `#${position} Page 2`
  if (position <= 30) return `#${position} Page 3`
  return `#${position}`
}

export function movementLabel(change: number | null): string {
  if (change === null) return '—'
  if (change > 0) return `↑${change}`
  if (change < 0) return `↓${Math.abs(change)}`
  return '→'
}
