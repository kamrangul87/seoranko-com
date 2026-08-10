import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildTopicalMap } from '@/lib/topical-map'

export const maxDuration = 120

// Loads the last saved topical map (from the topical_maps table) without
// rebuilding — the page previously had no way to show existing results on
// load, so it always displayed the "generate your first article" empty
// state regardless of how many real articles/builds actually existed,
// which is exactly the confusing behaviour Kamran reported.
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '') || ''

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: { user } } = await supabaseAdmin.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: saved } = await supabaseAdmin
      .from('topical_maps')
      .select('map_data, generated_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!saved) return NextResponse.json({ success: true, result: null })
    return NextResponse.json({ success: true, result: saved.map_data })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '') || ''

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: { user } } = await supabaseAdmin.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // article_url/content are what buildTopicalMap actually needs to tell
    // whether one article links to another — the previous select only
    // fetched internal_links, a column nothing in the app ever writes to
    // (always '[]'), which made every cross-link check a permanent no-op.
    // brand is fetched here too since the follow-up internal-link-registry
    // feature needs it per cluster page; unused by buildTopicalMap itself.
    const { data: articlesRaw } = await supabaseAdmin
      .from('articles')
      .select('id, title, keyword, content, article_url, brand')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const articles = (articlesRaw || []).map(a => ({
      id: a.id,
      title: a.title,
      keyword: a.keyword,
      content: a.content,
      url: a.article_url,
      brand: a.brand,
    }))

    const result = await buildTopicalMap(articles)

    await supabaseAdmin.from('topical_maps').upsert({
      user_id: user.id,
      map_data: result,
      generated_at: result.generatedAt,
      cluster_count: result.clusters.length,
      total_articles: result.totalArticles,
      orphan_count: result.orphanArticles.length
    }, { onConflict: 'user_id' })

    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
