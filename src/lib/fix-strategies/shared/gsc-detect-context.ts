/**
 * Load GSC rows for topics 55–59. Silent (null) when there is no active
 * connection — callers must emit zero findings, never "no issues found".
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { normalizeCanonicalForGscMatch } from './canonical-normalize'

export type GscInspectionRow = {
  url: string
  urlNormalized: string
  coverageState: string | null
  indexingState: string | null
  googleCanonical: string | null
  userCanonical: string | null
  canonicalMismatch: boolean
  lastCrawlTime: string | null
  inspectedAt: string | null
}

export type GscMetricsRow = {
  url: string
  urlNormalized: string
  impressions: number
  clicks: number
}

export type GscDetectContext = {
  siteId: string
  propertyUrl: string
  connectionStatus: 'active'
  /** Latest successful inspection per normalized URL. */
  inspectionsByUrl: Map<string, GscInspectionRow>
  inspections: GscInspectionRow[]
  /** Aggregated finalized Search Analytics rows by normalized URL. */
  metricsByUrl: Map<string, GscMetricsRow>
  metrics: GscMetricsRow[]
  /** Inspection count vs soft daily capacity — UI must state partial coverage. */
  inspectionCoveragePartial: boolean
  inspectionRowCount: number
}

const ALTERNATE_PROPER =
  /alternate page with proper canonical/i

export function isAlternatePageWithProperCanonical(
  coverageState: string | null | undefined,
): boolean {
  return !!coverageState && ALTERNATE_PROPER.test(coverageState)
}

export function isDiscoveredNotIndexed(coverageState: string | null | undefined): boolean {
  if (!coverageState) return false
  return /discovered\s*[-—]\s*currently not indexed/i.test(coverageState)
}

export function isCrawledNotIndexed(coverageState: string | null | undefined): boolean {
  if (!coverageState) return false
  return /crawled\s*[-—]\s*currently not indexed/i.test(coverageState)
}

/**
 * Returns null when GSC is absent or expired — detectors must stay silent.
 */
export async function loadGscDetectContext(
  siteId: string | null | undefined,
): Promise<GscDetectContext | null> {
  if (!siteId) return null
  const supabase = createServiceRoleClient()

  const { data: conn, error: connErr } = await supabase
    .from('gsc_connections')
    .select('id, property_url, status')
    .eq('site_id', siteId)
    .maybeSingle()

  if (connErr || !conn?.property_url || conn.status !== 'active') {
    return null
  }

  const { data: inspRows } = await supabase
    .from('gsc_url_inspections')
    .select(
      'url, url_normalized, coverage_state, indexing_state, google_canonical, user_canonical, canonical_mismatch, last_crawl_time, inspected_at, status',
    )
    .eq('site_id', siteId)
    .eq('status', 'succeeded')
    .order('inspected_at', { ascending: false })
    .limit(5000)

  const inspectionsByUrl = new Map<string, GscInspectionRow>()
  const inspections: GscInspectionRow[] = []
  for (const raw of inspRows || []) {
    const url = String(raw.url || '')
    if (!url) continue
    const urlNormalized =
      (typeof raw.url_normalized === 'string' && raw.url_normalized) ||
      normalizeCanonicalForGscMatch(url)
    if (inspectionsByUrl.has(urlNormalized)) continue // latest first
    const row: GscInspectionRow = {
      url,
      urlNormalized,
      coverageState: raw.coverage_state ?? null,
      indexingState: raw.indexing_state ?? null,
      googleCanonical: raw.google_canonical ?? null,
      userCanonical: raw.user_canonical ?? null,
      canonicalMismatch: !!raw.canonical_mismatch,
      lastCrawlTime: raw.last_crawl_time ?? null,
      inspectedAt: raw.inspected_at ?? null,
    }
    inspectionsByUrl.set(urlNormalized, row)
    inspections.push(row)
  }

  const { data: metricRows } = await supabase
    .from('url_metrics_daily')
    .select('url, impressions, clicks, is_final')
    .eq('site_id', siteId)
    .eq('is_final', true)
    .limit(100_000)

  const metricsByUrl = new Map<string, GscMetricsRow>()
  for (const raw of metricRows || []) {
    const url = String(raw.url || '')
    if (!url) continue
    const urlNormalized = normalizeCanonicalForGscMatch(url)
    const prev = metricsByUrl.get(urlNormalized)
    const impressions = Number(raw.impressions) || 0
    const clicks = Number(raw.clicks) || 0
    if (prev) {
      prev.impressions += impressions
      prev.clicks += clicks
    } else {
      metricsByUrl.set(urlNormalized, {
        url,
        urlNormalized,
        impressions,
        clicks,
      })
    }
  }

  return {
    siteId,
    propertyUrl: conn.property_url,
    connectionStatus: 'active',
    inspectionsByUrl,
    inspections,
    metricsByUrl,
    metrics: Array.from(metricsByUrl.values()),
    // Soft cap is 1950; any finite stored set under a large site is partial.
    inspectionCoveragePartial: true,
    inspectionRowCount: inspections.length,
  }
}
