// src/lib/rank-tracker.ts
// Global SERP rank tracking via DataForSEO
// Supports 14 countries + global (US proxy)
// Default: US/Global (2840)
/* eslint-disable @typescript-eslint/no-explicit-any */

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
}

export interface SERPItem {
  position: number
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

export async function checkKeywordRank(
  keyword: string,
  targetUrl: string,
  locationCode: number = 2840
): Promise<RankCheckResult> {
  const targetDomain = (() => {
    try {
      return new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`)
        .hostname.replace('www.', '')
    } catch {
      return targetUrl.replace('www.', '').split('/')[0]
    }
  })()

  const locationEntry = Object.values(LOCATION_CODES).find(l => l.code === locationCode)
  const locationName = locationEntry?.name || 'Global'

  try {
    const data = await fetchDataForSEO('serp/google/organic/live/regular', [{
      keyword,
      location_code: locationCode,
      language_code: 'en',
      device: 'desktop',
      os: 'windows',
      depth: 100
    }])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allItems = data?.tasks?.[0]?.result?.[0]?.items || []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const organicItems: SERPItem[] = allItems
      .filter((item: any) => item.type === 'organic')
      .map((item: any) => ({
        position: item.rank_absolute,
        url: item.url || '',
        domain: item.domain || '',
        title: item.title || ''
      }))

    const ourResult = organicItems.find(r =>
      r.domain.includes(targetDomain) || r.url.includes(targetDomain)
    )

    const serpFeatures = Array.from(new Set(
      allItems
        .filter((item: any) => item.type !== 'organic')
        .map((item: any) => item.type as string)
    )) as string[]

    const topCompetitor = organicItems.find(r =>
      r.position === 1 && !r.domain.includes(targetDomain)
    )?.domain || null

    return {
      keyword,
      articleUrl: targetUrl,
      position: ourResult?.position || null,
      previousPosition: null,
      positionChange: null,
      locationCode,
      locationName,
      checkedAt: new Date().toISOString(),
      serpFeatures,
      topCompetitor
    }
  } catch {
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
      topCompetitor: null
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
