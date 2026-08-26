/**
 * Periodic / on-demand repair of internal_link_registry:
 * 1. Remap known-wrong tool URLs (mot-checker → mot.autodun.com, etc.)
 * 2. Live-check every active row; deactivate URLs that 404
 * 3. Rewrite those wrong hrefs already baked into saved article HTML
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 * Optional: ?dry_run=1
 *
 * Also invoked from the daily verify-liveness cron so Hobby plan stays
 * at one daily schedule.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  auditRegistryLinkRows,
  rewriteKnownWrongRegistryHrefsInHtml,
} from '@/lib/registry-url-health'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: rows, error } = await supabase
    .from('internal_link_registry')
    .select('id, page_url, site_url, is_active')
    .eq('is_active', true)
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { actions, updates } = await auditRegistryLinkRows(rows || [], { dryRun })

  let registryUpdated = 0
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
      if (upErr) {
        return NextResponse.json(
          { error: `Registry update failed for ${u.id}: ${upErr.message}`, actions },
          { status: 500 },
        )
      }
      registryUpdated++
    }
  }

  // Rewrite wrong tool hrefs already present in saved articles
  const { data: articles, error: artErr } = await supabase
    .from('articles')
    .select('id, content')
    .or(
      'content.ilike.%/mot-checker%,content.ilike.%/ev-charger-finder%',
    )
    .not('content', 'is', null)
    .limit(200)

  if (artErr) {
    return NextResponse.json(
      {
        error: artErr.message,
        registryUpdated,
        actions,
      },
      { status: 500 },
    )
  }

  let articlesRewritten = 0
  const articleIds: string[] = []
  for (const article of articles || []) {
    const content = article.content?.trim() ?? ''
    if (!content) continue
    const { html, replacements } = rewriteKnownWrongRegistryHrefsInHtml(content)
    if (replacements.length === 0 || html === content) continue
    articleIds.push(article.id)
    if (dryRun) {
      articlesRewritten++
      continue
    }
    const { error: aUp } = await supabase
      .from('articles')
      .update({ content: html, updated_at: new Date().toISOString() })
      .eq('id', article.id)
    if (aUp) {
      return NextResponse.json(
        { error: `Article update failed for ${article.id}: ${aUp.message}`, actions },
        { status: 500 },
      )
    }
    articlesRewritten++
  }

  return NextResponse.json({
    success: true,
    dryRun,
    registryScanned: (rows || []).length,
    registryUpdated: dryRun ? updates.length : registryUpdated,
    articlesRewritten,
    articleIds,
    actions,
    summary: {
      corrected: actions.filter((a) => a.action === 'corrected').length,
      deactivated: actions.filter((a) => a.action === 'deactivated').length,
      ok: actions.filter((a) => a.action === 'ok').length,
    },
  })
}
