import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { detectCannibalization } from '@/lib/cannibalization-detector'

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
      .select('id, title, keyword')
      .eq('user_id', user.id)

    if (!articles || articles.length < 2) {
      return NextResponse.json({
        success: true,
        result: {
          pairs: [],
          totalConflicts: 0,
          highSeverity: 0,
          topAction: 'Write at least 2 articles in SEORANKO to check for cannibalisation.',
          checkedAt: new Date().toISOString()
        }
      })
    }

    const result = await detectCannibalization(articles)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
