/**
 * Queue an approval-required Related articles finding for the existing
 * Fix Agent / Create PR flow. Never applies the transform itself.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { isTransformRegistered } from '@/lib/fix-strategies/findings-ui/fix-run/apply-registry'
import { loadOwnedConnectedSite } from '@/lib/internal-link-map'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import type { RolledPersistCandidate } from '@/lib/fix-strategies/findings-ui/crawl/run-detectors'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

export async function POST(req: Request) {
  if (!isTransformRegistered('related', 'auto-add-related-articles')) {
    return NextResponse.json(
      { error: 'No safe transform is registered for this suggestion' },
      { status: 400 },
    )
  }

  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    siteId?: string
    sourceUrl?: string
    targets?: Array<{ href: string; anchorText: string }>
  }
  const siteId = typeof body.siteId === 'string' ? body.siteId : ''
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : ''
  const targets = Array.isArray(body.targets) ? body.targets : []
  if (!siteId || !sourceUrl || targets.length === 0) {
    return NextResponse.json(
      { error: 'siteId, sourceUrl, and targets are required' },
      { status: 400 },
    )
  }

  const site = await loadOwnedConnectedSite(supabase, user.id, siteId)
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const store = getFindingsStore()
  const runs = await store.listRunsForSite(siteId)
  const latest = runs[0]
  if (!latest) {
    return NextResponse.json(
      { error: 'Run a crawl before sending a link suggestion to Audit' },
      { status: 400 },
    )
  }

  const decl = normalizeFixStrategyUrl(sourceUrl) ?? sourceUrl
  const rollupKey = ['related', 'auto-add-related-articles', decl].join('|')
  const candidate: RolledPersistCandidate = {
    topicId: 'related',
    kind: 'internal-links/related-articles',
    verdict: 'auto-add-related-articles',
    severity: null,
    detail: `Add related links to ${targets.map((t) => t.href).join(', ')}`,
    pageUrl: sourceUrl,
    declarationSite: decl,
    rollupKey,
    affectedUrlCount: 1,
    rolledUp: false,
    bucket: 'actionable',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'finding',
    proposedDiff: { proposed: { relatedTargets: targets } },
    evidenceValues: { relatedTargets: targets, requiresApproval: true },
    sourceRows: [],
  }
  await store.upsertFindings({
    siteId,
    userId: user.id,
    runId: latest.id,
    findings: [candidate],
    internalEvidence: [],
  })

  return NextResponse.json({
    ok: true,
    runId: latest.id,
    requiresApproval: true,
  })
}
