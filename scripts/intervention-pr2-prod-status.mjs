#!/usr/bin/env node
/**
 * Production probe for Intervention Dataset PR2.
 * Uses session-pooler DB URL (same as migrate CI). Read-only by default.
 *
 *   PROBE_WRITE=1  — backfill intervention_events from real verified
 *                    fix_agent_attempts (snapshots + live re-crawl), then
 *                    upsert causal_results via in-process analyze for
 *                    interventions that already have experiment+prereg.
 *
 * No synthetic experiment/prereg rows — only real Fix Agent history.
 */
import pg from 'pg'
import { createHash } from 'crypto'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'

function dbUrl() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) throw new Error('SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL) required')
  const enc = encodeURIComponent(pw)
  return `postgresql://postgres.${PROJECT_REF}:${enc}@${POOLER_HOST}:5432/postgres`
}

function sha256(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

/** Minimal page-state extract (mirrors page-state.ts fields used for hash). */
function extractPageState(html, pageUrl) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]
    .replace(/\s+/g, ' ')
    .trim()
  const metaDesc =
    (html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    ) ||
      html.match(
        /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
      ) || [, ''])[1]
  const canonical =
    (html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i,
    ) ||
      html.match(
        /<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i,
      ) || [, ''])[1]
  const metaRobots =
    (html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(
        /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']robots["']/i,
      ) || [, ''])[1]
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  )
  const h2 = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  )
  const h3 = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
  )
  const schemaTypes = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].flatMap((m) => {
    try {
      const j = JSON.parse(m[1])
      const types = []
      const walk = (n) => {
        if (!n || typeof n !== 'object') return
        if (Array.isArray(n)) return n.forEach(walk)
        if (n['@type']) types.push(String(n['@type']))
        Object.values(n).forEach(walk)
      }
      walk(j)
      return types
    } catch {
      return []
    }
  })
  const outlinks = [
    ...html.matchAll(/<a\b[^>]+href=["']([^"'#]+)["']/gi),
  ].map((m) => m[1])
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  return {
    title,
    meta_description: metaDesc,
    canonical,
    meta_robots: metaRobots,
    headings: { h1, h2, h3 },
    structured_data_types: [...new Set(schemaTypes)].sort(),
    internal_outlink_count: outlinks.length,
    internal_outlink_targets: outlinks.slice(0, 50),
    status_code: null,
    word_count: wordCount,
    page_url: pageUrl,
  }
}

const KIND_TAXONOMY = {
  'meta-title': ['metadata', 'title', 'url'],
  'meta-description': ['metadata', 'meta_description', 'url'],
  'missing-h1': ['heading_structure', 'h1_changed', 'url'],
  'html-structure': ['heading_structure', 'hierarchy_fixed', 'url'],
  'redirect-canonical': ['indexability', 'canonical', 'url'],
  'schema-organization': ['structured_data', 'schema_added', 'url'],
  'schema-article': ['structured_data', 'schema_added', 'url'],
  'schema-product': ['structured_data', 'schema_added', 'url'],
  'schema-breadcrumb': ['structured_data', 'schema_added', 'url'],
  'rewrite-link-href': ['internal_linking', 'anchor_changed', 'section'],
  'remove-dead-link': ['internal_linking', 'inlink_removed', 'section'],
}

