#!/usr/bin/env node
/**
 * Gate: every migration that CREATE TABLEs in public must, in the same file,
 * ENABLE ROW LEVEL SECURITY and GRANT table privileges to service_role.
 *
 * Why: From 30 Oct 2026, Supabase no longer auto-grants Data API privileges
 * on new public tables. Missing grants → silent empty API reads/writes.
 *
 * Historical migrations before ENFORCE_FROM are grandfathered — do not rewrite
 * them to add grants (do not touch existing tables' grants).
 *
 * Usage:
 *   node scripts/check-migration-grants.mjs
 *   node scripts/check-migration-grants.mjs --self-test
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

/** Migrations with version < this are not checked (grandfathered). */
export const ENFORCE_FROM = '20261022100000'

function stripSqlComments(sql) {
  // Remove /* ... */ then -- line comments (not inside strings — good enough for gates).
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
  out = out.replace(/--[^\n]*/g, ' ')
  return out
}

/**
 * @returns {string[]} unqualified table names created in public
 */
export function extractPublicCreateTables(sql) {
  const body = stripSqlComments(sql)
  const tables = []
  const re =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(public)\s*\.\s*)?("([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/gi
  let m
  while ((m = re.exec(body)) !== null) {
    const schema = m[1] ? m[1].toLowerCase() : 'public'
    if (schema !== 'public') continue
    const name = (m[3] || m[4] || '').toLowerCase()
    if (!name) continue
    // Skip CREATE TABLE ... AS SELECT false positives? name is fine.
    tables.push(name)
  }
  return [...new Set(tables)]
}

export function hasRlsEnabled(sql, table) {
  const body = stripSqlComments(sql)
  const t = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(
      `ALTER\\s+TABLE\\s+(?:public\\s*\\.\\s*)?(?:${t}|"${t}")\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i',
    ),
    new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\s*\\.\\s*)?(?:${t}|"${t}")\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i',
    ),
  ]
  return patterns.some((p) => p.test(body))
}

export function hasServiceRoleGrant(sql, table) {
  const body = stripSqlComments(sql)
  const t = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // GRANT ALL | GRANT SELECT, INSERT, UPDATE, DELETE [ON TABLE] public.t TO service_role
  const re = new RegExp(
    `GRANT\\s+(?:ALL(?:\\s+PRIVILEGES)?|SELECT\\s*,\\s*INSERT\\s*,\\s*UPDATE\\s*,\\s*DELETE)\\s+ON\\s+(?:TABLE\\s+)?(?:public\\s*\\.\\s*)?(?:${t}|"${t}")\\s+TO\\s+service_role\\b`,
    'i',
  )
  return re.test(body)
}

function migrationVersion(filename) {
  const m = /^(\d{14})_/.exec(filename)
  return m ? m[1] : null
}

/**
 * @param {string} dir
 * @returns {{ file: string, table: string, missing: string[] }[]}
 */
export function checkMigrationsDir(dir, enforceFrom = ENFORCE_FROM) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('_'))
    .sort()
  const violations = []
  for (const file of files) {
    const ver = migrationVersion(file)
    if (!ver || ver < enforceFrom) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    const tables = extractPublicCreateTables(sql)
    for (const table of tables) {
      const missing = []
      if (!hasRlsEnabled(sql, table)) missing.push('ENABLE ROW LEVEL SECURITY')
      if (!hasServiceRoleGrant(sql, table)) {
        missing.push('GRANT … TO service_role')
      }
      if (missing.length) {
        violations.push({ file, table, missing })
      }
    }
  }
  return violations
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'mig-grants-'))
  try {
    // Fail-closed: CREATE without RLS/grant
    writeFileSync(
      join(dir, '20261030120000_bad.sql'),
      `CREATE TABLE public.widgets (id uuid PRIMARY KEY);\n`,
    )
    let v = checkMigrationsDir(dir)
    assert.equal(v.length, 1, 'must flag missing RLS+grant')
    assert.deepEqual(v[0].missing.sort(), [
      'ENABLE ROW LEVEL SECURITY',
      'GRANT … TO service_role',
    ])

    // Pass: full grants
    writeFileSync(
      join(dir, '20261030130000_good.sql'),
      `
CREATE TABLE IF NOT EXISTS public.gadgets (
  id uuid PRIMARY KEY
);
ALTER TABLE public.gadgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gadgets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gadgets TO service_role;
`,
    )
    v = checkMigrationsDir(dir)
    assert.equal(
      v.filter((x) => x.file.includes('good')).length,
      0,
      'good migration must pass',
    )

    // Grandfather: old file without grants is ignored
    writeFileSync(
      join(dir, '20260101000000_old.sql'),
      `CREATE TABLE public.legacy (id int);\n`,
    )
    v = checkMigrationsDir(dir)
    assert.equal(
      v.filter((x) => x.file.includes('old')).length,
      0,
      'pre-ENFORCE_FROM must be grandfathered',
    )

    // Comment-only CREATE must not match
    writeFileSync(
      join(dir, '20261030140000_comment.sql'),
      `-- CREATE TABLE public.fake (id int);\nSELECT 1;\n`,
    )
    v = checkMigrationsDir(dir)
    assert.equal(
      v.filter((x) => x.file.includes('comment')).length,
      0,
      'commented CREATE must not flag',
    )

    console.log('check-migration-grants: self-test OK')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest()
    return
  }

  const violations = checkMigrationsDir(MIGRATIONS_DIR)
  if (violations.length) {
    console.error(
      '::error::check:migration-grants — CREATE TABLE in public without RLS + service_role grant in the same migration:',
    )
    for (const v of violations) {
      console.error(
        `  ${v.file} → public.${v.table} missing: ${v.missing.join('; ')}`,
      )
    }
    console.error(
      'Fix: copy supabase/migration-templates/new_public_table.sql — ENABLE ROW LEVEL SECURITY and GRANT to service_role in the same file. ' +
        'Do not backfill grants onto grandfathered historical migrations.',
    )
    process.exit(1)
  }

  console.log(
    JSON.stringify({
      ok: true,
      enforceFrom: ENFORCE_FROM,
      migrationsDir: 'supabase/migrations',
    }),
  )
}

main()
