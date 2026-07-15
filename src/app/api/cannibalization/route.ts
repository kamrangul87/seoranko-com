import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCannibalization } from '@/lib/cannibalization-detector'

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
      .select('id, title, keyword')
      .eq('user_id', user.id)

    const result = await detectCannibalization(articles || [])
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
