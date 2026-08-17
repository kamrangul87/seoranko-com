import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import {
  findLinkedArticleId,
  recomputeFreshnessForTracked,
} from '@/lib/rank-monitor-pass'
import { enterAtPublish } from '@/lib/pages'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { keyword, articleUrl, locationCode } = await req.json()
    if (!keyword || !articleUrl) {
      return NextResponse.json({ error: 'keyword and articleUrl required' }, { status: 400 })
    }

    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name) => cookieStore.get(name)?.value } }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const linkedArticleId = await findLinkedArticleId(supabase, user.id, articleUrl)

    const { data: row, error } = await supabase
      .from('ranking_agent_articles')
      .insert({
        user_id: user.id,
        keyword,
        article_url: articleUrl,
        title: keyword,
        location_code: locationCode ?? 2840,
        article_id: linkedArticleId,
        freshness_status: 'fresh',
        needs_refresh: false,
      })
      .select('id')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (row?.id) {
      await recomputeFreshnessForTracked(supabase, row.id)
    }

    enterAtPublish(supabase, {
      userId: user.id,
      keyword,
      url: articleUrl,
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      id: row?.id,
      linkedArticleId,
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

/** Stop tracking a URL (Track tab Remove). */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    const cookieStore = cookies()
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name) => cookieStore.get(name)?.value } }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // rank_history cascades via ranking_article_id FK when present
    const { error } = await supabase
      .from('ranking_agent_articles')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
