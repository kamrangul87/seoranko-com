/**
 * Quota-aware URL Inspection scheduler.
 * Prioritize: (a) impressions in url_metrics_daily, (b) sitemap URLs,
 * (c) crawl-indexable URLs. Never burn quota on known-excluded URLs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  decryptGscRefreshToken,
  refreshGscAccessToken,
} from '@/lib/gsc/oauth'
import { GscApiError } from '@/lib/gsc/client'
import {
  computeInspectionDeltas,
  type InspectionDelta,
} from '@/lib/gsc/inspection-deltas'
import {
  computeCanonicalMismatch,
  GSC_INSPECTION_BATCH_CAP,
  inspectGscUrl,
  remainingInspectionBudget,
} from '@/lib/gsc/url-inspection'
import { normalizeUrl } from '@/lib/supabase/audit-db'

export type InspectionSyncResult = {
  siteId: string
  propertyUrl: string
  inspected: number
  skippedQuota: number
  skippedRecent: number
  skippedExcluded: number
  remainingBudget: number
  exhausted: boolean
  errors: string[]
  sampleDeltas: Array<{ url: string; reasons: string[] }>
}

type PrioritizedUrl = {
  url: string
  priority: number
  ourVerdict: 'INDEXABLE' | 'BLOCKED' | 'AT_RISK' | null
  ourRobotsBlocked: boolean
  inSitemap: boolean
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function norm(url: string): string {
  try {
    return normalizeUrl(url)
  } catch {
    return url
  }
}

async function loadAccessToken(supabase: any, connection: {
  id: string
  refresh_token_encrypted: string
}): Promise<string> {
  const refreshToken = decryptGscRefreshToken(connection.refresh_token_encrypted)
  try {
    const { accessToken } = await refreshGscAccessToken(refreshToken)
    return accessToken
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'gsc_token_expired') {
      await supabase
        .from('gsc_connections')
        .update({ status: 'expired', last_error: err instanceof Error ? err.message : 'Token expired' })
        .eq('id', connection.id)
    }
    throw err
  }
}

async function getQuotaUsed(
  supabase: any,
  opts: { siteId: string; propertyUrl: string; day: string },
): Promise<{ used: number; exhausted: boolean; rowId: string | null }> {
  const { data } = await supabase
    .from('gsc_inspection_quota_usage')
    .select('id, requests_used, exhausted_at')
    .eq('site_id', opts.siteId)
    .eq('property_url', opts.propertyUrl)
    .eq('day', opts.day)
    .maybeSingle()
  return {
    used: data?.requests_used ?? 0,
    exhausted: !!data?.exhausted_at,
    rowId: data?.id ?? null,
  }
}

async function incrementQuota(
  supabase: any,
  opts: {
    siteId: string
    userId: string
    propertyUrl: string
    day: string
    by: number
    markExhausted?: boolean
  },
): Promise<number> {
  const current = await getQuotaUsed(supabase, opts)
  const next = current.used + opts.by
  const payload = {
    site_id: opts.siteId,
    user_id: opts.userId,
    property_url: opts.propertyUrl,
    day: opts.day,
    requests_used: next,
    exhausted_at: opts.markExhausted || remainingInspectionBudget(next) <= 0
      ? new Date().toISOString()
      : null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('gsc_inspection_quota_usage').upsert(payload, {
    onConflict: 'site_id,property_url,day',
  })
  if (error) console.error('[gsc-inspection-quota]', error.message)
  return next
}

/**
 * Build prioritized inspection queue for a site.
 */
