/**
 * Collapse GSC (query,page,date) rows that share the same post-normalizeUrl key
 * before gsc_query_page_daily upsert. Postgres rejects duplicate conflict
 * targets inside a single ON CONFLICT DO UPDATE statement.
 */

import { normalizeUrl } from '@/lib/supabase/audit-db'
import { isGscDateFinal } from '@/lib/gsc/client'

export type GscQueryPageDateRow = {
  query: string
  page: string
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type QueryPageUpsertRow = {
  site_id: string
  url: string
  query: string
  date: string
  clicks: number
  impressions: number
  ctr: number
  avg_position: number
  is_final: boolean
  ingested_at: string
}

function safeNormalize(page: string): string {
  try {
    return normalizeUrl(page)
  } catch {
    return page
  }
}

/**
 * Map GSC rows → gsc_query_page_daily upserts, merging duplicates on
 * (url, query, date) after normalizeUrl (www / trailing slash / query variants
 * collapse per page, but queries remain distinct).
 * Clicks and impressions are summed; avg_position is impression-weighted;
 * ctr is recomputed from the merged totals.
 */
export function buildDedupedQueryPageUpserts(
  siteId: string,
  rows: GscQueryPageDateRow[],
  ingestedAt: string,
): QueryPageUpsertRow[] {
  type Acc = {
    url: string
    query: string
    date: string
    clicks: number
    impressions: number
    positionWeighted: number
  }

  const map = new Map<string, Acc>()
  for (const r of rows) {
    if (!r.page || !r.date || !r.query) continue
    const url = safeNormalize(r.page)
    const key = `${url}\0${r.query}\0${r.date}`
    const clicks = Number(r.clicks) || 0
    const impressions = Number(r.impressions) || 0
    const position = Number(r.position) || 0
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        url,
        query: r.query,
        date: r.date,
        clicks,
        impressions,
        positionWeighted: position * impressions,
      })
      continue
    }
    existing.clicks += clicks
    existing.impressions += impressions
    existing.positionWeighted += position * impressions
  }

  const out: QueryPageUpsertRow[] = []
  for (const acc of map.values()) {
    const avg_position =
      acc.impressions > 0 ? acc.positionWeighted / acc.impressions : 0
    const ctr = acc.impressions > 0 ? acc.clicks / acc.impressions : 0
    out.push({
      site_id: siteId,
      url: acc.url,
      query: acc.query,
      date: acc.date,
      clicks: Math.round(acc.clicks),
      impressions: Math.round(acc.impressions),
      ctr,
      avg_position,
      is_final: isGscDateFinal(acc.date),
      ingested_at: ingestedAt,
    })
  }

  return out
}