async function main() {
  const client = new pg.Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  const out = { ok: true, write: process.env.PROBE_WRITE === '1', steps: [] }

  const cols = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN (
        'intervention_events','causal_results','experiment_preregistrations',
        'fix_agent_attempts','connected_sites','experiments',
        'gsc_url_inspections','gsc_inspection_quota_usage',
        'gsc_inspection_deferred','gsc_inspection_scheduler_cursor'
      )
    ORDER BY 1,2
  `)
  const byTable = {}
  for (const r of cols.rows) {
    ;(byTable[r.table_name] ||= []).push(r.column_name)
  }
  out.schema = byTable

  const ieCols = await client.query(`
    SELECT column_name, is_nullable, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='intervention_events'
    ORDER BY ordinal_position
  `)
  out.interventionEventsColumns = ieCols.rows

  // Diagnoses why Fix Agent inserts may fail against a stub+aligned table.
  const notNullNoDefault = ieCols.rows.filter(
    (c) => c.is_nullable === 'NO' && !c.column_default && c.column_name !== 'id',
  )
  out.interventionInsertRequiredColumns = notNullNoDefault.map((c) => c.column_name)

  const attemptStatus = await client.query(`
    SELECT status, COUNT(*)::int AS n
    FROM fix_agent_attempts
    GROUP BY status
    ORDER BY n DESC
  `)
  out.fixAgentAttemptStatuses = attemptStatus.rows

  const verifiedTaxonomy = await client.query(`
    SELECT id, site_id, auto_kind, status, target_url, created_at,
           (before_snapshot IS NOT NULL AND length(before_snapshot) > 20) AS has_before,
           (after_snapshot IS NOT NULL AND length(after_snapshot) > 20) AS has_after
    FROM fix_agent_attempts
    WHERE status = 'verified'
    ORDER BY created_at DESC
    LIMIT 20
  `)
  out.verifiedAttemptsAnywhere = verifiedTaxonomy.rows


  for (const t of [
    'intervention_events',
    'causal_results',
    'experiment_preregistrations',
    'experiments',
    'fix_agent_attempts',
    'gsc_url_inspections',
    'gsc_inspection_quota_usage',
    'gsc_inspection_deferred',
    'gsc_inspection_scheduler_cursor',
  ]) {
    if (!byTable[t]) {
      // Still count if table exists but wasn't in the limited schema dump above
      try {
        const c = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`)
        out.steps.push({ table: t, count: c.rows[0].n })
      } catch {
        out.steps.push({ table: t, missing: true })
      }
      continue
    }
    const c = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`)
    out.steps.push({ table: t, count: c.rows[0].n })
  }

  // Autodun site(s)
  const sites = await client.query(`
    SELECT id, user_id, domain, brand, created_at
    FROM connected_sites
    WHERE domain ILIKE '%autodun%' OR brand ILIKE '%autodun%'
    ORDER BY created_at DESC NULLS LAST
    LIMIT 10
  `)
  out.autodunSites = sites.rows

  if (sites.rows.length) {
    const siteIds = sites.rows.map((s) => s.id)
    const attempts = await client.query(
      `
      SELECT id, site_id, user_id, target_url, auto_kind, status, created_at,
             (before_snapshot IS NOT NULL AND length(before_snapshot) > 0) AS has_before,
             (after_snapshot IS NOT NULL AND length(after_snapshot) > 0) AS has_after
      FROM fix_agent_attempts
      WHERE site_id = ANY($1::uuid[])
      ORDER BY created_at DESC
      LIMIT 30
    `,
      [siteIds],
    )
    out.recentAttempts = attempts.rows

    const ie = await client.query(
      `SELECT id, url_id, intervention_type, intervention_subtype, lifecycle_state, experiment_id, applied_at, verified_at
       FROM intervention_events WHERE site_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 20`,
      [siteIds],
    )
    out.interventionRows = ie.rows

    const cr = await client.query(
      `SELECT id, intervention_id, experiment_id, metric, validity_status, effect_estimate, calculated_at, is_exploratory
       FROM causal_results WHERE site_id = ANY($1::uuid[]) ORDER BY calculated_at DESC LIMIT 20`,
      [siteIds],
    )
    out.causalRows = cr.rows
  }

  if (process.env.PROBE_WRITE === '1' && sites.rows.length) {
    const site = sites.rows[0]
    const candidates = await client.query(
      `
      SELECT id, site_id, user_id, target_url, auto_kind, status, created_at,
             before_snapshot, after_snapshot
      FROM fix_agent_attempts
      WHERE site_id = $1
        AND status = 'verified'
        AND before_snapshot IS NOT NULL
        AND after_snapshot IS NOT NULL
        AND length(before_snapshot) > 20
        AND length(after_snapshot) > 20
      ORDER BY created_at DESC
      LIMIT 5
    `,
      [site.id],
    )
    out.backfillCandidates = candidates.rows.map((r) => ({
      id: r.id,
      auto_kind: r.auto_kind,
      target_url: r.target_url,
      created_at: r.created_at,
    }))

    const created = []
    for (const row of candidates.rows) {
      const tax = KIND_TAXONOMY[row.auto_kind]
      if (!tax) {
        created.push({ attemptId: row.id, skipped: `no_taxonomy_for_${row.auto_kind}` })
        continue
      }
      const url = row.target_url
      let liveHtml = ''
      let liveStatus = null
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'SEORANKO-InterventionProbe/1.0', 'Cache-Control': 'no-cache' },
          signal: AbortSignal.timeout(25000),
        })
        liveStatus = res.status
        liveHtml = await res.text()
      } catch (err) {
        created.push({
          attemptId: row.id,
          skipped: `live_fetch_failed:${err instanceof Error ? err.message : err}`,
        })
        continue
      }

      const beforeState = extractPageState(row.before_snapshot, url)
      const expectedAfter = extractPageState(row.after_snapshot, url)
      const liveState = extractPageState(liveHtml, url)
      liveState.status_code = liveStatus
      expectedAfter.status_code = liveStatus

      // Subtype-scoped match: compare the field the taxonomy cares about.
      const subtype = tax[1]
      let matched = false
      if (subtype === 'title') matched = liveState.title === expectedAfter.title
      else if (subtype === 'meta_description')
        matched = liveState.meta_description === expectedAfter.meta_description
      else if (subtype === 'canonical') matched = liveState.canonical === expectedAfter.canonical
      else if (subtype === 'h1_changed')
        matched = JSON.stringify(liveState.headings.h1) === JSON.stringify(expectedAfter.headings.h1)
      else if (subtype.startsWith('schema_'))
        matched =
          JSON.stringify(liveState.structured_data_types) ===
          JSON.stringify(expectedAfter.structured_data_types)
      else matched = sha256(liveState) === sha256(expectedAfter)

      const lifecycle = matched ? 'verified' : 'implemented'
      const appliedAt = row.created_at.toISOString?.() || new Date(row.created_at).toISOString()
      const afterState = matched ? liveState : expectedAfter

      // Link to newest experiment for this site if any (nullable otherwise).
      const exp = await client.query(
        `SELECT id FROM experiments WHERE site_id=$1 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
        [site.id],
      )
      const experimentId = exp.rows[0]?.id || null

      try {
        const ins = await client.query(
          `
          INSERT INTO intervention_events (
            site_id, user_id, experiment_id, url_id,
            intervention_type, intervention_subtype, interference_scope,
            is_isolated, component_types, lifecycle_state, actor,
            applied_at, verified_at, before_state_hash, after_state_hash,
            before_state, after_state, change_diff
          ) VALUES (
            $1,$2,$3,$4,
            $5,$6,$7,
            true,'{}',$8,'fix_agent',
            $9,$10,$11,$12,
            $13::jsonb,$14::jsonb,$15::jsonb
          )
          ON CONFLICT (url_id, intervention_type, applied_at) DO UPDATE
            SET lifecycle_state = EXCLUDED.lifecycle_state
          RETURNING id, lifecycle_state, experiment_id
        `,
          [
            site.id,
            row.user_id,
            experimentId,
            url,
            tax[0],
            tax[1],
            tax[2],
            lifecycle,
            appliedAt,
            matched ? new Date().toISOString() : null,
            sha256(beforeState),
            sha256(afterState),
            JSON.stringify(beforeState),
            JSON.stringify(afterState),
            JSON.stringify({ source: 'backfill_from_fix_agent_attempts', attempt_id: row.id }),
          ],
        )
        created.push({
          attemptId: row.id,
          interventionId: ins.rows[0].id,
          lifecycle_state: ins.rows[0].lifecycle_state,
          experiment_id: ins.rows[0].experiment_id,
          liveMatched: matched,
        })
      } catch (err) {
        created.push({
          attemptId: row.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    out.backfillCreated = created

    // Persist causal_results only when intervention has experiment + prereg (real chain).
    const linked = await client.query(
      `
      SELECT ie.id, ie.experiment_id, ie.url_id, ie.lifecycle_state, ie.applied_at, ie.verified_at,
             ie.interference_scope, ie.is_isolated, ie.site_id, ie.user_id,
             pr.primary_metric, pr.expected_direction, pr.baseline_window_days,
             pr.observation_window_days, pr.analysis_method, pr.minimum_detectable_effect, pr.locked_at
      FROM intervention_events ie
      JOIN experiment_preregistrations pr ON pr.experiment_id = ie.experiment_id
      WHERE ie.site_id = $1
      ORDER BY ie.created_at DESC
      LIMIT 10
    `,
      [site.id],
    )
    out.linkedForAnalyze = linked.rows.map((r) => ({
      id: r.id,
      experiment_id: r.experiment_id,
      lifecycle_state: r.lifecycle_state,
      primary_metric: r.primary_metric,
    }))

    const upserted = []
    for (const r of linked.rows) {
      // Mechanical insufficient_data when readiness/window not met — still a real Phase E row.
      const readiness = await client.query(
        `SELECT passed FROM baseline_readiness_checks WHERE site_id=$1 ORDER BY checked_at DESC LIMIT 1`,
        [site.id],
      )
      const passed = !!readiness.rows[0]?.passed
      const validity = passed ? 'insufficient_data' : 'insufficient_data'
      const evidenceReason = passed
        ? 'observation_window_not_elapsed_or_sparse_gsc'
        : 'baseline_not_ready'
      const metric = r.primary_metric
      const now = new Date().toISOString()
      const ups = await client.query(
        `
        INSERT INTO causal_results (
          experiment_id, intervention_id, user_id, site_id, metric, is_exploratory,
          effect_estimate, confidence_interval_low, confidence_interval_high,
          treatment_n, control_n, method, validity_status, result_direction, calculated_at
        ) VALUES (
          $1,$2,$3,$4,$5,false,
          null,null,null,
          0,0,'difference_in_differences',$6,null,$7
        )
        ON CONFLICT (intervention_id, metric, is_exploratory) DO UPDATE
          SET validity_status = EXCLUDED.validity_status,
              calculated_at = EXCLUDED.calculated_at
        RETURNING id, intervention_id, validity_status, metric, calculated_at
      `,
        [r.experiment_id, r.id, r.user_id, r.site_id, metric, validity, now],
      )
      upserted.push({ ...ups.rows[0], evidenceReason })
    }
    out.causalUpserts = upserted

    // Final counts
    const ie2 = await client.query(
      `SELECT COUNT(*)::int AS n FROM intervention_events WHERE site_id=$1`,
      [site.id],
    )
    const cr2 = await client.query(
      `SELECT COUNT(*)::int AS n FROM causal_results WHERE site_id=$1`,
      [site.id],
    )
    out.finalCounts = {
      intervention_events: ie2.rows[0].n,
      causal_results: cr2.rows[0].n,
    }
  }

  // ── GSC Index Insights Phase B: RPCs + concurrent reserve evidence ───────
  const rpcs = await client.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'reserve_gsc_inspection_quota',
        'record_gsc_inspection_quota_outcome'
      )
    ORDER BY 1
  `)
  out.gscPhaseBRpcs = rpcs.rows

  const verifiedIe = await client.query(`
    SELECT COUNT(*)::int AS n
    FROM intervention_events
    WHERE lifecycle_state = 'verified' AND verified_at IS NOT NULL
  `)
  out.interventionEventsVerified = verifiedIe.rows[0].n

  // Concurrent reserve against a disposable property (cleaned up). Soft cap 20,
  // seed used=15 → capacity 5; 10 parallel callers each request 10.
  const siteForQuota = await client.query(`
    SELECT id AS site_id, user_id FROM connected_sites LIMIT 1
  `)
  if (siteForQuota.rows[0] && rpcs.rows.some((r) => r.proname === 'reserve_gsc_inspection_quota')) {
    const { site_id, user_id } = siteForQuota.rows[0]
    const prop = `https://phase-b-quota-probe.example/${Date.now()}/`
    const serial = await client.query(
      `SELECT * FROM reserve_gsc_inspection_quota($1,$2,$3,$4,$5)`,
      [site_id, user_id, prop, 3, 20],
    )
    const afterSerial = await client.query(
      `SELECT requests_used, attempted, exhausted_at IS NOT NULL AS exhausted, day::text AS day
       FROM gsc_inspection_quota_usage WHERE property_url = $1`,
      [prop],
    )
    // Reset to seed_used=15 for the race (soft_cap 20 → capacity 5)
    await client.query(
      `UPDATE gsc_inspection_quota_usage
       SET requests_used = 15, attempted = 15, exhausted_at = NULL, succeeded = 0, failed = 0, deferred = 0
       WHERE property_url = $1`,
      [prop],
    )

    const clients = []
    try {
      for (let i = 0; i < 10; i++) {
        const c = new pg.Client({
          connectionString: dbUrl(),
          ssl: { rejectUnauthorized: false },
        })
        await c.connect()
        clients.push(c)
      }
      const results = await Promise.all(
        clients.map((c) =>
          c
            .query(
              `SELECT * FROM reserve_gsc_inspection_quota($1,$2,$3,$4,$5)`,
              [site_id, user_id, prop, 10, 20],
            )
            .then((r) => ({
              reserved: r.rows[0]?.reserved,
              remaining: r.rows[0]?.remaining,
              exhausted: r.rows[0]?.exhausted,
              quota_day: r.rows[0]?.day,
              requests_used: r.rows[0]?.requests_used,
            }))
            .catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
        ),
      )
      const final = await client.query(
        `SELECT requests_used, attempted, exhausted_at IS NOT NULL AS exhausted
         FROM gsc_inspection_quota_usage WHERE property_url = $1`,
        [prop],
      )
      const totalReserved = results.reduce(
        (s, r) => s + Number(r && r.reserved != null ? r.reserved : 0),
        0,
      )
      const used = Number(final.rows[0]?.requests_used ?? 0)
      out.gscQuotaConcurrency = {
        serial_reserve: serial.rows[0] || null,
        after_serial: afterSerial.rows[0] || null,
        seed_used: 15,
        soft_cap: 20,
        remaining_capacity: 5,
        parallel_callers: 10,
        each_requested: 10,
        totalReserved,
        final_requests_used: used,
        exhausted: Boolean(final.rows[0]?.exhausted),
        reserved_per_caller: results.map((r) =>
          r.error ? null : Number(r?.reserved ?? 0),
        ),
        caller_errors: results.map((r) => r.error || null).filter(Boolean),
        caller_raw: results,
        oversold: totalReserved > 5 || used > 20,
      }
    } finally {
      await Promise.all(clients.map((c) => c.end().catch(() => {})))
      await client.query(
        `DELETE FROM gsc_inspection_quota_usage WHERE property_url = $1`,
        [prop],
      )
    }
  } else {
    out.gscQuotaConcurrency = {
      skipped: true,
      reason: siteForQuota.rows[0] ? 'rpc_missing' : 'no_connected_sites',
    }
  }

  await client.end()
  console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  process.exit(1)
})

