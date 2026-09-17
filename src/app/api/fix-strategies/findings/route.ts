import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  buildDemoFindings,
  DEMO_RUN_META,
  isListVisible,
  type FindingsListResponse,
} from '@/lib/fix-strategies/findings-ui'

export const dynamic = 'force-dynamic'

function authClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    },
  )
}

/**
 * GET /api/fix-strategies/findings
 * ?informational=1 — include informational bucket in the list
 * Internal (suppress/ok/route) is never returned in `findings`.
 */
export async function GET(request: Request) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const includeInformational = url.searchParams.get('informational') === '1'

  const all = buildDemoFindings()
  const actionable = all.filter((f) => f.bucket === 'actionable')
  const informational = all.filter((f) => f.bucket === 'informational')

  const findings = all.filter((f) =>
    isListVisible(f.bucket, { includeInformational }),
  )

  const body: FindingsListResponse = {
    origin: DEMO_RUN_META.origin,
    crawledAt: DEMO_RUN_META.crawledAt,
    demo: DEMO_RUN_META.demo,
    counts: {
      actionable: actionable.length,
      informational: informational.length,
      internal: DEMO_RUN_META.internalCount,
    },
    findings,
  }

  return NextResponse.json(body)
}
