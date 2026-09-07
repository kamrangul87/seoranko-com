/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GSC → url_metrics_daily sync (idempotent upsert).
 */

import { normalizeUrl } from '@/lib/supabase/audit-db'
import {
  decryptGscRefreshToken,
  refreshGscAccessToken,
} from '@/lib/gsc/oauth'
import {
  fetchSearchAnalyticsPageDate,
  gscAvailableEndDate,
  gscBackfillDateRange,
  isGscDateFinal,
  GscApiError,
} from '@/lib/gsc/client'
import { evaluateBaselineReadiness } from '@/lib/gsc/baseline-readiness'

export type GscSyncResult = {
  siteId: string
  propertyUrl: string
  startDate: string
  endDate: string
  rowsUpserted: number
  pagesFetched: number
  readinessPassed: boolean
  readinessReason: string
  error?: string
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function loadAccessToken(supabase: any, connection: {
  id: string
  refresh_token_encrypted: string
  status: string
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

export async function syncGscConnection(
  supabase: any,
  connectionId: string,
  opts?: { startDate?: string; endDate?: string; fullBackfill?: boolean },
): Promise<GscSyncResult> {
  const { data: conn, error: connErr } = await supabase
    .from('gsc_connections')
    .select('id, user_id, site_id, property_url, refresh_token_encrypted, status')
    .eq('id', connectionId)
    .maybeSingle()

  if (connErr || !conn) throw new Error(connErr?.message || 'GSC connection not found')
  if (!conn.property_url) {
    throw new Error('Pick a Search Console property before syncing.')
  }
  if (conn.status === 'revoked') {
    throw new Error('This Search Console connection was revoked. Reconnect to continue.')
  }

  const range = opts?.fullBackfill || (!opts?.startDate && !opts?.endDate)
    ? gscBackfillDateRange()
    : {
        startDate: opts?.startDate || gscBackfillDateRange().startDate,
        endDate: opts?.endDate || gscAvailableEndDate(),
      }

  if (!range.startDate || !range.endDate) {
    throw new Error('startDate and endDate are required for GSC sync')
  }

  let accessToken: string
  try {
    accessToken = await loadAccessToken(supabase, conn)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token refresh failed'
    await supabase
      .from('gsc_connections')
      .update({ last_error: message })
      .eq('id', conn.id)
    return {
      siteId: conn.site_id,
      propertyUrl: conn.property_url,
      startDate: range.startDate,
      endDate: range.endDate,
      rowsUpserted: 0,
      pagesFetched: 0,
      readinessPassed: false,
      readinessReason: 'token_error',
      error: message,
    }
  }

  let pagesFetched = 0
  let rows: Awaited<ReturnType<typeof fetchSearchAnalyticsPageDate>>
  try {
    rows = await fetchSearchAnalyticsPageDate(
      accessToken,
      conn.property_url,
      range.startDate,
      range.endDate,
      {
        onPage: () => {
          pagesFetched += 1
        },
      },
    )
  } catch (err) {
    const message =
      err instanceof GscApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'GSC sync failed'
    await supabase
      .from('gsc_connections')
      .update({
        last_error: message,
        status: err instanceof GscApiError && err.status === 401 ? 'expired' : conn.status,
      })
      .eq('id', conn.id)
    return {
      siteId: conn.site_id,
      propertyUrl: conn.property_url,
      startDate: range.startDate,
      endDate: range.endDate,
      rowsUpserted: 0,
      pagesFetched,
      readinessPassed: false,
      readinessReason: 'sync_error',
      error: message,
    }
  }

  const nowIso = new Date().toISOString()
  const upserts = rows
    .filter((r) => r.page && r.date)
    .map((r) => {
      let url: string
      try {
        url = normalizeUrl(r.page)
      } catch {
        url = r.page
      }
      return {
        site_id: conn.site_id,
        url,
        date: r.date,
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        ctr: r.ctr,
        avg_position: r.position,
        query_count: 0,
        is_final: isGscDateFinal(r.date),
        ingested_at: nowIso,
      }
    })

  let rowsUpserted = 0
  for (const batch of chunk(upserts, 500)) {
    const { error } = await supabase.from('url_metrics_daily').upsert(batch, {
      onConflict: 'site_id,url,date',
    })
    if (error) {
      await supabase
        .from('gsc_connections')
        .update({ last_error: error.message })
        .eq('id', conn.id)
      throw new Error(`url_metrics_daily upsert failed: ${error.message}`)
    }
    rowsUpserted += batch.length
  }

  // Load final metrics for readiness (full available final history for site).
  const { data: metricRows, error: metricsErr } = await supabase
    .from('url_metrics_daily')
    .select('url, date, impressions, clicks, avg_position, is_final')
    .eq('site_id', conn.site_id)
    .eq('is_final', true)

  if (metricsErr) {
    await supabase
      .from('gsc_connections')
      .update({ last_error: metricsErr.message, last_sync_at: nowIso })
      .eq('id', conn.id)
    throw new Error(metricsErr.message)
  }

  const readiness = evaluateBaselineReadiness(metricRows || [])
  await supabase.from('baseline_readiness_checks').insert({
    site_id: conn.site_id,
    user_id: conn.user_id,
    passed: readiness.passed,
    reason_code: readiness.reasonCode,
    evidence: readiness.evidence,
  })

  await supabase
    .from('gsc_connections')
    .update({
      last_sync_at: nowIso,
      last_error: null,
      status: 'active',
    })
    .eq('id', conn.id)

  return {
    siteId: conn.site_id,
    propertyUrl: conn.property_url,
    startDate: range.startDate,
    endDate: range.endDate,
    rowsUpserted,
    pagesFetched,
    readinessPassed: readiness.passed,
    readinessReason: readiness.reasonCode,
  }
}

export async function syncAllActiveGscConnections(supabase: any): Promise<{
  synced: number
  failed: number
  results: GscSyncResult[]
}> {
  const { data: connections, error } = await supabase
    .from('gsc_connections')
    .select('id')
    .eq('status', 'active')
    .not('property_url', 'is', null)

  if (error) throw new Error(error.message)

  const results: GscSyncResult[] = []
  let failed = 0
  for (const c of connections || []) {
    try {
      // Incremental: last 14 days covers provisional overwrite + recent finals.
      const endDate = gscAvailableEndDate()
      const startDateObj = new Date(`${endDate}T00:00:00.000Z`)
      startDateObj.setUTCDate(startDateObj.getUTCDate() - 14)
      const startDate = startDateObj.toISOString().slice(0, 10)
      const result = await syncGscConnection(supabase, c.id, { startDate, endDate })
      results.push(result)
      if (result.error) failed += 1
    } catch (err) {
      failed += 1
      results.push({
        siteId: '',
        propertyUrl: '',
        startDate: '',
        endDate: '',
        rowsUpserted: 0,
        pagesFetched: 0,
        readinessPassed: false,
        readinessReason: 'sync_error',
        error: err instanceof Error ? err.message : 'sync failed',
      })
    }
  }

  return { synced: (connections || []).length - failed, failed, results }
}
