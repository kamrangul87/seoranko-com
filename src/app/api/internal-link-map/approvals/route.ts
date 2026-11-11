/**
 * List / reject / batch-approve / regenerate Related reading findings.
 * Single Approve + open PR stays on POST /api/fix-strategies/findings/[id]/fix.
 * This route never merges and never closes GitHub PRs.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { isFindingId } from '@/lib/fix-strategies/findings-ui/is-finding-id'
import {
  peekFixFlow,
  resetFixFlowToIdle,
} from '@/lib/fix-strategies/findings-ui/fix-flow/persist'
import { commitRelatedFindingsBatch } from '@/lib/fix-strategies/findings-ui/fix-flow/commit-related-batch'
import { loadOwnedConnectedSite } from '@/lib/internal-link-map'
import {
  approvalStatusFrom,
  canRegenerateRelated,
  isLinkHealthFinding,
  isRelatedReadingFinding,
  sortLinkMapApprovals,
  toLinkMapApproval,
} from '@/lib/internal-link-map/approvals'
import type { LinkMapApproval } from '@/lib/internal-link-map/approvals'
import {
  isObsoleteEvidence,
  markObsoleteUtilityFinding,
  relatedFindingIsObsolete,
} from '@/lib/internal-link-map/obsolete-related'
import { verifyRelatedFindingLive } from '@/lib/internal-link-map/verify-related-live'
import type { PersistedFindingRow } from '@/lib/fix-strategies/findings-ui/crawl/constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

async function approvalItem(
  row: PersistedFindingRow,
  userId: string,
  evidenceValues?: Record<string, unknown> | null,
) {
  return toLinkMapApproval(
    {
      id: row.id,
      pageUrl: row.pageUrl,
      detail: row.detail,
      status: row.status,
      fixedAt: row.fixedAt,
      evidenceValues: evidenceValues ?? row.evidenceValues,
      proposedDiff: row.proposedDiff,
    },
    await peekFixFlow(row.id, userId),
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
      (isRelatedReadingFinding(row) || isLinkHealthFinding(row)),
  )
  const items: LinkMapApproval[] = []
  for (const row of related) {
    const flow = await peekFixFlow(row.id, user.id)
    const status = approvalStatusFrom({ finding: row, flow })
    const alreadyObsolete = isObsoleteEvidence(row.evidenceValues)
    if (alreadyObsolete) continue
    if (status === 'pending' && relatedFindingIsObsolete(row)) {
      const evidenceValues = markObsoleteUtilityFinding(row.evidenceValues)
      await store.updateFindingSourceResolution({
        findingId: row.id,
        sourcePath: row.sourcePath,
        sourceBlobSha: row.sourceBlobSha,
        sourceResolvedAt: row.sourceResolvedAt,
        sourceUnresolvedReason: row.sourceUnresolvedReason,
        evidenceValues,
      })
      continue
    }
    items.push(await approvalItem(row, user.id))
  }

  return NextResponse.json({
    siteId: site.id,
    items: sortLinkMapApprovals(items),
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
    findingIds?: unknown
    action?: string
  }
  const siteId = typeof body.siteId === 'string' ? body.siteId : ''
  const findingId = typeof body.findingId === 'string' ? body.findingId : ''
  const action = body.action

  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }

  const site = await loadOwnedConnectedSite(supabase, user.id, siteId)
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const store = getFindingsStore()

  if (action === 'approve-batch') {
    const rawIds = Array.isArray(body.findingIds) ? body.findingIds : []
    const findingIds = rawIds.filter(
      (id): id is string => typeof id === 'string' && isFindingId(id),
    )
    if (findingIds.length === 0) {
      return NextResponse.json(
        { error: 'findingIds must be a non-empty list of UUIDs' },
        { status: 400 },
      )
    }
    const rows: PersistedFindingRow[] = []
    for (const id of findingIds) {
      const row = await store.getFinding(id)
      if (
        !row ||
        row.userId !== user.id ||
        row.siteId !== site.id ||
        row.bucket === 'internal' ||
        !isRelatedReadingFinding(row)
      ) {
        return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
      }
      if (isObsoleteEvidence(row.evidenceValues) || relatedFindingIsObsolete(row)) {
        continue
      }
      rows.push(row)
    }
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: 'No related reading findings left to approve',
          items: [],
          merged: false as const,
        },
        { status: 400 },
      )
    }

    const result = await commitRelatedFindingsBatch({
      userId: user.id,
      email: user.email,
      findings: rows,
    })
    const items = []
    for (const row of rows) {
      items.push(await approvalItem(row, user.id))
    }
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error || 'Approve failed',
          items,
          prUrl: result.prUrl,
          merged: false as const,
        },
        { status: 400 },
      )
    }
    return NextResponse.json({
      items,
      prUrl: result.prUrl,
      merged: false as const,
    })
  }

  if (!findingId) {
    return NextResponse.json(
      { error: 'siteId and findingId are required' },
      { status: 400 },
    )
  }
  if (!isFindingId(findingId)) {
    return NextResponse.json({ error: 'Finding id must be a UUID' }, { status: 400 })
  }

  const row = await store.getFinding(findingId)
  if (
    !row ||
    row.userId !== user.id ||
    row.siteId !== site.id ||
    row.bucket === 'internal' ||
    (!isRelatedReadingFinding(row) && !isLinkHealthFinding(row))
  ) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }

  if (action === 'regenerate') {
    if (!isRelatedReadingFinding(row)) {
      return NextResponse.json(
        { error: 'This finding cannot be regenerated' },
        { status: 400 },
      )
    }
    const flow = await peekFixFlow(row.id, user.id)
    if (!canRegenerateRelated(row, flow)) {
      return NextResponse.json(
        { error: 'This finding cannot be regenerated' },
        { status: 400 },
      )
    }
    await resetFixFlowToIdle(row.id, user.id)
    const evidenceValues: Record<string, unknown> = {
      ...(row.evidenceValues || {}),
      neverAutoMerge: true,
      requiresApproval: true,
      regenerateRequestedAt: new Date().toISOString(),
    }
    delete evidenceValues.relatedTransformVersion
    delete evidenceValues.rejected
    delete evidenceValues.rejectedAt
    delete evidenceValues.rejectedBy
    await store.updateFindingSourceResolution({
      findingId: row.id,
      sourcePath: row.sourcePath,
      sourceBlobSha: row.sourceBlobSha,
      sourceResolvedAt: row.sourceResolvedAt,
      sourceUnresolvedReason: row.sourceUnresolvedReason,
      evidenceValues,
    })
    return NextResponse.json({
      item: await approvalItem(row, user.id, evidenceValues),
      merged: false as const,
      closedGithubPr: false as const,
    })
  }

  if (action === 'verify-live') {
    const ev = (row.evidenceValues || {}) as Record<string, unknown>
    const raw = ev.relatedTargets
    const targets = Array.isArray(raw)
      ? (raw as Array<{ href?: unknown; anchorText?: unknown }>)
          .filter((t) => t && typeof t.href === 'string')
          .map((t) => ({
            href: String(t.href),
            anchorText: typeof t.anchorText === 'string' ? t.anchorText : '',
          }))
      : []
    if (!row.pageUrl || targets.length === 0) {
      return NextResponse.json(
        { error: 'Finding has no page URL or related targets to verify' },
        { status: 400 },
      )
    }
    const relatedVerify = await verifyRelatedFindingLive({
      pageUrl: row.pageUrl,
      targets,
    })
    const evidenceValues = {
      ...ev,
      relatedVerify,
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
    return NextResponse.json({
      item: await approvalItem(row, user.id, evidenceValues),
      merged: false as const,
    })
  }

  if (action !== 'reject') {
    return NextResponse.json(
      {
        error:
          'Approve must use POST /api/fix-strategies/findings/[id]/fix. This route rejects, regenerates, or batch-approves.',
      },
      { status: 400 },
    )
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

  return NextResponse.json({
    item: await approvalItem(row, user.id, evidenceValues),
    merged: false as const,
    applied: false as const,
  })
}