export async function buildInspectionQueue(
  supabase: any,
  opts: { siteId: string; userId: string },
): Promise<{ queue: PrioritizedUrl[]; skippedExcluded: number }> {
  const byUrl = new Map<string, PrioritizedUrl>()
  const excluded = new Set<string>()
  let skippedExcluded = 0

  // Latest Index Diagnosis for crawl verdicts + sitemap + exclusions
  const { data: diag } = await supabase
    .from('index_diagnosis_runs')
    .select('pages, coverage')
    .eq('site_id', opts.siteId)
    .eq('user_id', opts.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const coverage = (diag?.coverage || {}) as {
    excluded?: Array<{ url?: string; reason?: string }>
    sitemapDiscoveredUrls?: string[]
  }

  for (const ex of coverage.excluded || []) {
    if (!ex?.url) continue
    // Never burn quota on known-excluded URLs (robots / noindex / non-200 / etc.)
    excluded.add(norm(ex.url))
  }

  const sitemapSet = new Set(
    (coverage.sitemapDiscoveredUrls || []).map((u) => norm(u)).filter(Boolean),
  )

  const pages = Array.isArray(diag?.pages) ? diag.pages : []
  for (const p of pages) {
    if (!p || typeof p !== 'object') continue
    const url = typeof (p as { url?: string }).url === 'string' ? (p as { url: string }).url : ''
    if (!url) continue
    const n = norm(url)
    if (excluded.has(n)) {
      skippedExcluded += 1
      continue
    }
    const verdict = (p as { verdict?: string }).verdict
    const ourVerdict =
      verdict === 'INDEXABLE' || verdict === 'BLOCKED' || verdict === 'AT_RISK'
        ? verdict
        : null
    const steps = Array.isArray((p as { steps?: unknown }).steps)
      ? ((p as { steps: Array<{ step?: string; passed?: boolean }> }).steps)
      : []
    const ourRobotsBlocked = steps.some(
      (s) =>
        (s.step === 'robots_txt' || s.step === 'meta_robots' || s.step === 'x_robots') &&
        s.passed === false,
    )
    const priority = ourVerdict === 'INDEXABLE' ? 30 : ourVerdict === 'AT_RISK' ? 20 : 10
    byUrl.set(n, {
      url: n,
      priority,
      ourVerdict,
      ourRobotsBlocked,
      inSitemap: sitemapSet.has(n),
    })
  }

  // (b) Sitemap URLs even if not in fetched pages list
  for (const s of sitemapSet) {
    if (excluded.has(s)) {
      skippedExcluded += 1
      continue
    }
    const existing = byUrl.get(s)
    if (existing) {
      existing.inSitemap = true
      existing.priority = Math.max(existing.priority, 50)
    } else {
      byUrl.set(s, {
        url: s,
        priority: 50,
        ourVerdict: null,
        ourRobotsBlocked: false,
        inSitemap: true,
      })
    }
  }

  // (a) URLs with impressions — highest priority boost
  const { data: metricRows } = await supabase
    .from('url_metrics_daily')
    .select('url, impressions')
    .eq('site_id', opts.siteId)
    .gt('impressions', 0)
    .order('impressions', { ascending: false })
    .limit(2000)

  for (const row of metricRows || []) {
    if (!row?.url) continue
    const n = norm(row.url)
    if (excluded.has(n)) {
      skippedExcluded += 1
      continue
    }
    const boost = 100 + Math.min(50, Number(row.impressions) || 0)
    const existing = byUrl.get(n)
    if (existing) {
      existing.priority = Math.max(existing.priority, boost)
    } else {
      byUrl.set(n, {
        url: n,
        priority: boost,
        ourVerdict: null,
        ourRobotsBlocked: false,
        inSitemap: sitemapSet.has(n),
      })
    }
  }

  // Skip URLs inspected in the last 3 days
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 3)
  const { data: recent } = await supabase
    .from('gsc_url_inspections')
    .select('url')
    .eq('site_id', opts.siteId)
    .gte('inspected_at', since.toISOString())
    .limit(5000)
  const recentSet = new Set((recent || []).map((r: { url: string }) => norm(r.url)))

  const queue = Array.from(byUrl.values())
    .filter((u) => !recentSet.has(u.url))
    .sort((a, b) => b.priority - a.priority)

  return {
    queue,
    skippedExcluded,
  }
}

