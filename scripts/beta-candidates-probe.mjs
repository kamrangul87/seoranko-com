#!/usr/bin/env node
/**
 * First-beta candidate inventory from hosted data — no assumptions.
 * Lists sites with connection evidence; flags dogfood vs external by domain only.
 */
import pg from 'pg'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'

/** Domains we treat as SEORANKO dogfood / first-party test — not “external customers”. */
const DOGFOOD_HOST_SUFFIXES = ['autodun.com', 'seoranko.com']

function dbUrl() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) return null
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:5432/postgres`
}

function isDogfood(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '')
  return DOGFOOD_HOST_SUFFIXES.some((s) => d === s || d.endsWith(`.${s}`))
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
    const sites = await client.query(`
      SELECT
        cs.id AS site_id,
        cs.domain,
        cs.user_id,
        sc.cms_type,
        sc.is_active AS cms_active,
        sc.last_verified_at AS cms_last_verified,
        gc.status AS gsc_status,
        gc.property_url,
        gc.last_sync_at AS gsc_last_sync,
        (SELECT COUNT(*)::int FROM fix_agent_attempts fa
          WHERE fa.site_id = cs.id AND fa.status = 'verified') AS verified_fixes,
        (SELECT COUNT(*)::int FROM fix_agent_attempts fa
          WHERE fa.site_id = cs.id) AS fix_attempts,
        (SELECT COUNT(*)::int FROM intervention_events ie
          WHERE ie.site_id = cs.id AND ie.lifecycle_state = 'verified') AS verified_interventions,
        (SELECT COUNT(*)::int FROM index_diagnosis_runs idr
          WHERE idr.user_id = cs.user_id AND idr.domain = cs.domain) AS diagnosis_runs,
        (SELECT COUNT(*)::int FROM gsc_url_inspections gi
          WHERE gi.site_id = cs.id) AS inspections
      FROM connected_sites cs
      LEFT JOIN site_connections sc ON sc.site_id = cs.id AND sc.user_id = cs.user_id
      LEFT JOIN gsc_connections gc ON gc.site_id = cs.id AND gc.user_id = cs.user_id
      ORDER BY cs.domain
    `)

    const rows = sites.rows.map((r) => {
      const dogfood = isDogfood(r.domain)
      const github = r.cms_type === 'github' && r.cms_active
      const gsc = r.gsc_status === 'active' && Boolean(r.property_url)
      const betaReadyShape = github && gsc
      const uid = String(r.user_id || '')
      return {
        domain: r.domain,
        dogfood,
        userIdPrefix: uid ? `${uid.slice(0, 8)}…` : null,
        cmsType: r.cms_type || null,
        cmsActive: Boolean(r.cms_active),
        githubWrite: github,
        gscActive: gsc,
        propertyUrl: r.property_url || null,
        verifiedFixes: r.verified_fixes,
        fixAttempts: r.fix_attempts,
        verifiedInterventions: r.verified_interventions,
        diagnosisRuns: r.diagnosis_runs,
        inspections: r.inspections,
        betaReadyShape,
        candidateClass: dogfood
          ? 'dogfood'
          : betaReadyShape
            ? 'external_beta_ready_shape'
            : github
              ? 'external_github_only'
              : gsc
                ? 'external_gsc_only'
                : 'incomplete',
      }
    })

    const externalReady = rows.filter((r) => r.candidateClass === 'external_beta_ready_shape')
    const dogfoodReady = rows.filter((r) => r.dogfood && r.betaReadyShape)
    const dogfoodAny = rows.filter((r) => r.dogfood)

    console.log(
      JSON.stringify(
        {
          ok: true,
          summary: {
            totalSites: rows.length,
            dogfoodSites: dogfoodAny.length,
            dogfoodWithGithubAndGsc: dogfoodReady.length,
            externalWithGithubAndGsc: externalReady.length,
            sitesWithVerifiedFix: rows.filter((r) => r.verifiedFixes > 0).length,
          },
          recommendation: {
            // Honest: do not assume autodun is “the customer”.
            firstValidationTarget:
              dogfoodReady.length > 0
                ? 'Complete dogfood end-to-end on autodun (or other dogfood host) until GSC inspection + 2 extra verified strategies exist — then recruit one external GitHub+GSC site.'
                : externalReady.length > 0
                  ? 'External site(s) already have GitHub+GSC shape — prefer one of those for first non-dogfood beta, after confirming owner consent.'
                  : 'No site currently has both active GitHub write and active GSC. Dogfood or external both need connections before calling Phase 4 complete.',
            autodunIsCustomer: false,
            autodunIsDogfood: dogfoodAny.some((r) => String(r.domain).includes('autodun')),
            needExternalForTrueBeta:
              externalReady.length === 0
                ? 'Yes — no external GitHub+GSC site in inventory yet (or none matched).'
                : 'Optional for first validation loop; external ready-shape sites exist — confirm consent before treating as customers.',
          },
          sites: rows,
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
