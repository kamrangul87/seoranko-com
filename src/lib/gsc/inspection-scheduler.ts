/**
 * Quota-aware URL Inspection scheduler (Phase B).
 * Hobby-safe: soft batch ≤40, wall-clock deadline ~50s, daily cron only.
 * Atomic reserve_gsc_inspection_quota RPC; deferred queue on 429/5xx/deadline.
 * Read-only w.r.t. intervention_events / causal_results — links intervention_id
 * and emits google_not_recrawled_since_fix from verified_at only.
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
  type OurIndexingDirective,
} from '@/lib/gsc/inspection-deltas'
import {
  computeCanonicalMismatch,
  GSC_INSPECTION_BATCH_CAP,
  GSC_INSPECTION_DEADLINE_MS,
  GSC_INSPECTION_SOFT_CAP,
  inspectGscUrl,
  normalizeInspectionCanonical,
} from '@/lib/gsc/url-inspection'
import { normalizeUrl } from '@/lib/supabase/audit-db'

export type InspectionSyncResult = {
  siteId: string
  propertyUrl: string
  inspected: number
  skippedQuota: number
  skippedRecent: number
  skippedExcluded: number
  deferred: number
  remainingBudget: number
  exhausted: boolean
  stoppedReason?: 'deadline' | 'batch_cap' | 'quota' | 'complete' | 'empty'
  errors: string[]
  sampleDeltas: Array<{ url: string; reasons: string[] }>
}

type PrioritizedUrl = {
  url: string
  priority: number
  ourVerdict: 'INDEXABLE' | 'BLOCKED' | 'AT_RISK' | null
  ourRobotsBlocked: boolean
  ourHttpStatus: number | null
  ourIndexingDirective: OurIndexingDirective
  inSitemap: boolean
  source: 'metrics' | 'sitemap' | 'crawl' | 'blocked_sample' | 'intervention' | 'deferred'
  interventionId?: string | null
  interventionVerifiedAt?: string | null
  deferredId?: string | null
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

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

function normalizeDomainKey(domain: string): string {
  return domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function directiveFromSteps(
  steps: Array<{ step?: string; passed?: boolean }>,
): OurIndexingDirective {
  const meta = steps.find((s) => s.step === 'meta_robots' && s.passed === false)
  if (meta) return 'noindex_meta'
  const header = steps.find((s) => s.step === 'x_robots' && s.passed === false)
  if (header) return 'noindex_header'
  const anyRobots = steps.some(
    (s) =>
      (s.step === 'meta_robots' || s.step === 'x_robots') && typeof s.passed === 'boolean',
  )
  return anyRobots ? 'none' : 'unknown'
}

async function loadAccessToken(
  supabase: any,
  connection: { id: string; refresh_token_encrypted: string },
): Promise<string> {
  const refreshToken = decryptGscRefreshToken(connection.refresh_token_encrypted)
  try {
    const { accessToken } = await refreshGscAccessToken(refreshToken)
    return accessToken
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'gsc_token_expired') {
      await supabase
        .from('gsc_connections')
        .update({
          status: 'expired',
          last_error: err instanceof Error ? err.message : 'Token expired',
        })
        .eq('id', connection.id)
    }
    throw err
  }
}

async function reserveQuota(
  supabase: any,
  opts: {
    siteId: string
    userId: string
    propertyUrl: string
    requested: number
  },
): Promise<{ reserved: number; remaining: number; day: string; exhausted: boolean }> {
  const { data, error } = await supabase.rpc('reserve_gsc_inspection_quota', {
    p_site_id: opts.siteId,
    p_user_id: opts.userId,
    p_property_url: opts.propertyUrl,
    p_n: opts.requested,
    p_soft_cap: GSC_INSPECTION_SOFT_CAP,
  })
  if (error) {
    console.error('[gsc-inspection-quota] reserve failed:', error.message)
    return { reserved: 0, remaining: 0, day: utcDay(), exhausted: true }
  }
  const row = Array.isArray(data) ? data[0] : data
  return {
    reserved: Number(row?.reserved ?? 0),
    remaining: Number(row?.remaining ?? 0),
    day: row?.quota_day
      ? String(row.quota_day)
      : row?.day
        ? String(row.day)
        : utcDay(),
    exhausted: Boolean(row?.exhausted),
  }
}

async function recordQuotaOutcome(
  supabase: any,
  opts: {
    propertyUrl: string
    day: string
    succeeded: number
    failed: number
    deferred: number
    markExhausted?: boolean
  },
): Promise<void> {
  const { error } = await supabase.rpc('record_gsc_inspection_quota_outcome', {
    p_property_url: opts.propertyUrl,
    p_day: opts.day,
    p_succeeded: opts.succeeded,
    p_failed: opts.failed,
    p_deferred: opts.deferred,
    p_mark_exhausted: opts.markExhausted ?? false,
  })
  if (error) {
    console.error('[gsc-inspection-quota] outcome failed:', error.message)
  }
}

async function loadBlockedCursor(supabase: any, propertyUrl: string): Promise<number> {
  const { data } = await supabase
    .from('gsc_inspection_scheduler_cursor')
    .select('blocked_sample_offset')
    .eq('property_url', propertyUrl)
    .maybeSingle()
  return Number(data?.blocked_sample_offset ?? 0)
}

async function saveBlockedCursor(
  supabase: any,
  opts: {
    propertyUrl: string
    siteId: string
    userId: string
    connectionId: string
    offset: number
  },
): Promise<void> {
  await supabase.from('gsc_inspection_scheduler_cursor').upsert(
    {
      property_url: opts.propertyUrl,
      site_id: opts.siteId,
      user_id: opts.userId,
      last_connection_id: opts.connectionId,
      blocked_sample_offset: opts.offset,
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_url' },
  )
}

async function loadDeferredUrls(
  supabase: any,
  propertyUrl: string,
  limit: number,
): Promise<PrioritizedUrl[]> {
  const { data } = await supabase
    .from('gsc_inspection_deferred')
    .select('id, url, url_normalized, intervention_id')
    .eq('property_url', propertyUrl)
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)

  return (data || []).map(
    (row: {
      id: string
      url: string
      url_normalized?: string
      intervention_id?: string | null
    }) => ({
      url: row.url_normalized || row.url,
      priority: 1000,
      ourVerdict: null,
      ourRobotsBlocked: false,
      ourHttpStatus: null,
      ourIndexingDirective: 'unknown' as const,
      inSitemap: false,
      source: 'deferred' as const,
      interventionId: row.intervention_id ?? null,
      deferredId: row.id,
    }),
  )
}

async function enqueueDeferred(
  supabase: any,
  opts: {
    siteId: string
    userId: string
    connectionId: string
    propertyUrl: string
    url: string
    reason: string
    httpStatus?: number | null
    interventionId?: string | null
  },
): Promise<void> {
  const urlNormalized = norm(opts.url)
  const nextAttempt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('gsc_inspection_deferred').upsert(
    {
      site_id: opts.siteId,
      user_id: opts.userId,
      connection_id: opts.connectionId,
      property_url: opts.propertyUrl,
      url: opts.url,
      url_normalized: urlNormalized,
      reason: opts.reason.slice(0, 500),
      http_status: opts.httpStatus ?? null,
      next_attempt_at: nextAttempt,
      last_error: opts.reason.slice(0, 1000),
      intervention_id: opts.interventionId ?? null,
      status: 'pending',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_url,url_normalized' },
  )
}

async function markDeferredDone(supabase: any, deferredId: string): Promise<void> {
  await supabase
    .from('gsc_inspection_deferred')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', deferredId)
}

/**
 * Verified interventions for this site — read-only (no lifecycle writes).
 */
