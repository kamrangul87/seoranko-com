import { NextResponse } from 'next/server'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { cookies } from 'next/headers'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { persistedToUiFinding } from '@/lib/fix-strategies/findings-ui/map-persisted'
import { getFixFlow } from '@/lib/fix-strategies/findings-ui/fix-flow-store'
import { isFixTypePaused } from '@/lib/fix-strategies/findings-ui/fix-run/failure-learning'
import { isFindingId } from '@/lib/fix-strategies/findings-ui/is-finding-id'

export const dynamic = 'force-dynamic'

function authClient() {
  const cookieStore = cookies()
  return createSupabaseSsrClient(
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

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isFindingId(params.id)) {
    return NextResponse.json(
      { error: 'Finding id must be a UUID' },
      { status: 400 },
    )
  }

  // Read-only: never call updateFindingSourceResolution (or other writes) here.
  const store = getFindingsStore()
  const row = await store.getFinding(params.id)
  if (!row || row.userId !== user.id) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }
  if (row.bucket === 'internal') {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }

  const evidence = await store.listEvidenceForFinding(row.id)
  const fixFlow = await getFixFlow(params.id, user.id)
  const fixTypePaused = await isFixTypePaused(row.topicId, row.verdict)
  const finding = persistedToUiFinding(row, evidence, {
    fixFlow: fixFlow
      ? {
          prUrl: fixFlow.prUrl ?? null,
          prNumber: fixFlow.prNumber ?? null,
        }
      : null,
    fixTypePaused,
  })
  return NextResponse.json({ finding, fixFlow })
}

/**
 * Mark / un-mark a human-review finding as OK (Needs you ↔ Reviewed and accepted).
 * Body: `{ accepted: boolean }`
 */
export async function PATCH(
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

  if (!isFindingId(params.id)) {
    return NextResponse.json(
      { error: 'Finding id must be a UUID' },
      { status: 400 },
    )
  }

  let body: { accepted?: unknown }
  try {
    body = (await request.json()) as { accepted?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body.accepted !== 'boolean') {
    return NextResponse.json(
      { error: 'accepted must be a boolean' },
      { status: 400 },
    )
  }

  const store = getFindingsStore()
  const row = await store.getFinding(params.id)
  if (!row || row.userId !== user.id) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }
  if (row.bucket === 'internal') {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }
  if (row.surfaceClass !== 'human-review') {
    return NextResponse.json(
      { error: 'Only human-review findings can be marked OK' },
      { status: 400 },
    )
  }

  const updated = await store.setFindingAccepted({
    findingId: row.id,
    accepted: body.accepted,
    userId: user.id,
  })
  if (!updated) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }

  const evidence = await store.listEvidenceForFinding(updated.id)
  const finding = persistedToUiFinding(updated, evidence)
  return NextResponse.json({ finding })
}
