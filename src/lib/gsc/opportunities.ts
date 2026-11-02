import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export type QueryPageDaily = {
  url: string
  query: string
  date: string
  clicks: number
  impressions: number
  avg_position: number
  ctr?: number
  is_final: boolean
}

export type OpportunityRow = {
  url: string
  query: string
  clicks: number
  impressions: number
  ctr: number
  avg_position: number
  opportunity_score: number
  suggested_actions: string[]
}

export function aggregateWindowForQueryPage(
  rows: QueryPageDaily[],
  startDate: string,
  endDate: string,
): OpportunityRow[] {
  type Acc = {
    url: string
    query: string
    clicks: number
    impressions: number
    posWeighted: number
  }
  const map = new Map<string, Acc>()
  for (const r of rows) {
    if (!r.is_final) continue
    if (r.date < startDate || r.date > endDate) continue
    const key = `${r.url}\0${r.query}`
    const acc = map.get(key) || {
      url: r.url,
      query: r.query,
      clicks: 0,
      impressions: 0,
      posWeighted: 0,
    }
    acc.clicks += Number(r.clicks) || 0
    acc.impressions += Number(r.impressions) || 0
    const pos = Number(r.avg_position) || 0
    acc.posWeighted += pos * (Number(r.impressions) || 0)
    map.set(key, acc)
  }
  const out: OpportunityRow[] = []
  const floor = FIX_STRATEGY_PRODUCT_DECISIONS.impressionsFloor ?? 10
  for (const acc of map.values()) {
    if (acc.impressions < floor) continue
    const avg_position = acc.impressions > 0 ? acc.posWeighted / acc.impressions : 0
    if (avg_position < 8 || avg_position > 20) continue
    const ctr = acc.impressions > 0 ? acc.clicks / acc.impressions : 0
    const closeness = Math.max(0, 20 - avg_position) / 15 // 1 at pos=5, 0 at 20
    const opportunity_score = acc.impressions * closeness
    out.push({
      url: acc.url,
      query: acc.query,
      clicks: Math.round(acc.clicks),
      impressions: Math.round(acc.impressions),
      ctr,
      avg_position,
      opportunity_score,
      suggested_actions: [
        'Improve title and meta description',
        'Add an FAQ section that directly answers this query',
        'Add internal links from related ranking pages',
        'Expand the section covering this topic',
      ],
    })
  }
  return out.sort((a, b) => b.opportunity_score - a.opportunity_score)
}

export function pickWindowDates(
  availableDates: string[],
  preferredDays = 28,
  fallbackDays = 90,
): { startDate: string; endDate: string; windowDays: number } | null {
  if (availableDates.length === 0) return null
  const sorted = Array.from(new Set(availableDates)).sort()
  const endDate = sorted[sorted.length - 1]!
  const uniqueDays = sorted.length
  const windowDays = uniqueDays >= preferredDays ? preferredDays : Math.min(uniqueDays, fallbackDays)
  const startIdx = Math.max(0, sorted.length - windowDays)
  const startDate = sorted[startIdx]!
  return { startDate, endDate, windowDays: windowDays }
}

