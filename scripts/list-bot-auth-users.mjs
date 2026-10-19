#!/usr/bin/env node
/**
 * LIST-ONLY cleanup inventory for Sep 2026 signup-spam bots.
 *
 * Criteria (ALL must hold):
 *   - email unconfirmed
 *   - never signed in
 *   - random bot display name (15+ letters, no spaces, mixed random case)
 *   - no connected_sites row
 *   - no subscriptions row / no stripe_customer_id
 *   - email is NOT kamran@seoranko.com
 *
 * Usage:
 *   node scripts/list-bot-auth-users.mjs
 *   node scripts/list-bot-auth-users.mjs --delete   # ONLY after human says "delete"
 *
 * Never deletes without --delete. Never touches users with sites/subscriptions
 * or kamran@seoranko.com.
 */
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const PROTECTED_EMAIL = 'kamran@seoranko.com'
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ddfboapzwclecbdjoqex'
const POOLER_HOST =
  process.env.SUPABASE_POOLER_HOST || 'aws-1-eu-west-2.pooler.supabase.com'

const DELETE = process.argv.includes('--delete')

function looksLikeRandomBotDisplayName(name) {
  const n = String(name ?? '').trim()
  if (n.length < 15) return false
  if (/\s/.test(n)) return false
  if (!/^[A-Za-z]+$/.test(n)) return false
  if (!/[a-z]/.test(n) || !/[A-Z]/.test(n)) return false
  if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(n)) return false
  let transitions = 0
  for (let i = 1; i < n.length; i++) {
    const prevUpper = n[i - 1] >= 'A' && n[i - 1] <= 'Z'
    const curUpper = n[i] >= 'A' && n[i] <= 'Z'
    if (prevUpper !== curUpper) transitions++
  }
  return transitions >= Math.max(4, Math.floor(n.length * 0.25))
}

function dbUrl() {
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    return process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  }
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) return null
  return `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(pw)}@${POOLER_HOST}:5432/postgres`
}

async function listViaSql(client) {
  const { rows } = await client.query(`
    SELECT
      u.id,
      u.email,
      u.created_at,
      u.email_confirmed_at,
      u.last_sign_in_at,
      COALESCE(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', '') AS display_name,
      EXISTS (SELECT 1 FROM public.connected_sites cs WHERE cs.user_id = u.id) AS has_site,
      EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = u.id) AS has_subscription,
      EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = u.id
          AND s.stripe_customer_id IS NOT NULL
          AND btrim(s.stripe_customer_id) <> ''
      ) AS has_stripe_customer
    FROM auth.users u
    ORDER BY u.created_at ASC
  `)
  return rows
}

function isEligible(row) {
  const email = String(row.email || '').toLowerCase()
  if (email === PROTECTED_EMAIL) return false
  if (row.email_confirmed_at) return false
  if (row.last_sign_in_at) return false
  if (row.has_site || row.has_subscription || row.has_stripe_customer) return false
  if (!looksLikeRandomBotDisplayName(row.display_name)) return false
  return true
}

async function deleteViaAdmin(ids) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for --delete')
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const results = []
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id)
    results.push({ id, ok: !error, error: error?.message || null })
  }
  return results
}

async function main() {
  const url = dbUrl()
  if (!url) {
    console.log(
      JSON.stringify({
        ok: false,
        error: 'no_db_credentials',
        hint: 'Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD',
      }),
    )
    process.exit(1)
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const rows = await listViaSql(client)
    const eligible = rows.filter(isEligible).map((r) => ({
      id: r.id,
      email: r.email,
      display_name: r.display_name,
      created_at: r.created_at,
    }))

    const out = {
      ok: true,
      mode: DELETE ? 'delete' : 'list',
      total_auth_users: rows.length,
      eligible_bot_count: eligible.length,
      protected_email: PROTECTED_EMAIL,
      bots: eligible,
    }

    if (!DELETE) {
      console.log(JSON.stringify(out, null, 2))
      console.error(
        `\nLIST ONLY — ${eligible.length} bots eligible. Re-run with --delete only after human replies "delete".`,
      )
      return
    }

    const deleted = await deleteViaAdmin(eligible.map((b) => b.id))
    out.deleted = deleted
    out.deleted_ok = deleted.filter((d) => d.ok).length
    console.log(JSON.stringify(out, null, 2))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
