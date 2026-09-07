/**
 * Collapse GSC page/date rows that share the same post-normalizeUrl key
 * before url_metrics_daily upsert. Postgres rejects duplicate conflict
 * targets inside a single ON CONFLICT DO UPDATE statement.
 */

import { normalizeUrl } from '@/lib/supabase/audit-db'
import { isGscDateFinal } from '@/lib/gsc/client'

export type GscPageDateRow = {
  page: string
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type UrlMetricsUpsertRow = {
  site_id: string
  url: string
  date: string
  clicks: number
  impressions: number
  ctr: number
  avg_position: number
  query_count: number
  is_final: boolean
  ingested_at: string
}

export type MetricsDedupeCollision = {
  url: string
  date: string
  rawPages: string[]
  mergedClicks: number
  mergedImpressions: number
}

export type MetricsDedupeResult = {
  rows: UrlMetricsUpsertRow[]
  collisions: MetricsDedupeCollision[]
  inputCount: number
  outputCount: number
}

function safeNormalize(page: string): string {
  try {
    return normalizeUrl(page)
  } catch {
    return page
  }
}

/**
 * Map GSC rows → url_metrics_daily upserts, merging duplicates on (url, date)
 * after normalizeUrl (www / trailing slash / query variants collapse).
 * Clicks and impressions are summed; avg_position is impression-weighted;
 * ctr is recomputed from the merged totals.
 */
export function buildDedupedUrlMetricsUpserts(
  siteId: string,
  rows: GscPageDateRow[],
  ingestedAt: string,
): MetricsDedupeResult {
  type Acc = {
    url: string
    date: string
    clicks: number
    impressions: number
    positionWeighted: number
    rawPages: Set<string>
  }

  const map = new Map<string, Acc>()
  for (const r of rows) {
    if (!r.page || !r.date) continue
    const url = safeNormalize(r.page)
    const key = `${url}\0${r.date}`
    const clicks = Number(r.clicks) || 0
    const impressions = Number(r.impressions) || 0
    const position = Number(r.position) || 0
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        url,
        date: r.date,
        clicks,
        impressions,
        positionWeighted: position * impressions,
        rawPages: new Set([r.page]),
      })
      continue
    }
    existing.clicks += clicks
    existing.impressions += impressions
    existing.positionWeighted += position * impressions
    existing.rawPages.add(r.page)
  }

  const collisions: MetricsDedupeCollision[] = []
  const out: UrlMetricsUpsertRow[] = []
  const merged = Array.from(map.values())
  for (const acc of merged) {
    const avg_position =
      acc.impressions > 0 ? acc.positionWeighted / acc.impressions : 0
    const ctr = acc.impressions > 0 ? acc.clicks / acc.impressions : 0
    if (acc.rawPages.size > 1) {
      collisions.push({
        url: acc.url,
        date: acc.date,
        rawPages: Array.from(acc.rawPages).sort(),
        mergedClicks: Math.round(acc.clicks),
        mergedImpressions: Math.round(acc.impressions),
      })
    }
    out.push({
      site_id: siteId,
      url: acc.url,
      date: acc.date,
      clicks: Math.round(acc.clicks),
      impressions: Math.round(acc.impressions),
      ctr,
      avg_position,
      query_count: 0,
      is_final: isGscDateFinal(acc.date),
      ingested_at: ingestedAt,
    })
  }

  return {
    rows: out,
    collisions,
    inputCount: rows.length,
    outputCount: out.length,
  }
}
