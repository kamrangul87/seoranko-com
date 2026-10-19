/**
 * Fails when server-side code creates a Supabase client without no-store fetch.
 *
 * Allowed:
 * - Browser clients (createBrowserClient / lib/supabase-client.ts / lib/supabase/client.ts)
 * - Factory modules under src/lib/supabase/ that install supabaseNoStoreFetch
 * - Call sites that import create* only from those factories
 *
 * Forbidden:
 * - import { createClient } from '@supabase/supabase-js' outside factories/browser
 * - import { createServerClient } from '@supabase/ssr' outside factories
 * - createClient / createServerClient without global.fetch no-store in factory files
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')

const FACTORY_FILES = new Set([
  'src/lib/supabase/no-store-fetch.ts',
  'src/lib/supabase/service-role.ts',
  'src/lib/supabase/server.ts',
  'src/lib/supabase/route-auth.ts',
  'src/lib/supabase/js-client.ts',
  'src/lib/supabase/ssr-client.ts',
])

const BROWSER_ALLOW = new Set([
  'src/lib/supabase-client.ts',
  'src/lib/supabase/client.ts',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(p)
  }
  return out
}

function rel(p) {
  return relative(ROOT, p).replaceAll('\\', '/')
}

function isClientComponent(source, fileRel) {
  if (BROWSER_ALLOW.has(fileRel)) return true
  // 'use client' may follow an eslint header comment.
  const head = source.slice(0, 800)
  if (/^['"]use client['"]/m.test(head) || /\n['"]use client['"]/.test(head)) {
    return true
  }
  return false
}

function checkFactoryHasNoStore(source, fileRel) {
  if (fileRel === 'src/lib/supabase/no-store-fetch.ts') {
    assert.match(
      source,
      /cache:\s*['"]no-store['"]/,
      `${fileRel} must define cache: 'no-store'`,
    )
    return
  }
  // Leaf factories install the fetch; higher-level factories may compose them.
  assert.match(
    source,
    /supabaseNoStoreFetch|cache:\s*['"]no-store['"]|createSupabaseJsClient|createSupabaseSsrClient|createServiceRoleClient/,
    `${fileRel} factory must install or compose no-store Supabase clients`,
  )
}

function main() {
  const files = walk(SRC)
  const violations = []

  for (const file of files) {
    const fileRel = rel(file)
    const source = readFileSync(file, 'utf8')

    if (FACTORY_FILES.has(fileRel)) {
      checkFactoryHasNoStore(source, fileRel)
      continue
    }

    if (isClientComponent(source, fileRel)) continue

    // Direct supabase-js createClient import on the server is banned.
    if (
      /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*['"]@supabase\/supabase-js['"]/.test(
        source,
      )
    ) {
      violations.push(
        `${fileRel}: import createClient from '@supabase/supabase-js' — use @/lib/supabase/js-client or createServiceRoleClient`,
      )
    }

    // Direct createServerClient from @supabase/ssr on the server is banned.
    if (
      /import\s*\{[^}]*\bcreateServerClient\b[^}]*\}\s*from\s*['"]@supabase\/ssr['"]/.test(
        source,
      )
    ) {
      violations.push(
        `${fileRel}: import createServerClient from '@supabase/ssr' — use @/lib/supabase/ssr-client or createRouteAuthClient`,
      )
    }
  }

  if (violations.length) {
    console.error('Supabase no-store violations:\n' + violations.join('\n'))
    process.exit(1)
  }
  console.log(
    `ok: ${files.length} files scanned; server Supabase clients must use no-store factories`,
  )
}

main()
