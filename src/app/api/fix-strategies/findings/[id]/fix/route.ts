import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { persistedToUiFinding } from '@/lib/fix-strategies/findings-ui/map-persisted'
import { canOfferFix } from '@/lib/fix-strategies/findings-ui/buckets'
import {
  approveFix,
  commitFix,
  verifyFix,
} from '@/lib/fix-strategies/findings-ui/fix-flow-store'

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

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const store = getFindingsStore()
  const row = await store.getFinding(params.id)
  if (!row || row.userId !== user.id || row.bucket === 'internal') {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }
  const finding = persistedToUiFinding(row)

  const body = (await request.json().catch(() => ({}))) as {
    action?: 'approve' | 'commit' | 'verify'
  }
  const action = body.action

  if (action === 'approve') {
    if (!canOfferFix(finding.surfaceClass)) {
      return NextResponse.json(
        {
          error:
            'This finding is not auto-fixable. Human-review and report-only findings cannot enter the fix flow.',
        },
        { status: 400 },
      )
    }
    return NextResponse.json({ finding, fixFlow: approveFix(params.id) })
  }

  if (action === 'commit') {
    if (!canOfferFix(finding.surfaceClass)) {
      return NextResponse.json(
        { error: 'Commit refused — finding is not auto-fixable.' },
        { status: 400 },
      )
    }
    return NextResponse.json({
      finding,
      fixFlow: commitFix(params.id, {
        diffSummary: finding.proposedDiff?.summary,
      }),
    })
  }

  if (action === 'verify') {
    return NextResponse.json({ finding, fixFlow: verifyFix(params.id) })
  }

  return NextResponse.json(
    { error: 'action must be approve | commit | verify' },
    { status: 400 },
  )
}
