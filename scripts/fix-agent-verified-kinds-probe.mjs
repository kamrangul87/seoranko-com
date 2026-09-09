#!/usr/bin/env node
/**
 * Read-only prod probe: verified Fix Agent attempts by auto_kind.
 * Evidence for “two additional GitHub strategies proven live”.
 */
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
  const enc = encodeURIComponent(pw)
  return `postgresql://postgres.${PROJECT_REF}:${enc}@${POOLER_HOST}:5432/postgres`
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
    const { rows } = await client.query(`
      SELECT auto_kind, status, COUNT(*)::int AS n
      FROM fix_agent_attempts
      WHERE status IN ('verified', 'unverified', 'failed', 'pr_pending', 'pending_deploy')
      GROUP BY auto_kind, status
      ORDER BY auto_kind, status
    `)
    const verifiedKinds = [
      ...new Set(rows.filter((r) => r.status === 'verified').map((r) => r.auto_kind)),
    ]
    const additional = verifiedKinds.filter((k) => k !== 'remove-dead-link')
    console.log(
      JSON.stringify(
        {
          ok: true,
          verifiedKinds,
          verifiedKindCount: verifiedKinds.length,
          additionalBeyondDeadLink: additional,
          byKindStatus: rows,
          actionRequired:
            additional.length < 2
              ? 'Approve and live-verify two additional existing GitHub strategies (e.g. meta-title, lang-attribute, schema-*) on a connected site.'
              : null,
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