export async function syncUrlInspectionsForConnection(
  supabase: any,
  connectionId: string,
  opts?: { batchCap?: number },
): Promise<InspectionSyncResult> {
  const { data: conn, error: connErr } = await supabase
    .from('gsc_connections')
    .select('id, user_id, site_id, property_url, refresh_token_encrypted, status')
    .eq('id', connectionId)
    .maybeSingle()

  if (connErr || !conn) throw new Error(connErr?.message || 'GSC connection not found')
  if (!conn.property_url) throw new Error('Pick a Search Console property before inspecting.')
  if (conn.status === 'revoked') throw new Error('Search Console connection revoked.')

  const day = utcDay()
  const quota = await getQuotaUsed(supabase, {
    siteId: conn.site_id,
    propertyUrl: conn.property_url,
    day,
  })
  let remaining = remainingInspectionBudget(quota.used)
  const result: InspectionSyncResult = {
    siteId: conn.site_id,
    propertyUrl: conn.property_url,
    inspected: 0,
    skippedQuota: 0,
    skippedRecent: 0,
    skippedExcluded: 0,
    remainingBudget: remaining,
    exhausted: remaining <= 0 || quota.exhausted,
    errors: [],
    sampleDeltas: [],
  }

  if (remaining <= 0) {
    result.skippedQuota = 1
    return result
  }

  const { queue, skippedExcluded } = await buildInspectionQueue(supabase, {
    siteId: conn.site_id,
    userId: conn.user_id,
  })
  result.skippedExcluded = skippedExcluded

  const batchCap = Math.min(opts?.batchCap ?? GSC_INSPECTION_BATCH_CAP, remaining)
  const batch = queue.slice(0, batchCap)
  result.skippedRecent = Math.max(0, queue.length - batch.length)

  if (batch.length === 0) {
    result.remainingBudget = remaining
    return result
  }

  const accessToken = await loadAccessToken(supabase, conn)

  for (const item of batch) {
    if (remaining <= 0) {
      result.exhausted = true
      result.skippedQuota += batch.length - result.inspected
      break
    }
    try {
      const parsed = await inspectGscUrl(accessToken, {
        inspectionUrl: item.url,
        siteUrl: conn.property_url,
      })
      remaining = remainingInspectionBudget(
        await incrementQuota(supabase, {
          siteId: conn.site_id,
          userId: conn.user_id,
          propertyUrl: conn.property_url,
          day,
          by: 1,
        }),
      )

      const canonicalMismatch = computeCanonicalMismatch(
        parsed.userCanonical,
        parsed.googleCanonical,
      )
      const deltas: InspectionDelta[] = computeInspectionDeltas(
        {
          ourVerdict: item.ourVerdict,
          ourRobotsBlocked: item.ourRobotsBlocked,
          inSitemap: item.inSitemap,
        },
        {
          coverageState: parsed.coverageState,
          robotsTxtState: parsed.robotsTxtState,
          indexingState: parsed.indexingState,
          googleCanonical: parsed.googleCanonical,
          userCanonical: parsed.userCanonical,
          canonicalMismatch,
          lastCrawlTime: parsed.lastCrawlTime,
          pageFetchState: parsed.pageFetchState,
          verdict: parsed.verdict,
        },
      )

      const { error: insErr } = await supabase.from('gsc_url_inspections').insert({
        site_id: conn.site_id,
        user_id: conn.user_id,
        connection_id: conn.id,
        url: item.url,
        verdict: parsed.verdict,
        coverage_state: parsed.coverageState,
        robots_txt_state: parsed.robotsTxtState,
        indexing_state: parsed.indexingState,
        google_canonical: parsed.googleCanonical,
        user_canonical: parsed.userCanonical,
        canonical_mismatch: canonicalMismatch,
        last_crawl_time: parsed.lastCrawlTime,
        page_fetch_state: parsed.pageFetchState,
        raw_result: parsed.raw,
        our_verdict: item.ourVerdict,
        our_robots_blocked: item.ourRobotsBlocked,
        deltas,
      })
      if (insErr) {
        result.errors.push(`${item.url}: ${insErr.message}`)
        continue
      }
      result.inspected += 1
      if (deltas.length && result.sampleDeltas.length < 8) {
        result.sampleDeltas.push({
          url: item.url,
          reasons: deltas.map((d) => d.reason),
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${item.url}: ${msg}`)
      // Count quota on 429 as exhausted
      if (err instanceof GscApiError && err.status === 429) {
        await incrementQuota(supabase, {
          siteId: conn.site_id,
          userId: conn.user_id,
          propertyUrl: conn.property_url,
          day,
          by: 1,
          markExhausted: true,
        })
        result.exhausted = true
        break
      }
      // Still count successful auth'd attempts that returned errors? Only count on HTTP success.
      // For transient errors don't increment.
    }
  }

  result.remainingBudget = remaining
  result.exhausted = result.exhausted || remaining <= 0
  return result
}

export async function syncAllUrlInspections(supabase: any): Promise<{
  synced: number
  failed: number
  results: InspectionSyncResult[]
}> {
  const { data: connections, error } = await supabase
    .from('gsc_connections')
    .select('id')
    .eq('status', 'active')
    .not('property_url', 'is', null)

  if (error) throw new Error(error.message)
  const results: InspectionSyncResult[] = []
  let synced = 0
  let failed = 0
  for (const c of connections || []) {
    try {
      const r = await syncUrlInspectionsForConnection(supabase, c.id)
      results.push(r)
      synced += 1
    } catch (err) {
      failed += 1
      results.push({
        siteId: '',
        propertyUrl: '',
        inspected: 0,
        skippedQuota: 0,
        skippedRecent: 0,
        skippedExcluded: 0,
        remainingBudget: 0,
        exhausted: false,
        errors: [err instanceof Error ? err.message : String(err)],
        sampleDeltas: [],
      })
    }
  }
  return { synced, failed, results }
}