async function loadVerifiedInterventions(
  supabase: any,
  opts: { siteId: string; userId: string; domain?: string | null },
): Promise<PrioritizedUrl[]> {
  const { data, error } = await supabase
    .from('intervention_events')
    .select('id, url_id, url, verified_at, site_id, lifecycle_state')
    .eq('lifecycle_state', 'verified')
    .eq('site_id', opts.siteId)
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: false })
    .limit(40)
  if (error || !data) {
    // Fallback: match by domain via url host when site_id filter returns nothing / column quirks
    const { data: byUser } = await supabase
      .from('intervention_events')
      .select('id, url_id, url, verified_at, site_id, lifecycle_state')
      .eq('lifecycle_state', 'verified')
      .eq('user_id', opts.userId)
      .not('verified_at', 'is', null)
      .order('verified_at', { ascending: false })
      .limit(50)

    const domainKey = opts.domain ? normalizeDomainKey(opts.domain) : null
    return (byUser || [])
      .filter((row: { url_id?: string; url?: string; site_id?: string }) => {
        if (row.site_id === opts.siteId) return true
        if (!domainKey) return false
        const page = row.url_id || row.url || ''
        const host = hostnameOf(page)
        return host === domainKey
      })
      .map(
        (row: {
          id: string
          url_id?: string
          url?: string
          verified_at: string
        }) => ({
          url: norm(row.url_id || row.url || ''),
          priority: 900,
          ourVerdict: null,
          ourRobotsBlocked: false,
          ourHttpStatus: null,
          ourIndexingDirective: 'unknown' as const,
          inSitemap: false,
          source: 'intervention' as const,
          interventionId: row.id,
          interventionVerifiedAt: row.verified_at,
        }),
      )
      .filter((r: PrioritizedUrl) => Boolean(r.url))
  }

  return (data as Array<{
    id: string
    url_id?: string
    url?: string
    verified_at: string
  }>)
    .map((row) => ({
      url: norm(row.url_id || row.url || ''),
      priority: 900,
      ourVerdict: null as PrioritizedUrl['ourVerdict'],
      ourRobotsBlocked: false,
      ourHttpStatus: null as number | null,
      ourIndexingDirective: 'unknown' as OurIndexingDirective,
      inSitemap: false,
      source: 'intervention' as const,
      interventionId: row.id,
      interventionVerifiedAt: row.verified_at,
    }))
    .filter((r) => Boolean(r.url))
}

