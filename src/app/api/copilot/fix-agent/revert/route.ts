import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { revertFixAttempt } from '@/lib/fix-agent'

export const maxDuration = 60

/** POST { attemptId } — one-click revert of an auto-applied Fix Agent change. */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies()
    const authClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const attemptId = typeof body.attemptId === 'string' ? body.attemptId : ''
    if (!attemptId) return NextResponse.json({ error: 'attemptId is required' }, { status: 400 })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const result = await revertFixAttempt({ supabase, userId: user.id, attemptId })
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    console.error('[fix-agent/revert]', err)
    return NextResponse.json({ error: 'Revert failed' }, { status: 500 })
  }
}
