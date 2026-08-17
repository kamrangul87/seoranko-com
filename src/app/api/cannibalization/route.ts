import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCannibalization } from '@/lib/cannibalization-detector'

export const maxDuration = 60

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function userFromBearer(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '') || ''
  if (!token) return null
  const supabaseAdmin = adminClient()
  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  return user
}

/** Load last saved cannibalisation result so the tab isn't blank on browse. */
export async function GET(req: NextRequest) {
  try {
    const user = await userFromBearer(req)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabaseAdmin = adminClient()
    const { data: saved } = await supabaseAdmin
      .from('cannibalization_results')
      .select('pairs, total_conflicts, high_severity, top_action, checked_at')
      .eq('user_id', user.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!saved) return NextResponse.json({ success: true, result: null })

    return NextResponse.json({
      success: true,
      result: {
        pairs: saved.pairs || [],
        totalConflicts: saved.total_conflicts || 0,
        highSeverity: saved.high_severity || 0,
        topAction: saved.top_action || '',
        checkedAt: saved.checked_at || new Date().toISOString(),
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await userFromBearer(req)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized — refresh the page and try again' },
        { status: 401 }
      )
    }

    const supabaseAdmin = adminClient()

    let articlesQuery = await supabaseAdmin
      .from('articles')
      .select('id, title, keyword')
      .eq('user_id', user.id)
      .is('deleted_at', null)

    if (articlesQuery.error) {
      articlesQuery = await supabaseAdmin
        .from('articles')
        .select('id, title, keyword')
        .eq('user_id', user.id)
    }

    const articles = articlesQuery.data

    if (!articles || articles.length < 2) {
      const empty = {
        pairs: [],
        totalConflicts: 0,
        highSeverity: 0,
        topAction: 'Write at least 2 articles in SEORANKO to check for cannibalisation.',
        checkedAt: new Date().toISOString(),
      }
      return NextResponse.json({ success: true, result: empty })
    }

    const result = await detectCannibalization(articles)

    await supabaseAdmin.from('cannibalization_results').insert({
      user_id: user.id,
      pairs: result.pairs,
      total_conflicts: result.totalConflicts,
      high_severity: result.highSeverity,
      top_action: result.topAction,
      checked_at: result.checkedAt,
    })

    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
