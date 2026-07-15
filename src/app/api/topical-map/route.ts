import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildTopicalMap } from '@/lib/topical-map'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const authHeader = req.headers.get('authorization')
    const { data: { user } } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') || ''
    )
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: articles } = await supabase
      .from('articles')
      .select('id, title, keyword, internal_links')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const result = await buildTopicalMap(articles || [])

    await supabase.from('topical_maps').upsert({
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
