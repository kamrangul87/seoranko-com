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
import { assertFixWriteEntitled } from '@/lib/stripe/entitlements'

export const dynamic = 'force-dynamic'
/** Commit + deploy wait + live verify can exceed default. */
export const maxDuration = 300

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
    /** Operator/E2E: explicit GitHub target (never a silent brand default). */
    github?: {
      owner: string
      repo: string
      baseBranch?: string
      accessToken?: string
    }
    pathOverride?: string
    liveUrlOverride?: string
  }
  const action = body.action
  const ctx = {
    github: body.github,
    pathOverride: body.pathOverride,
  }

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
    return NextResponse.json({
      finding,
      fixFlow: await approveFix(params.id, user.id),
    })
  }

  if (action === 'commit') {
    if (!canOfferFix(finding.surfaceClass)) {
      return NextResponse.json(
        { error: 'Commit refused — finding is not auto-fixable.' },
        { status: 400 },
      )
    }
    const entitled = await assertFixWriteEntitled({
      userId: user.id,
      email: user.email,
    })
    if (!entitled.ok) {
      return NextResponse.json(
        {
          error: entitled.error,
          code: entitled.code,
          billingPath: entitled.billingPath,
          upgrade: entitled.upgrade,
        },
        { status: entitled.status },
      )
    }
    const fixFlow = await commitFix({
      findingId: params.id,
      userId: user.id,
      finding: row,
      ctx,
    })
    return NextResponse.json({ finding, fixFlow })
  }

  if (action === 'verify') {
    const fixFlow = await verifyFix({
      findingId: params.id,
      userId: user.id,
      finding: row,
      ctx,
      liveUrlOverride: body.liveUrlOverride,
    })
    return NextResponse.json({ finding, fixFlow })
  }

  return NextResponse.json(
    { error: 'action must be approve | commit | verify' },
    { status: 400 },
  )
}
