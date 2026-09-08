#!/usr/bin/env node
/**
 * Best-effort cleanup of leftover Fix Agent review branches on connected
 * GitHub client repos (seoranko-fix-*, plus known merged homepage stubs).
 *
 * Runs during Vercel *production* builds when SITE_CONNECTION_ENCRYPTION_KEY
 * + Supabase service role are present. Never fails the deploy.
 */
import { createClient } from '@supabase/supabase-js'
import { createDecipheriv, createHash } from 'crypto'

const PREFIX = 'enc:v1:'
const STALE_PREFIX = 'seoranko-fix-'
const EXTRA = new Set(['homepage-build', 'claude/build-homepage-UAaZz'])

function isStale(name) {
  if (!name || name === 'main' || name === 'master') return false
  if (name.startsWith(STALE_PREFIX)) return true
  return EXTRA.has(name)
}

function getKey() {
  const raw = process.env.SITE_CONNECTION_ENCRYPTION_KEY?.trim()
  if (!raw) throw new Error('SITE_CONNECTION_ENCRYPTION_KEY missing')
  return createHash('sha256').update(raw).digest()
}

function decryptCredentialsJson(ciphertext) {
  if (!ciphertext?.startsWith(PREFIX)) {
    return JSON.parse(ciphertext)
  }
  const key = getKey()
  const buf = Buffer.from(ciphertext.slice(PREFIX.length), 'base64url')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'))
}

function loadCreds(row) {
  if (row.credentials_ciphertext) return decryptCredentialsJson(row.credentials_ciphertext)
  if (row.credentials && typeof row.credentials === 'object') {
    if (typeof row.credentials.__ciphertext === 'string') {
      return decryptCredentialsJson(row.credentials.__ciphertext)
    }
    return row.credentials
  }
  return null
}

async function deleteStale(owner, repo, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const listRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    { headers, signal: AbortSignal.timeout(20000) },
  )
  if (!listRes.ok) {
    return { deleted: [], failed: [`list HTTP ${listRes.status}`] }
  }
  const branches = await listRes.json()
  const stale = (Array.isArray(branches) ? branches : []).map((b) => b.name).filter(isStale)
  const deleted = []
  const failed = []
  for (const name of stale) {
    const del = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(name)}`,
      { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) },
    )
    if (del.ok || del.status === 204) deleted.push(name)
    else failed.push(`${name}: HTTP ${del.status}`)
  }
  return { deleted, failed, scanned: stale.length }
}

async function main() {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    console.log('cleanup-client-fix-branches: skip (not production)')
    return
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service || service === 'placeholder' || url.includes('example.supabase')) {
    console.log('cleanup-client-fix-branches: skip (no live Supabase service role)')
    return
  }
  if (!process.env.SITE_CONNECTION_ENCRYPTION_KEY?.trim()) {
    console.log('cleanup-client-fix-branches: skip (SITE_CONNECTION_ENCRYPTION_KEY missing)')
    return
  }

  const supabase = createClient(url, service)
  const { data: rows, error } = await supabase
    .from('site_connections')
    .select('id, site_id, cms_type, credentials, credentials_ciphertext, is_active')
    .eq('cms_type', 'github')
    .eq('is_active', true)

  if (error) {
    console.warn('cleanup-client-fix-branches: query failed', error.message)
    return
  }

  const seen = new Set()
  const report = []
  for (const row of rows || []) {
    let creds
    try {
      creds = loadCreds(row)
    } catch (err) {
      report.push({ id: row.id, error: err instanceof Error ? err.message : String(err) })
      continue
    }
    const owner = creds?.owner
    const repo = creds?.repo
    const token = creds?.accessToken
    if (!owner || !repo || !token) {
      report.push({ id: row.id, error: 'missing owner/repo/accessToken' })
      continue
    }
    const key = `${owner}/${repo}`
    if (seen.has(key)) continue
    seen.add(key)
    const result = await deleteStale(owner, repo, token)
    report.push({ repo: key, ...result })
    console.log(
      `cleanup-client-fix-branches: ${key} deleted=${result.deleted.length} failed=${result.failed.length}`,
      result.deleted.length ? result.deleted.join(',') : '',
    )
  }

  console.log(JSON.stringify({ ok: true, repos: report.length, report }, null, 2))
}

main().catch((err) => {
  console.warn('cleanup-client-fix-branches: error', err instanceof Error ? err.message : err)
  process.exit(0) // never fail the deploy
})