/**
 * Build prioritized inspection queue for a site.
 * Diagnosis loaded by domain (index_diagnosis_runs has no site_id).
 * Blocked/excluded URLs are NOT permanently skipped — rotating sample.
 */
export async function buildInspectionQueue(
  supabase: any,
  opts: { siteId: string; userId: string; propertyUrl?: string; domain?: string | null },
): Promise<{ queue: PrioritizedUrl[]; skippedExcluded: number; blockedCursor: number }> {
  const byUrl = new Map<string, PrioritizedUrl>()
  const blockedSample: PrioritizedUrl[] = []
  let skippedExcluded = 0

  let domain = opts.domain ? normalizeDomainKey(opts.domain) : null
  if (!domain) {
    const { data: site } = await supabase
      .from('connected_sites')
      .select('domain')
      .eq('id', opts.siteId)
      .maybeSingle()
    domain = site?.domain ? normalizeDomainKey(site.domain) : null
  }

  // Latest Index Diagnosis by domain (not site_id — column does not exist)
  let diag: { pages?: unknown; coverage?: unknown; id?: string } | null = null
  if (domain) {
    const { data } = await supabase
      .from('index_diagnosis_runs')
      .select('id, pages, coverage, domain')
      .eq('user_id', opts.userId)
      .eq('domain', domain)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    diag = data
  }

  const coverage = (diag?.coverage || {}) as {
    excluded?: Array<{ url?: string; reason?: string }>
    sitemapDiscoveredUrls?: string[]
  }

  const excludedSet = new Set<string>()
  for (const ex of coverage.excluded || []) {
    if (!ex?.url) continue
    excludedSet.add(norm(ex.url))
  }

  const sitemapSet = new Set(
    (coverage.sitemapDiscoveredUrls || []).map((u) => norm(u)).filter(Boolean),
  )

  const pages = Array.isArray(diag?.pages) ? diag!.pages : []
  for (const p of pages) {
    if (!p || typeof p !== 'object') continue
    const url = typeof (p as { url?: string }).url === 'string' ? (p as { url: string }).url : ''
    if (!url) continue
    const n = norm(url)
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
    const httpStatus =
      typeof (p as { httpStatus?: number }).httpStatus === 'number'
        ? (p as { httpStatus: number }).httpStatus
        : null
    const item: PrioritizedUrl = {
      url: n,
      priority: ourVerdict === 'INDEXABLE' ? 30 : ourVerdict === 'AT_RISK' ? 20 : 10,
      ourVerdict,
      ourRobotsBlocked,
      ourHttpStatus: httpStatus,
      ourIndexingDirective: directiveFromSteps(steps),
      inSitemap: sitemapSet.has(n),
      source: excludedSet.has(n) || ourVerdict === 'BLOCKED' ? 'blocked_sample' : 'crawl',
    }
    if (item.source === 'blocked_sample') {
      skippedExcluded += 1
      blockedSample.push(item)
    } else {
      byUrl.set(n, item)
    }
  }

  for (const s of Array.from(sitemapSet)) {
    if (excludedSet.has(s)) {
      skippedExcluded += 1
      if (!blockedSample.some((b) => b.url === s) && !byUrl.has(s)) {
        blockedSample.push({
          url: s,
          priority: 5,
          ourVerdict: 'BLOCKED',
          ourRobotsBlocked: true,
          ourHttpStatus: null,
          ourIndexingDirective: 'unknown',
          inSitemap: true,
          source: 'blocked_sample',
        })
      }
      continue
    }
    const existing = byUrl.get(s)
    if (existing) {
      existing.inSitemap = true
      existing.priority = Math.max(existing.priority, 50)
      existing.source = 'sitemap'
    } else {
      byUrl.set(s, {
        url: s,
        priority: 50,
        ourVerdict: null,
        ourRobotsBlocked: false,
        ourHttpStatus: null,
        ourIndexingDirective: 'unknown',
        inSitemap: true,
        source: 'sitemap',
      })
    }
  }

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
    if (excludedSet.has(n)) {
      skippedExcluded += 1
      continue
    }
    const boost = 100 + Math.min(50, Number(row.impressions) || 0)
    const existing = byUrl.get(n)
    if (existing) {
      existing.priority = Math.max(existing.priority, boost)
      existing.source = 'metrics'
    } else {
      byUrl.set(n, {
        url: n,
        priority: boost,
        ourVerdict: null,
        ourRobotsBlocked: false,
        ourHttpStatus: null,
        ourIndexingDirective: 'unknown',
        inSitemap: sitemapSet.has(n),
        source: 'metrics',
      })
    }
  }

  // Skip URLs inspected in the last 3 days (except deferred / interventions)
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 3)
  const { data: recent } = await supabase
    .from('gsc_url_inspections')
    .select('url')
    .eq('site_id', opts.siteId)
    .eq('status', 'succeeded')
    .gte('inspected_at', since.toISOString())
    .limit(5000)
  const recentSet = new Set((recent || []).map((r: { url: string }) => norm(r.url)))

  const propertyUrl = opts.propertyUrl || ''
  const blockedCursor = propertyUrl ? await loadBlockedCursor(supabase, propertyUrl) : 0

  const interventions = await loadVerifiedInterventions(supabase, {
    siteId: opts.siteId,
    userId: opts.userId,
    domain,
  })
  const deferred = propertyUrl
    ? await loadDeferredUrls(supabase, propertyUrl, GSC_INSPECTION_BATCH_CAP)
    : []

  // Rotate blocked sample so they are not skipped forever
  const rotatedBlocked =
    blockedSample.length === 0
      ? []
      : (() => {
          const start = blockedCursor % blockedSample.length
          return [...blockedSample.slice(start), ...blockedSample.slice(0, start)]
        })()

  const merge = (list: PrioritizedUrl[], allowRecent = false) => {
    for (const item of list) {
      if (!item.url) continue
      if (!allowRecent && recentSet.has(item.url) && item.source !== 'deferred') continue
      const existing = byUrl.get(item.url)
      if (!existing || item.priority > existing.priority) {
        byUrl.set(item.url, { ...existing, ...item, priority: Math.max(existing?.priority ?? 0, item.priority) })
      } else if (item.interventionId && !existing.interventionId) {
        existing.interventionId = item.interventionId
        existing.interventionVerifiedAt = item.interventionVerifiedAt
      }
    }
  }

  // Primary queue without blocked; blocked appended with low priority after rotation
  const primary = Array.from(byUrl.values()).filter((u) => !recentSet.has(u.url))
  byUrl.clear()
  for (const p of primary) byUrl.set(p.url, p)

  merge(interventions, true)
  merge(deferred, true)
  for (const b of rotatedBlocked) {
    if (recentSet.has(b.url)) continue
    if (!byUrl.has(b.url)) {
      byUrl.set(b.url, { ...b, priority: 8 })
    }
  }

  const queue = Array.from(byUrl.values()).sort((a, b) => {
    const sourceRank = (s: PrioritizedUrl['source']) => {
      if (s === 'deferred') return 5
      if (s === 'intervention') return 4
      if (s === 'metrics') return 3
      if (s === 'sitemap') return 2
      if (s === 'crawl') return 1
      return 0
    }
    const sr = sourceRank(b.source) - sourceRank(a.source)
    if (sr !== 0) return sr
    return b.priority - a.priority
  })

  return { queue, skippedExcluded, blockedCursor }
}

