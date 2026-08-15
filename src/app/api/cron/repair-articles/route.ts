// One-off repair endpoint — same logic as scripts/repair-saved-articles.ts.
// Invoke on production where Supabase env vars are configured:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/repair-articles
// Optional query: ?dry_run=1

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  articleNeedsRepair,
  repairArticleContent,
} from '@/lib/article-content-repair'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dry_run') === '1'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, title, keyword, content, meta_description')
    .not('content', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = articles ?? []
  let needsRepair = 0
  let updated = 0
  let mergeFixTotal = 0
  let metaDescAdded = 0
  const fixed: Array<{ id: string; title: string; mergeFixes: number; metaAdded: boolean }> = []

  for (const article of rows) {
    const content = article.content?.trim() ?? ''
    if (!content || !articleNeedsRepair(content)) continue

    needsRepair++
    const result = repairArticleContent(content, article.meta_description)
    if (!result.changed) continue

    fixed.push({
      id: article.id,
      title: article.title ?? article.keyword ?? article.id,
      mergeFixes: result.mergeFixes,
      metaAdded: result.metaDescriptionAdded,
    })
    mergeFixTotal += result.mergeFixes
    if (result.metaDescriptionAdded) metaDescAdded++

    if (dryRun) {
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
      return NextResponse.json(
        { error: `Update failed for ${article.id}: ${updateError.message}` },
        { status: 500 }
      )
    }
    updated++
  }

  return NextResponse.json({
    dryRun,
    scanned: rows.length,
    needsRepair,
    updated,
    mergeFixTotal,
    metaDescAdded,
    fixed,
  })
}
