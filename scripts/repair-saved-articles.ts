// One-off repair pass for saved articles in Supabase:
// - Deterministic merge-artifact fixes (Network.s, 22kW. units, etc.)
// - Missing <meta name="description"> when og/twitter/META comment exists
//
// Usage:
//   npx tsx scripts/repair-saved-articles.ts           # apply fixes
//   npx tsx scripts/repair-saved-articles.ts --dry-run # report only
//
// Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env
// or .env.local (same as scripts/fix-wrong-internal-links.ts).

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  articleNeedsRepair,
  repairArticleContent,
} from '../src/lib/article-content-repair'

function loadEnvLocal() {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvLocal()

const dryRun = process.argv.includes('--dry-run')

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
    console.error('Set them in .env.local or the environment, then re-run.')
    process.exit(1)
  }

  const supabase = createClient(url, key)

  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, title, keyword, content, meta_description')
    .not('content', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch articles:', error.message)
    process.exit(1)
  }

  const rows = articles ?? []
  console.log(`Scanned ${rows.length} saved article(s)${dryRun ? ' (dry run)' : ''}.`)

  let needsRepair = 0
  let updated = 0
  let mergeFixTotal = 0
  let metaDescAdded = 0
  const fixedArticles: Array<{ id: string; title: string; mergeFixes: number; metaAdded: boolean }> = []

  for (const article of rows) {
    const content = article.content?.trim() ?? ''
    if (!content) continue

    if (!articleNeedsRepair(content)) continue
    needsRepair++

    const result = repairArticleContent(content, article.meta_description)
    if (!result.changed) continue

    fixedArticles.push({
      id: article.id,
      title: article.title ?? article.keyword ?? article.id,
      mergeFixes: result.mergeFixes,
      metaAdded: result.metaDescriptionAdded,
    })

    mergeFixTotal += result.mergeFixes
    if (result.metaDescriptionAdded) metaDescAdded++

    if (dryRun) {
      console.log(
        `[dry-run] would fix: ${article.id} — "${article.title ?? article.keyword}"` +
          ` (merge=${result.mergeFixes}, meta=${result.metaDescriptionAdded ? 'yes' : 'no'})`
      )
      updated++
      continue
    }

    const { error: updateError } = await supabase
      .from('articles')
      .update({
        content: result.content,
        updated_at: new Date().toISOString(),
      })
      .eq('id', article.id)

    if (updateError) {
      console.error(`Failed to update ${article.id}:`, updateError.message)
      continue
    }

    updated++
    console.log(
      `Fixed: ${article.id} — "${article.title ?? article.keyword}"` +
        ` (merge=${result.mergeFixes}, meta=${result.metaDescriptionAdded ? 'yes' : 'no'})`
    )
  }

  console.log('')
  console.log('--- Summary ---')
  console.log(`Articles scanned:     ${rows.length}`)
  console.log(`Needed repair:        ${needsRepair}`)
  console.log(`Articles ${dryRun ? 'would be ' : ''}fixed:       ${updated}`)
  console.log(`Merge fixes applied:  ${mergeFixTotal}`)
  console.log(`Meta descriptions added: ${metaDescAdded}`)

  if (fixedArticles.length > 0) {
    console.log('')
    console.log('Fixed article IDs:')
    for (const a of fixedArticles) {
      console.log(`  - ${a.id} (${a.title})`)
    }
  } else {
    console.log('No articles required changes.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