export async function syncUrlInspectionsForConnection(
  supabase: any,
  connectionId: string,
  opts?: { batchCap?: number; alreadyProcessedProperties?: Set<string>; deadlineMs?: number },
): Promise<InspectionSyncResult> {
  const startedAt = Date.now()
  const deadlineMs = opts?.deadlineMs ?? GSC_INSPECTION_DEADLINE_MS

  const { data: conn, error: connErr } = await supabase
    .from('gsc_connections')
    .select('id, user_id, site_id, property_url, refresh_token_encrypted, status')
    .eq('id', connectionId)
    .maybeSingle()

  if (connErr || !conn) throw new Error(connErr?.message || 'GSC connection not found')
  if (!conn.property_url) throw new Error('Pick a Search Console property before inspecting.')
  if (conn.status === 'revoked') throw new Error('Search Console connection revoked.')

  const propertyUrl = conn.property_url as string
  if (opts?.alreadyProcessedProperties?.has(propertyUrl)) {
    return {
      siteId: conn.site_id,
      propertyUrl,
      inspected: 0,
      skippedQuota: 0,
      skippedRecent: 0,
      skippedExcluded: 0,
      deferred: 0,
      remainingBudget: 0,
      exhausted: false,
      stoppedReason: 'complete',
      errors: ['property_already_processed_this_run'],
      sampleDeltas: [],
    }
  }
  opts?.alreadyProcessedProperties?.add(propertyUrl)

  const { data: siteRow } = await supabase
    .from('connected_sites')
    .select('domain')
    .eq('id', conn.site_id)
    .maybeSingle()

  const { queue, skippedExcluded, blockedCursor } = await buildInspectionQueue(supabase, {
    siteId: conn.site_id,
    userId: conn.user_id,
    propertyUrl,
    domain: siteRow?.domain ?? null,
  })

  const batchCap = Math.min(opts?.batchCap ?? GSC_INSPECTION_BATCH_CAP, GSC_INSPECTION_BATCH_CAP)
  const batch = queue.slice(0, batchCap)

  const result: InspectionSyncResult = {
    siteId: conn.site_id,
    propertyUrl,
    inspected: 0,
    skippedQuota: 0,
    skippedRecent: Math.max(0, queue.length - batch.length),
    skippedExcluded,
    deferred: 0,
    remainingBudget: 0,
    exhausted: false,
    stoppedReason: 'empty',
    errors: [],
    sampleDeltas: [],
  }

  if (batch.length === 0) {
    result.stoppedReason = 'empty'
    return result
  }

  const reservation = await reserveQuota(supabase, {
    siteId: conn.site_id,
    userId: conn.user_id,
    propertyUrl,
    requested: batch.length,
  })

  result.remainingBudget = reservation.remaining
  result.exhausted = reservation.exhausted || reservation.reserved <= 0

  if (reservation.reserved <= 0) {
    result.skippedQuota = batch.length
    result.stoppedReason = 'quota'
    return result
  }

  const toInspect = batch.slice(0, reservation.reserved)
  if (toInspect.length < batch.length) {
    result.skippedQuota = batch.length - toInspect.length
  }

  let accessToken: string
  try {
    accessToken = await loadAccessToken(supabase, conn)
  } catch (err) {
    await recordQuotaOutcome(supabase, {
      propertyUrl,
      day: reservation.day,
      succeeded: 0,
      failed: reservation.reserved,
      deferred: 0,
    })
    throw err
  }

  let succeeded = 0
  let failed = 0
  let deferred = 0
  let markExhausted = false
  let blockedAdvanced = 0
  let stoppedReason: InspectionSyncResult['stoppedReason'] = 'complete'

  for (let i = 0; i < toInspect.length; i++) {
    const item = toInspect[i]!
    if (Date.now() - startedAt >= deadlineMs) {
      stoppedReason = 'deadline'
      for (let j = i; j < toInspect.length; j++) {
        const left = toInspect[j]!
        failed += 1
        deferred += 1
        result.deferred += 1
        await enqueueDeferred(supabase, {
          siteId: conn.site_id,
          userId: conn.user_id,
          connectionId: conn.id,
          propertyUrl,
          url: left.url,
          reason: 'deadline_reached',
          interventionId: left.interventionId,
        })
      }
      break
    }

    try {
      const parsed = await inspectGscUrl(accessToken, {
        inspectionUrl: item.url,
        siteUrl: propertyUrl,
      })

      const userCanonRaw = parsed.userCanonical
      const googleCanonRaw = parsed.googleCanonical
      const userCanonNorm = normalizeInspectionCanonical(userCanonRaw)
      const googleCanonNorm = normalizeInspectionCanonical(googleCanonRaw)
      const canonicalMismatch = computeCanonicalMismatch(userCanonRaw, googleCanonRaw)

      const { data: previous } = await supabase
        .from('gsc_url_inspections')
        .select(
          'id, inspected_at, verdict, indexing_state, google_canonical, page_fetch_state, robots_txt_state',
        )
        .eq('site_id', conn.site_id)
        .eq('url', item.url)
        .eq('status', 'succeeded')
        .order('inspected_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const deltas: InspectionDelta[] = computeInspectionDeltas(
        {
          ourVerdict: item.ourVerdict,
          ourRobotsBlocked: item.ourRobotsBlocked,
          ourHttpStatus: item.ourHttpStatus,
          ourIndexingDirective: item.ourIndexingDirective,
          inSitemap: item.inSitemap,
        },
        {
          coverageState: parsed.coverageState,
          robotsTxtState: parsed.robotsTxtState,
          indexingState: parsed.indexingState,
          googleCanonical: googleCanonNorm || googleCanonRaw,
          userCanonical: userCanonNorm || userCanonRaw,
          canonicalMismatch,
          lastCrawlTime: parsed.lastCrawlTime,
          pageFetchState: parsed.pageFetchState,
          verdict: parsed.verdict,
        },
        {
          verifiedIntervention:
            item.interventionId && item.interventionVerifiedAt
              ? { id: item.interventionId, verifiedAt: item.interventionVerifiedAt }
              : null,
          previous: previous
            ? {
                id: previous.id,
                inspectedAt: previous.inspected_at,
                verdict: previous.verdict,
                indexingState: previous.indexing_state,
                googleCanonical: previous.google_canonical,
                pageFetchState: previous.page_fetch_state,
                robotsTxtState: previous.robots_txt_state,
              }
            : null,
        },
      )

      const historicalTransitions = deltas
        .filter((d) => d.reason === 'historical_transition')
        .map((d) => d.evidence)

      const { error: insErr } = await supabase.from('gsc_url_inspections').insert({
        site_id: conn.site_id,
        user_id: conn.user_id,
        connection_id: conn.id,
        url: item.url,
        url_normalized: norm(item.url),
        status: 'succeeded',
        verdict: parsed.verdict,
        coverage_state: parsed.coverageState,
        robots_txt_state: parsed.robotsTxtState,
        indexing_state: parsed.indexingState,
        google_canonical: googleCanonNorm || googleCanonRaw,
        user_canonical: userCanonNorm || userCanonRaw,
        google_canonical_raw: googleCanonRaw,
        user_canonical_raw: userCanonRaw,
        google_canonical_normalized: googleCanonNorm,
        user_canonical_normalized: userCanonNorm,
        canonical_mismatch: canonicalMismatch,
        last_crawl_time: parsed.lastCrawlTime,
        page_fetch_state: parsed.pageFetchState,
        crawled_as: parsed.crawledAs,
        sitemap: parsed.sitemap,
        referring_urls: parsed.referringUrls,
        referring_urls_exhaustive: parsed.referringUrlsExhaustive,
        rich_results_verdict: parsed.richResultsVerdict,
        rich_results_evidence: parsed.richResultsEvidence,
        raw_result: parsed.raw,
        our_verdict: item.ourVerdict,
        our_robots_blocked: item.ourRobotsBlocked,
        deltas,
        historical_transitions: historicalTransitions,
        intervention_id: item.interventionId ?? null,
        previous_inspection_id: previous?.id ?? null,
      })

      if (insErr) {
        failed += 1
        result.errors.push(`${item.url}: ${insErr.message}`)
        continue
      }

      succeeded += 1
      result.inspected += 1
      if (item.deferredId) await markDeferredDone(supabase, item.deferredId)
      if (item.source === 'blocked_sample') blockedAdvanced += 1
      if (deltas.length && result.sampleDeltas.length < 8) {
        result.sampleDeltas.push({
          url: item.url,
          reasons: deltas.map((d) => d.reason),
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${item.url}: ${msg}`)

      if (err instanceof GscApiError && (err.status === 429 || err.retryable)) {
        failed += 1
        deferred += 1
        result.deferred += 1
        await enqueueDeferred(supabase, {
          siteId: conn.site_id,
          userId: conn.user_id,
          connectionId: conn.id,
          propertyUrl,
          url: item.url,
          reason: msg,
          httpStatus: err.status,
          interventionId: item.interventionId,
        })
        if (err.status === 429) {
          markExhausted = true
          result.exhausted = true
          stoppedReason = 'quota'
          for (let j = i + 1; j < toInspect.length; j++) {
            const left = toInspect[j]!
            failed += 1
            deferred += 1
            result.deferred += 1
            await enqueueDeferred(supabase, {
              siteId: conn.site_id,
              userId: conn.user_id,
              connectionId: conn.id,
              propertyUrl,
              url: left.url,
              reason: 'quota_exhausted_mid_batch',
              interventionId: left.interventionId,
            })
          }
          break
        }
        continue
      }

      failed += 1
      await supabase.from('gsc_url_inspections').insert({
        site_id: conn.site_id,
        user_id: conn.user_id,
        connection_id: conn.id,
        url: item.url,
        url_normalized: norm(item.url),
        status: 'failed',
        verdict: null,
        raw_result: { error: msg },
        deltas: [],
        our_verdict: item.ourVerdict,
        our_robots_blocked: item.ourRobotsBlocked,
        intervention_id: item.interventionId ?? null,
      })
    }
  }

  // Unused reserved slots (e.g. early break without deferring) count as failed for honesty
  const accounted = succeeded + failed
  if (accounted < reservation.reserved && stoppedReason === 'complete') {
    failed += reservation.reserved - accounted
  }

  await recordQuotaOutcome(supabase, {
    propertyUrl,
    day: reservation.day,
    succeeded,
    failed,
    deferred,
    markExhausted,
  })

  if (blockedAdvanced > 0) {
    await saveBlockedCursor(supabase, {
      propertyUrl,
      siteId: conn.site_id,
      userId: conn.user_id,
      connectionId: conn.id,
      offset: blockedCursor + blockedAdvanced,
    })
  }

  if (stoppedReason === 'complete' && result.inspected >= batchCap) {
    stoppedReason = 'batch_cap'
  }

  result.remainingBudget = Math.max(0, reservation.remaining)
  result.exhausted = result.exhausted || result.remainingBudget <= 0 || markExhausted
  result.stoppedReason = stoppedReason
  return result
}

export async function syncAllUrlInspections(supabase: any): Promise<{
  synced: number
  failed: number
  results: InspectionSyncResult[]
}> {
  const { data: connections, error } = await supabase
    .from('gsc_connections')
    .select('id, property_url')
    .eq('status', 'active')
    .not('property_url', 'is', null)
    .order('updated_at', { ascending: true })

  if (error) throw new Error(error.message)

  const alreadyProcessedProperties = new Set<string>()
  const results: InspectionSyncResult[] = []
  let synced = 0
  let failed = 0
  const waveStarted = Date.now()

  for (const c of connections || []) {
    // Leave headroom inside the 60s Hobby envelope for the whole cron wave
    const elapsed = Date.now() - waveStarted
    if (elapsed >= GSC_INSPECTION_DEADLINE_MS) break

    try {
      const r = await syncUrlInspectionsForConnection(supabase, c.id, {
        alreadyProcessedProperties,
        deadlineMs: Math.max(5_000, GSC_INSPECTION_DEADLINE_MS - elapsed),
      })
      results.push(r)
      synced += 1
    } catch (err) {
      failed += 1
      results.push({
        siteId: '',
        propertyUrl: (c as { property_url?: string }).property_url || '',
        inspected: 0,
        skippedQuota: 0,
        skippedRecent: 0,
        skippedExcluded: 0,
        deferred: 0,
        remainingBudget: 0,
        exhausted: false,
        errors: [err instanceof Error ? err.message : String(err)],
        sampleDeltas: [],
      })
    }
  }
  return { synced, failed, results }
}
