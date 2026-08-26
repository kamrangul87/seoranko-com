#!/usr/bin/env npx tsx
/**
 * One-shot / local repair for internal_link_registry wrong tool URLs.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Usage:
 *   npx tsx scripts/fix-registry-tool-urls.ts
 *   npx tsx scripts/fix-registry-tool-urls.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import {
  auditRegistryLinkRows,
  rewriteKnownWrongRegistryHrefsInHtml,
} from '../src/lib/registry-url-health'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const { data: rows, error } = await supabase
    .from('internal_link_registry')
    .select('id, page_url, site_url, is_active, brand')
    .eq('is_active', true)
    .limit(500)

  if (error) {
    console.error(error)
    process.exit(1)
  }

  console.log(`Scanning ${rows?.length || 0} active registry rows (dryRun=${dryRun})`)
  const { actions, updates } = await auditRegistryLinkRows(rows || [], { dryRun })
  for (const a of actions) {
    console.log(JSON.stringify(a))
  }

  if (!dryRun) {
    for (const u of updates) {
      const patch: Record<string, unknown> = {}
      if (u.page_url !== undefined) patch.page_url = u.page_url
      if (u.site_url !== undefined) patch.site_url = u.site_url
      if (u.is_active !== undefined) patch.is_active = u.is_active
      const { error: upErr } = await supabase
        .from('internal_link_registry')
        .update(patch)
        .eq('id', u.id)
      if (upErr) console.error('update failed', u.id, upErr)
      else console.log('updated', u.id, patch)
    }
  }

  const { data: articles } = await supabase
    .from('articles')
    .select('id, content')
    .or('content.ilike.%/mot-checker%,content.ilike.%/ev-charger-finder%')
    .not('content', 'is', null)
    .limit(200)

  for (const article of articles || []) {
    const { html, replacements } = rewriteKnownWrongRegistryHrefsInHtml(article.content || '')
    if (!replacements.length) continue
    console.log('article', article.id, replacements)
    if (!dryRun) {
      await supabase
        .from('articles')
        .update({ content: html, updated_at: new Date().toISOString() })
        .eq('id', article.id)
    }
  }

  console.log('done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
