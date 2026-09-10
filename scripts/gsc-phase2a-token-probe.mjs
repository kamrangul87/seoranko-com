#!/usr/bin/env node
/**
 * Phase 2A Step 1 — prove the autodun GSC OAuth token still works.
 * Makes ONE live authenticated Search Console call (sites.list + tiny searchAnalytics).
 * Never prints refresh/access tokens.
 *
 * Env (hosted):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SITE_CONNECTION_ENCRYPTION_KEY,
 *   GOOGLE_GSC_CLIENT_ID, GOOGLE_GSC_CLIENT_SECRET
 *   (or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 *
 * Fallback (DB-only): SUPABASE_DB_PASSWORD — prints connection status/last_error
 * only (not a live Google call).
 */
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'

function dbUrl() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) return null
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:5432/postgres`
}

async function connectionSnapshotViaPg() {
  const url = dbUrl()
  if (!url) return null
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const conns = await client.query(
      `SELECT c.id, c.status, c.property_url, c.last_sync_at, c.last_error,
              s.domain, s.root_url
       FROM gsc_connections c
       LEFT JOIN connected_sites s ON s.id = c.site_id
       WHERE c.property_url ILIKE '%autodun%'
          OR s.domain ILIKE '%autodun%'
          OR s.root_url ILIKE '%autodun%'
       ORDER BY c.last_sync_at DESC NULLS LAST
       LIMIT 5`,
    )
    const metrics = await client.query(
      `SELECT max(date)::text AS latest_date, count(*)::int AS row_count
       FROM url_metrics_daily`,
    )
    const insp = await client.query(
      `SELECT count(*)::int AS n FROM gsc_url_inspections`,
    )
    const quota = await client.query(
      `SELECT count(*)::int AS n FROM gsc_inspection_quota_usage`,
    )
    return {
      connections: conns.rows,
      url_metrics_daily: metrics.rows[0],
      gsc_url_inspections: insp.rows[0]?.n ?? 0,
      gsc_inspection_quota_usage: quota.rows[0]?.n ?? 0,
    }
  } finally {
    await client.end()
  }
}

function hasLiveSecrets() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const enc = process.env.SITE_CONNECTION_ENCRYPTION_KEY || ''
  const cid = process.env.GOOGLE_GSC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ''
  const csec = process.env.GOOGLE_GSC_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || ''
  return Boolean(
    url &&
      !url.includes('127.0.0.1') &&
      !url.includes('example.supabase') &&
      key &&
      key !== 'placeholder' &&
      enc &&
      !enc.startsWith('test-') &&
      cid &&
      csec,
  )
}

async function main() {
  const snap = await connectionSnapshotViaPg().catch((e) => ({
    error: e instanceof Error ? e.message : String(e),
  }))

  if (!hasLiveSecrets()) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          step: '1',
          liveCall: false,
          blocked: true,
          reason: 'missing_hosted_gsc_secrets',
          needed: [
            'NEXT_PUBLIC_SUPABASE_URL (hosted)',
            'SUPABASE_SERVICE_ROLE_KEY',
            'SITE_CONNECTION_ENCRYPTION_KEY',
            'GOOGLE_GSC_CLIENT_ID',
            'GOOGLE_GSC_CLIENT_SECRET',
          ],
          dbSnapshot: snap,
          note:
            'Cannot decrypt refresh token or call Google without OAuth client + encryption key. DB snapshot (if present) shows connection status/last_error only.',
        },
        null,
        2,
      ),
    )
    process.exitCode = 2
    return
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  )

  const { data: sites } = await supabase
    .from('connected_sites')
    .select('id, domain, root_url')
    .or('domain.ilike.%autodun%,root_url.ilike.%autodun%')
    .limit(3)

  const siteIds = (sites || []).map((s) => s.id)
  let connQuery = supabase
    .from('gsc_connections')
    .select('id, site_id, property_url, status, refresh_token_encrypted, last_sync_at, last_error')
    .limit(5)

  if (siteIds.length) {
    connQuery = connQuery.in('site_id', siteIds)
  } else {
    connQuery = connQuery.ilike('property_url', '%autodun%')
  }

  const { data: conns, error } = await connQuery
  if (error) {
    console.log(JSON.stringify({ ok: false, step: '1', error: error.message }, null, 2))
    process.exitCode = 1
    return
  }
  if (!conns?.length) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          step: '1',
          liveCall: false,
          reason: 'no_autodun_gsc_connection',
          sites: sites || [],
          dbSnapshot: snap,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
    return
  }

  const conn = conns[0]
  const { decryptGscRefreshToken, refreshGscAccessToken } = await import(
    '../src/lib/gsc/oauth.ts'
  )
  const { listGscSites, fetchSearchAnalyticsPageDate, gscAvailableEndDate } = await import(
    '../src/lib/gsc/client.ts'
  )

  let refreshRaw
  try {
    const refreshToken = decryptGscRefreshToken(conn.refresh_token_encrypted)
    const refreshed = await refreshGscAccessToken(refreshToken)
    refreshRaw = {
      ok: true,
      expiresIn: refreshed.expiresIn,
      accessTokenLen: refreshed.accessToken.length,
    }

    const sitesList = await listGscSites(refreshed.accessToken)
    const autodunSites = sitesList.filter((s) => /autodun/i.test(s.siteUrl))

    const endDate = gscAvailableEndDate()
    // One-day window — minimal authenticated Analytics call for the property.
    const startDate = endDate
    let analyticsRaw
    try {
      const rows = await fetchSearchAnalyticsPageDate(
        refreshed.accessToken,
        conn.property_url,
        startDate,
        endDate,
      )
      analyticsRaw = {
        ok: true,
        propertyUrl: conn.property_url,
        startDate,
        endDate,
        rowCount: rows.length,
        sample: rows.slice(0, 3).map((r) => ({
          page: r.page,
          date: r.date,
          clicks: r.clicks,
          impressions: r.impressions,
        })),
      }
    } catch (err) {
      analyticsRaw = {
        ok: false,
        propertyUrl: conn.property_url,
        startDate,
        endDate,
        error: err instanceof Error ? err.message : String(err),
        status: err && typeof err === 'object' && 'status' in err ? err.status : undefined,
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: analyticsRaw.ok === true,
          step: '1',
          liveCall: true,
          connection: {
            id: conn.id,
            site_id: conn.site_id,
            property_url: conn.property_url,
            status: conn.status,
            last_sync_at: conn.last_sync_at,
            last_error: conn.last_error,
          },
          tokenRefresh: refreshRaw,
          sitesListRaw: {
            total: sitesList.length,
            autodun: autodunSites,
            sample: sitesList.slice(0, 5),
          },
          searchAnalyticsRaw: analyticsRaw,
          dbSnapshot: snap,
        },
        null,
        2,
      ),
    )
    if (!analyticsRaw.ok) process.exitCode = 1
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined
    console.log(
      JSON.stringify(
        {
          ok: false,
          step: '1',
          liveCall: true,
          tokenDead: code === 'gsc_token_expired' || /invalid_grant|expired/i.test(message),
          connection: {
            id: conn.id,
            property_url: conn.property_url,
            status: conn.status,
            last_sync_at: conn.last_sync_at,
            last_error: conn.last_error,
          },
          rawError: { message, code },
          restore:
            'Revoke SEORANKO in Google Account → Security → Third-party access, then reconnect Search Console from the dashboard (consent offline access) so a new refresh_token is stored.',
          silentFailureGap:
            'Daily /api/cron/gsc-sync records last_error on gsc_connections and returns JSON to Vercel cron logs only — no email, no in-app alert, no status check that pages when last_sync_at goes stale. Four days of failed syncs therefore leave only a quiet last_error / stale url_metrics_daily max(date).',
          dbSnapshot: snap,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
