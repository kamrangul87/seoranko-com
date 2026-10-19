import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { cookies } from 'next/headers'
import { listFixReceiptsForSite } from '@/lib/fix-strategies/findings-ui/fix-receipt'

export const dynamic = 'force-dynamic'

function authClient() {
  const cookieStore = cookies()
  return createSupabaseSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
}

/** GET ?siteId= — list verified-live Fix Receipts for the signed-in owner. */
export async function GET(req: NextRequest) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const siteId = req.nextUrl.searchParams.get('siteId')
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }

  try {
    const receipts = await listFixReceiptsForSite({
      userId: user.id,
      siteId,
    })
    return NextResponse.json({ receipts })
  } catch (err) {
    console.error('[receipts]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'list failed' },
      { status: 500 },
    )
  }
}
