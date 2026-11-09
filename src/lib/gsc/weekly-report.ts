/**
 * Shared weekly-report + Page-2 window helpers.
 * Always use finalized GSC dates — never a calendar week that has no data yet.
 */

import { gscFinalityCutoffDate } from './client'
import {
  aggregateWindowForQueryPage,
  pickWindowDates,
  type OpportunityRow,
  type QueryPageDaily,
} from './opportunities'

export type CompleteWeek = {
  startDate: string
  endDate: string
  weekEnding: string
  dates: string[]
}

export type WeeklyTotals = {
  clicks: { current: number; previous: number; delta: number }
  impressions: { current: number; previous: number; delta: number }
}

export type Page2NextAction = {
  url: string
  query: string
  avg_position: number
  ctr: number
  impressions: number
  suggestedFix: 'title_meta' | 'internal_links' | 'content_gaps' | 'schema'
}

function uniqueSortedDates(rows: Array<{ date: string; is_final?: boolean }>): string[] {
  return Array.from(
    new Set(
      rows
        .filter((r) => r.is_final !== false)
        .map((r) => r.date)
        .filter(Boolean),
    ),
  ).sort()
}

function addUtcDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Latest 7 calendar days ending on the newest finalized date that actually
 * has rows. Label those dates — do not invent a week ending yesterday.
 */
export function pickLatestCompleteWeek(
  dates: string[],
  now = new Date(),
): CompleteWeek | null {
  const cutoff = gscFinalityCutoffDate(now)
  const finalized = Array.from(new Set(dates))
    .filter((d) => d <= cutoff)
    .sort()
  if (finalized.length === 0) return null
  const endDate = finalized[finalized.length - 1]!
  const startDate = addUtcDays(endDate, -6)
  const windowDates = finalized.filter((d) => d >= startDate && d <= endDate)
  if (windowDates.length === 0) return null
  return {
    startDate: windowDates[0]!,
    endDate,
    weekEnding: endDate,
    dates: windowDates,
  }
}

export function previousWeekDates(week: CompleteWeek): string[] {
  const prevEnd = addUtcDays(week.startDate, -1)
  const prevStart = addUtcDays(prevEnd, -6)
  const out: string[] = []
  for (let i = 0; i < 7; i++) out.push(addUtcDays(prevStart, i))
  return out
}

function isQuestionLike(q: string): boolean {
  return (
    /\b(what|how|why|when|where|who|can|does|do|is|are|should|faq|guide)\b/i.test(
      q,
    ) || /\?$/.test(q.trim())
  )
}

function shouldTargetPricing(q: string): boolean {
  return /\b(price|prices|cost|fee|fees)\b/i.test(q)
}

export function suggestFixTypeForOpportunity(row: {
  ctr: number
  avg_position: number
  query: string
}): Page2NextAction['suggestedFix'] {
  if (row.ctr < 0.02) return 'title_meta'
  if (isQuestionLike(row.query) || shouldTargetPricing(row.query)) {
    return 'content_gaps'
  }
  return 'internal_links'
}

export function page2WindowFromRows(
  rows: QueryPageDaily[],
  preferredDays = 28,
  fallbackDays = 90,
): { startDate: string; endDate: string; windowDays: number } | null {
  return pickWindowDates(
    uniqueSortedDates(rows.filter((r) => r.is_final)),
    preferredDays,
    fallbackDays,
  )
}

export function page2OpportunitiesFromRows(
  rows: QueryPageDaily[],
): OpportunityRow[] {
  const window = page2WindowFromRows(rows)
  if (!window) return []
  return aggregateWindowForQueryPage(rows, window.startDate, window.endDate)
}

export function bestPage2NextAction(
  rows: QueryPageDaily[],
): Page2NextAction | null {
  const opp = page2OpportunitiesFromRows(rows)[0]
  if (!opp) return null
  return {
    url: opp.url,
    query: opp.query,
    avg_position: opp.avg_position,
    ctr: opp.ctr,
    impressions: opp.impressions,
    suggestedFix: suggestFixTypeForOpportunity(opp),
  }
}

export function aggregateWeekTotals(
  rows: Array<{ date: string; clicks: number; impressions: number; is_final?: boolean }>,
  dates: string[],
): { clicks: number; impressions: number } {
  const set = new Set(dates)
  let clicks = 0
  let impressions = 0
  for (const r of rows) {
    if (r.is_final === false) continue
    if (!set.has(r.date)) continue
    clicks += Number(r.clicks) || 0
    impressions += Number(r.impressions) || 0
  }
  return {
    clicks: Math.round(clicks),
    impressions: Math.round(impressions),
  }
}

export function weeklyTotalsFromRows(
  rows: Array<{ date: string; clicks: number; impressions: number; is_final?: boolean }>,
  now = new Date(),
): { week: CompleteWeek; totals: WeeklyTotals } | null {
  const week = pickLatestCompleteWeek(uniqueSortedDates(rows), now)
  if (!week) return null
  const current = aggregateWeekTotals(rows, week.dates)
  const previous = aggregateWeekTotals(rows, previousWeekDates(week))
  return {
    week,
    totals: {
      clicks: {
        current: current.clicks,
        previous: previous.clicks,
        delta: current.clicks - previous.clicks,
      },
      impressions: {
        current: current.impressions,
        previous: previous.impressions,
        delta: current.impressions - previous.impressions,
      },
    },
  }
}
