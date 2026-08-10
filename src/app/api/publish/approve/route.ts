import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { approveArticleForPublish } from '@/lib/article-publisher'

// Phase H's structural gate: /api/publish refuses to call any publisher
// adapter unless a pages row has publish_approved_by set, which only this
// route ever sets. Deliberately a separate, explicit action from
// /api/publish itself — a human has to hit this endpoint (i.e. click an
// actual "Approve & Publish" button) before real publishing can happen at
// all, regardless of Quality Gate score.
export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { articleId } = await req.json()
    if (!articleId) {
      return NextResponse.json({ success: false, message: 'articleId is required.' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const result = await approveArticleForPublish(supabase, user.id, articleId)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error('[publish/approve]', error)
    return NextResponse.json({ success: false, message: String(error) }, { status: 500 })
  }
}
