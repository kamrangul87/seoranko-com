#!/usr/bin/env node
/**
 * Gate: no public-schema function may be EXECUTE-grantable to anon or
 * authenticated, unless explicitly allowlisted below with a reason.
 *
 * Checks the LIVE grant state via has_function_privilege() against the
 * hosted project -- not migration-file text, not advisor lint -- so it
 * catches the actual bug class found in 20260928090000: a REVOKE that
 * only touched PUBLIC while anon/authenticated kept their own explicit
 * grant, and any function created outside a reviewed migration (e.g. the
 * Supabase dashboard SQL editor, whose default privileges this repo's
 * migrations cannot change -- see that migration's comment).
 *
 * Runs after every `supabase db push` to main
 * (.github/workflows/supabase-migrate.yml) -- that job always has DB
 * credentials by the time this step runs, so missing credentials here is
 * a CI misconfiguration, not a reason to skip: this hard-fails rather
 * than warning, unlike the read-only probes in this directory.
 */
import pg from 'pg'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'

// Functions with a genuine reason to be anon/authenticated-executable via
// PostgREST RPC. Empty today -- every current public-schema function is
// either service-role-only internal logic or a trigger. Add an entry only
// with a one-line reason; do not add one to silence this check.
const ALLOWLIST = new Set([])

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
    console.error(
      '::error::check-function-grants: no DB credentials (SUPABASE_DB_PASSWORD / SUPABASE_DB_URL / DATABASE_URL). ' +
        'This check must run with live DB access -- fix the workflow, do not skip it.',
    )
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()
  let rows
  try {
    ;({ rows } = await client.query(`
      select
        p.proname as function_name,
        pg_get_function_identity_arguments(p.oid) as args,
        (select array_agg(r.rolname order by r.rolname) from pg_roles r
         where has_function_privilege(r.oid, p.oid, 'EXECUTE')
           and r.rolname in ('anon', 'authenticated')) as anon_or_auth_grants
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      order by function_name
    `))
  } finally {
    await client.end()
  }

  const offenders = rows.filter(
    (r) => r.anon_or_auth_grants?.length && !ALLOWLIST.has(r.function_name),
  )

  if (offenders.length > 0) {
    console.error(
      '::error::check-function-grants: function(s) EXECUTE-grantable to anon/authenticated via PostgREST RPC:',
    )
    for (const o of offenders) {
      console.error(
        `  public.${o.function_name}(${o.args}) -- granted to: ${o.anon_or_auth_grants.join(', ')}`,
      )
    }
    console.error(
      'Fix: REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated; then GRANT EXECUTE ' +
        'to only the role(s) that legitimately call it (usually service_role). ' +
        'If this function must be anon/authenticated-callable, add it to ALLOWLIST in this script with a reason.',
    )
    process.exit(1)
  }

  console.log(
    JSON.stringify({
      ok: true,
      checked: rows.length,
      allowlisted: [...ALLOWLIST],
    }),
  )
}

main().catch((err) => {
  console.error('::error::check-function-grants failed:', err.message)
  process.exit(1)
})
