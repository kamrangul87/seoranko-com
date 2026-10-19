import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import { cookies } from 'next/headers'
import { revertFixAttempt } from '@/lib/fix-agent'


export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { attemptId } — one-click revert of an auto-applied Fix Agent change. */
export async function POST(req: NextRequest) {
  try {
    const {
      isLegacyCustomerWritesEnabled,
      legacyCustomerWritesDisabledBody,
      withCustomerWriteGate,
    } = await import('@/lib/customer-write-gate')
    if (!isLegacyCustomerWritesEnabled()) {
      return NextResponse.json(
        legacyCustomerWritesDisabledBody('fix-agent-revert'),
        { status: 403 },
      )
    }

    const cookieStore = cookies()
    const authClient = createSupabaseSsrClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const attemptId = typeof body.attemptId === 'string' ? body.attemptId : ''
    if (!attemptId) return NextResponse.json({ error: 'attemptId is required' }, { status: 400 })

    const supabase = createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const result = await withCustomerWriteGate('legacy-direct-push', {}, () =>
      revertFixAttempt({ supabase, userId: user.id, attemptId }),
    )
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err) {
    console.error('[fix-agent/revert]', err)
    return NextResponse.json({ error: 'Revert failed' }, { status: 500 })
  }
}
