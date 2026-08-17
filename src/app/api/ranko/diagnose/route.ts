import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runRANKODiagnosis } from '@/lib/ranko-diagnosis'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export const maxDuration = 120

async function getAuthedUser() {
  const cookieStore = cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  return user
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function normalizeSiteKey(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase()
}

/** Load the most recent saved diagnosis for a site (Diagnose tab browse). */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteUrl = req.nextUrl.searchParams.get('siteUrl')
    if (!siteUrl) return NextResponse.json({ error: 'siteUrl required' }, { status: 400 })

    const supabase = serviceClient()
    const key = normalizeSiteKey(siteUrl)

    const { data: rows, error } = await supabase
      .from('ranko_diagnoses')
      .select('diagnosis, overall_health, health_score, top_actions, diagnosed_at, site_url')
      .eq('user_id', user.id)
      .order('diagnosed_at', { ascending: false })
      .limit(40)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const match = (rows || []).find(r => {
      const rowKey = normalizeSiteKey(r.site_url || '')
      return rowKey === key || rowKey.startsWith(key + '/') || key.startsWith(rowKey + '/')
        || rowKey.includes(key) || key.includes(rowKey)
    })

    if (!match) return NextResponse.json({ success: true, diagnosis: null })

    if (match.diagnosis && typeof match.diagnosis === 'object') {
      return NextResponse.json({ success: true, diagnosis: match.diagnosis })
    }

    // Legacy rows without full JSON — return a summary shell so the tab isn't blank
    return NextResponse.json({
      success: true,
      diagnosis: {
        siteUrl,
        diagnosedAt: match.diagnosed_at || new Date().toISOString(),
        overallHealth: match.overall_health || 'needs-work',
        healthScore: match.health_score ?? 60,
        issues: [],
        priorityQueue: [],
        doNothing: [],
        topThreeActions: match.top_actions || [],
        estimatedWeeksToImpact: 6,
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { siteUrl, trackedArticleId } = await req.json()
    if (!siteUrl) return NextResponse.json({ error: 'siteUrl required' }, { status: 400 })

    const user = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = serviceClient()

    let articlesQuery = await supabase
      .from('articles')
      .select('id, title, keyword, content, rank_score')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(30)

    // Before soft-delete migration, deleted_at filter fails — fall back.
    if (articlesQuery.error) {
      articlesQuery = await supabase
        .from('articles')
        .select('id, title, keyword, content, rank_score')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30)
    }

    const articles = articlesQuery.data

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

    // Prefer full diagnosis JSON; fall back if column not migrated yet
    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      site_url: siteUrl,
      overall_health: diagnosis.overallHealth,
      health_score: diagnosis.healthScore,
      issue_count: diagnosis.issues.length,
      top_actions: diagnosis.topThreeActions,
      diagnosis,
      diagnosed_at: diagnosis.diagnosedAt,
    }

    const { error: insertError } = await supabase.from('ranko_diagnoses').insert(insertPayload)
    if (insertError) {
      const { diagnosis: _drop, ...withoutJson } = insertPayload
      void _drop
      await supabase.from('ranko_diagnoses').insert(withoutJson)
    }

    if (trackedArticleId) {
      await supabase
        .from('ranking_agent_articles')
        .update({
          last_diagnosis: diagnosis,
          last_diagnosed_at: diagnosis.diagnosedAt,
        })
        .eq('id', trackedArticleId)
        .eq('user_id', user.id)
    }

    return NextResponse.json({ success: true, diagnosis })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
