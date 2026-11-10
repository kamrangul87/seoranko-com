/**
 * List / reject Related reading findings queued from the Link map.
 * Approve + open PR stays on POST /api/fix-strategies/findings/[id]/fix
 * (the Audit fix-flow). This route never applies HTML and never merges.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { isFindingId } from '@/lib/fix-strategies/findings-ui/is-finding-id'
import { peekFixFlow } from '@/lib/fix-strategies/findings-ui/fix-flow/persist'
import { loadOwnedConnectedSite } from '@/lib/internal-link-map'
import {
  isRelatedReadingFinding,
  toLinkMapApproval,
} from '@/lib/internal-link-map/approvals'

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

export async function GET(request: Request) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const siteId = new URL(request.url).searchParams.get('siteId') || ''
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }
  const site = await loadOwnedConnectedSite(supabase, user.id, siteId)
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const store = getFindingsStore()
  const rows = await store.listFindings({ siteId: site.id, includeInformational: false })
  const related = rows.filter(
    (row) =>
      row.userId === user.id &&
      row.siteId === site.id &&
      isRelatedReadingFinding(row),
  )
  const items = []
  for (const row of related) {
    const flow = await peekFixFlow(row.id, user.id)
    items.push(
      toLinkMapApproval(
        {
          id: row.id,
          pageUrl: row.pageUrl,
          detail: row.detail,
          status: row.status,
          fixedAt: row.fixedAt,
          evidenceValues: row.evidenceValues,
          proposedDiff: row.proposedDiff,
        },
        flow,
      ),
    )
  }

  return NextResponse.json({
    siteId: site.id,
    items,
    merged: false as const,
  })
}

export async function POST(request: Request) {
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    siteId?: string
    findingId?: string
    action?: string
  }
  const siteId = typeof body.siteId === 'string' ? body.siteId : ''
  const findingId = typeof body.findingId === 'string' ? body.findingId : ''
  if (!siteId || !findingId) {
    return NextResponse.json(
      { error: 'siteId and findingId are required' },
      { status: 400 },
    )
  }
  if (body.action !== 'reject') {
    return NextResponse.json(
      {
        error:
          'Approve must use POST /api/fix-strategies/findings/[id]/fix. This route only rejects.',
      },
      { status: 400 },
    )
  }
  if (!isFindingId(findingId)) {
    return NextResponse.json({ error: 'Finding id must be a UUID' }, { status: 400 })
  }

  const site = await loadOwnedConnectedSite(supabase, user.id, siteId)
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const store = getFindingsStore()
  const row = await store.getFinding(findingId)
  if (
    !row ||
    row.userId !== user.id ||
    row.siteId !== site.id ||
    row.bucket === 'internal' ||
    !isRelatedReadingFinding(row)
  ) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }

  const evidenceValues = {
    ...(row.evidenceValues || {}),
    rejected: true,
    rejectedAt: new Date().toISOString(),
    rejectedBy: user.id,
    neverAutoMerge: true,
    requiresApproval: true,
  }
  await store.updateFindingSourceResolution({
    findingId: row.id,
    sourcePath: row.sourcePath,
    sourceBlobSha: row.sourceBlobSha,
    sourceResolvedAt: row.sourceResolvedAt,
    sourceUnresolvedReason: row.sourceUnresolvedReason,
    evidenceValues,
  })

  const item = toLinkMapApproval(
    {
      id: row.id,
      pageUrl: row.pageUrl,
      detail: row.detail,
      status: row.status,
      fixedAt: row.fixedAt,
      evidenceValues,
      proposedDiff: row.proposedDiff,
    },
    await peekFixFlow(row.id, user.id),
  )

  return NextResponse.json({
    item,
    merged: false as const,
    applied: false as const,
  })
}
