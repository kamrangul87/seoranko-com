#!/usr/bin/env node
/**
 * Read-only: count rows each buildInspectionQueue source would see for autodun.
 * Mirrors predicates in src/lib/gsc/inspection-scheduler.ts (no writes).
 *
 * Env: SUPABASE_DB_PASSWORD (+ optional PROJECT_REF / POOLER_HOST / DB_URL)
 */
import pg from 'pg'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'
const SITE = process.env.GSC_PROBE_SITE_ID || '50b305a3-baab-49ce-8966-04796b8b27c4'

function dbUrl() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) return null
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:5432/postgres`
}

function normalizeDomainKey(domain) {
  return String(domain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

async function main() {
  const url = dbUrl()
  if (!url) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'no_db_credentials' }))
    return
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const conn = await client.query(
      `SELECT c.id, c.user_id, c.site_id, c.property_url, c.status,
              c.last_sync_at, c.last_error, s.domain
       FROM gsc_connections c
       LEFT JOIN connected_sites s ON s.id = c.site_id
       WHERE c.site_id = $1
       ORDER BY c.last_sync_at DESC NULLS LAST
       LIMIT 1`,
      [SITE],
    )
    if (!conn.rows.length) {
      console.log(JSON.stringify({ ok: false, error: 'no_gsc_connection_for_site', siteId: SITE }))
      process.exitCode = 1
      return
    }
    const c = conn.rows[0]
    const domain = normalizeDomainKey(c.domain)
    const propertyUrl = c.property_url

    // 1) Diagnosis pages (latest run for user_id + domain)
    const diag = await client.query(
      `SELECT id, domain, created_at,
              CASE WHEN jsonb_typeof(pages)='array' THEN jsonb_array_length(pages) ELSE 0 END AS pages_len,
              CASE WHEN coverage ? 'sitemapDiscoveredUrls'
                THEN jsonb_array_length(COALESCE(coverage->'sitemapDiscoveredUrls','[]'::jsonb))
                ELSE 0 END AS sitemap_urls,
              CASE WHEN coverage ? 'excluded'
                THEN jsonb_array_length(COALESCE(coverage->'excluded','[]'::jsonb))
                ELSE 0 END AS excluded_len,
              (
                SELECT count(*)::int FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(pages)='array' THEN pages ELSE '[]'::jsonb END
                ) p
                WHERE COALESCE(p->>'verdict','') = 'BLOCKED'
                   OR EXISTS (
                     SELECT 1 FROM jsonb_array_elements(COALESCE(coverage->'excluded','[]'::jsonb)) e
                     WHERE e->>'url' IS NOT NULL
                   )
              ) AS pages_blocked_or_excluded_approx
       FROM index_diagnosis_runs
       WHERE user_id = $1 AND domain = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [c.user_id, domain],
    )
    const diagAny = await client.query(
      `SELECT id, domain, created_at,
              CASE WHEN jsonb_typeof(pages)='array' THEN jsonb_array_length(pages) ELSE 0 END AS pages_len
       FROM index_diagnosis_runs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [c.user_id],
    )

    // Count crawl-eligible pages: not BLOCKED and url not in excluded set (SQL mirror)
    let diagnosisEligible = 0
    let diagnosisBlockedSample = 0
    let sitemapEligible = 0
    let sitemapBlocked = 0
    if (diag.rows[0]) {
      const pagesElig = await client.query(
        `WITH run AS (
           SELECT pages, coverage FROM index_diagnosis_runs WHERE id = $1
         ),
         excluded AS (
           SELECT lower(trim(trailing '/' from e->>'url')) AS u
           FROM run, jsonb_array_elements(COALESCE(coverage->'excluded','[]'::jsonb)) e
           WHERE e->>'url' IS NOT NULL
         ),
         pages AS (
           SELECT p->>'url' AS url, p->>'verdict' AS verdict
           FROM run, jsonb_array_elements(CASE WHEN jsonb_typeof(pages)='array' THEN pages ELSE '[]'::jsonb END) p
           WHERE p->>'url' IS NOT NULL AND p->>'url' <> ''
         )
         SELECT
           count(*) FILTER (WHERE verdict = 'BLOCKED' OR EXISTS (SELECT 1 FROM excluded e WHERE e.u = lower(trim(trailing '/' from pages.url))))::int AS blocked_sample,
           count(*) FILTER (WHERE verdict IS DISTINCT FROM 'BLOCKED' AND NOT EXISTS (SELECT 1 FROM excluded e WHERE e.u = lower(trim(trailing '/' from pages.url))))::int AS eligible
         FROM pages`,
        [diag.rows[0].id],
      )
      diagnosisEligible = pagesElig.rows[0]?.eligible ?? 0
      diagnosisBlockedSample = pagesElig.rows[0]?.blocked_sample ?? 0

      const sm = await client.query(
        `WITH run AS (
           SELECT coverage FROM index_diagnosis_runs WHERE id = $1
         ),
         excluded AS (
           SELECT lower(trim(trailing '/' from e->>'url')) AS u
           FROM run, jsonb_array_elements(COALESCE(coverage->'excluded','[]'::jsonb)) e
           WHERE e->>'url' IS NOT NULL
         ),
         sm AS (
           SELECT value AS url
           FROM run,
                jsonb_array_elements_text(COALESCE(coverage->'sitemapDiscoveredUrls','[]'::jsonb)) AS value
         )
         SELECT
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM excluded e WHERE e.u = lower(trim(trailing '/' from sm.url))))::int AS blocked,
           count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM excluded e WHERE e.u = lower(trim(trailing '/' from sm.url))))::int AS eligible,
           count(*)::int AS total
         FROM sm`,
        [diag.rows[0].id],
      )
      sitemapEligible = sm.rows[0]?.eligible ?? 0
      sitemapBlocked = sm.rows[0]?.blocked ?? 0
    }

    // 3) Metrics — NO date window (exact code predicate)
    const metrics = await client.query(
      `SELECT count(*)::int AS row_count,
              count(DISTINCT url)::int AS distinct_urls,
              max(date)::text AS freshest_date,
              min(date)::text AS oldest_date
       FROM url_metrics_daily
       WHERE site_id = $1 AND impressions > 0`,
      [SITE],
    )
    const metricsWindow = await client.query(
      `SELECT
         count(DISTINCT url) FILTER (WHERE date >= (CURRENT_DATE - 3))::int AS distinct_last_3d,
         count(DISTINCT url) FILTER (WHERE date >= (CURRENT_DATE - 5))::int AS distinct_last_5d,
         count(DISTINCT url) FILTER (WHERE date >= (CURRENT_DATE - 7))::int AS distinct_last_7d,
         CURRENT_DATE::text AS today
       FROM url_metrics_daily
       WHERE site_id = $1 AND impressions > 0`,
      [SITE],
    )

    // 4) Deferred
    const deferred = await client.query(
      `SELECT
         count(*) FILTER (WHERE status = 'pending' AND next_attempt_at <= now())::int AS pending_due,
         count(*) FILTER (WHERE status = 'pending')::int AS pending_any,
         count(*)::int AS all_rows
       FROM gsc_inspection_deferred
       WHERE property_url = $1`,
      [propertyUrl],
    )

    // 5) Interventions
    const interv = await client.query(
      `SELECT id, COALESCE(NULLIF(url_id,''), NULLIF(url,'')) AS page_url, verified_at
       FROM intervention_events
       WHERE lifecycle_state = 'verified'
         AND site_id = $1
         AND verified_at IS NOT NULL
       ORDER BY verified_at DESC
       LIMIT 40`,
      [SITE],
    )
    const intervWithUrl = interv.rows.filter((r) => r.page_url)

    // Post-filter
    const recent = await client.query(
      `SELECT count(*)::int AS n
       FROM gsc_url_inspections
       WHERE site_id = $1 AND status = 'succeeded'
         AND inspected_at >= (now() - interval '3 days')`,
      [SITE],
    )
    const totals = await client.query(
      `SELECT
         (SELECT count(*)::int FROM gsc_url_inspections) AS inspections_total,
         (SELECT count(*)::int FROM gsc_inspection_quota_usage) AS quota_rows_total`,
    )

    const metricsDistinct = metrics.rows[0]?.distinct_urls ?? 0
    // Lower bound on non-empty queue if metrics alone contribute (recent filter empty)
    const expectedQueueLowerBound =
      metricsDistinct +
      (intervWithUrl.length > 0 ? 1 : 0) +
      (deferred.rows[0]?.pending_due || 0) +
      diagnosisEligible +
      sitemapEligible

    console.log(
      JSON.stringify(
        {
          ok: true,
          siteId: SITE,
          connection: {
            id: c.id,
            userId: c.user_id,
            propertyUrl,
            status: c.status,
            domain,
            last_sync_at: c.last_sync_at,
            last_error: c.last_error,
          },
          sources: {
            diagnosis: {
              predicate:
                "index_diagnosis_runs WHERE user_id = conn.user_id AND domain = normalize(connected_sites.domain) ORDER BY created_at DESC LIMIT 1; pages[] → byUrl unless excluded or verdict=BLOCKED",
              latestRun: diag.rows[0] || null,
              eligiblePages: diagnosisEligible,
              blockedSamplePages: diagnosisBlockedSample,
              otherRunsForUser: diagAny.rows,
              note:
                diag.rows.length === 0
                  ? 'No diagnosis run for exact domain match — source contributes 0'
                  : undefined,
            },
            sitemap: {
              predicate:
                'Same diagnosis coverage.sitemapDiscoveredUrls; excluded → blocked_sample else merge priority≥50 source=sitemap',
              sitemapUrlCount: diag.rows[0]?.sitemap_urls ?? 0,
              eligible: sitemapEligible,
              blocked: sitemapBlocked,
            },
            metrics: {
              predicate:
                'url_metrics_daily WHERE site_id = opts.siteId AND impressions > 0 ORDER BY impressions DESC LIMIT 2000 — NO date filter',
              rowCount: metrics.rows[0]?.row_count ?? 0,
              distinctUrls: metricsDistinct,
              freshestDate: metrics.rows[0]?.freshest_date ?? null,
              oldestDate: metrics.rows[0]?.oldest_date ?? null,
              hypotheticalDateWindows: metricsWindow.rows[0],
              dateWindowInCode: false,
            },
            deferred: {
              predicate:
                "gsc_inspection_deferred WHERE property_url = opts.propertyUrl AND status='pending' AND next_attempt_at <= now() ORDER BY created_at ASC LIMIT batchCap",
              propertyUrl,
              pendingDue: deferred.rows[0]?.pending_due ?? 0,
              pendingAny: deferred.rows[0]?.pending_any ?? 0,
              allRows: deferred.rows[0]?.all_rows ?? 0,
            },
            interventions: {
              predicate:
                "intervention_events WHERE lifecycle_state='verified' AND site_id = opts.siteId AND verified_at IS NOT NULL LIMIT 40 (fallback: user_id + host match)",
              verifiedWithSiteId: interv.rows.length,
              withResolvableUrl: intervWithUrl.length,
              sample: intervWithUrl.slice(0, 5).map((r) => ({
                id: r.id,
                page_url: r.page_url,
                verified_at: r.verified_at,
              })),
            },
          },
          postFilter: {
            recentSucceededInspections3d: recent.rows[0]?.n ?? 0,
            inspectionsTotal: totals.rows[0]?.inspections_total ?? 0,
            quotaRowsTotal: totals.rows[0]?.quota_rows_total ?? 0,
          },
          implication: {
            dateWindowSuspicion: 'DISPROVEN — metrics source has no date predicate',
            metricsAloneShouldYieldQueueLenAtLeast: metricsDistinct,
            expectedQueueLowerBoundRough: expectedQueueLowerBound,
            ifQuotaStillZero:
              'Empty-queue before reserve is unlikely given metrics distinct URLs; prefer inspection path never reached reserve (throw/skip) or never invoked — check last_error after 4b4f011 + next cron',
          },
        },
        null,
        2,
      ),
    )
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  )
  process.exit(1)
})
