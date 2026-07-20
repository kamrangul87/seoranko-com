import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runRANKODiagnosis } from '@/lib/ranko-diagnosis'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const { siteUrl } = await req.json()
    if (!siteUrl) return NextResponse.json({ error: 'siteUrl required' }, { status: 400 })

    // Auth
    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name) => cookieStore.get(name)?.value } }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch user's articles
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: articles } = await supabase
      .from('articles')
      .select('id, title, keyword, content, rank_score')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    const { data: trackingData } = await supabase
      .from('ranking_agent_articles')
      .select('article_id, current_position')
      .eq('user_id', user.id)

    const positionMap = Object.fromEntries(
      (trackingData || []).map(t => [t.article_id, t.current_position])
    )

    const enrichedArticles = (articles || []).map(a => ({
      ...a,
      current_position: positionMap[a.id] || null
    }))

    const diagnosis = await runRANKODiagnosis(user.id, siteUrl, enrichedArticles)

    // Save to Supabase
    await supabase.from('ranko_diagnoses').insert({
      user_id: user.id,
      site_url: siteUrl,
      overall_health: diagnosis.overallHealth,
      health_score: diagnosis.healthScore,
      issue_count: diagnosis.issues.length,
      top_actions: diagnosis.topThreeActions,
      diagnosed_at: diagnosis.diagnosedAt
    })

    return NextResponse.json({ success: true, diagnosis })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
