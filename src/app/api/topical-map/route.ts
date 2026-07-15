import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { buildTopicalMap } from '@/lib/topical-map'

export const maxDuration = 120

export async function POST() {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: articles } = await supabaseAdmin
      .from('articles')
      .select('id, title, keyword, internal_links')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const result = await buildTopicalMap(articles || [])

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
