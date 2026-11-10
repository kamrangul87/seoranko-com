/**
 * Queue an approval-required Related reading finding for the existing
 * Fix Agent / Create PR flow. Never applies the transform itself and
 * never merges a customer PR.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { isTransformRegistered } from '@/lib/fix-strategies/findings-ui/fix-run/apply-registry'
import { loadOwnedConnectedSite } from '@/lib/internal-link-map'
import {
  groupRelatedLinkItems,
  relatedFindingCandidate,
  RELATED_LINK_VERDICT,
  type RelatedLinkItem,
} from '@/lib/internal-link-map/queue-related-findings'

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
  if (!isTransformRegistered('related', RELATED_LINK_VERDICT)) {
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
    links?: RelatedLinkItem[]
  }
  const siteId = typeof body.siteId === 'string' ? body.siteId : ''
  const links: RelatedLinkItem[] = Array.isArray(body.links) ? body.links : []
  if (links.length === 0 && typeof body.sourceUrl === 'string' && Array.isArray(body.targets)) {
    for (const t of body.targets) {
      if (t && typeof t.href === 'string' && typeof t.anchorText === 'string') {
        links.push({
          sourceUrl: body.sourceUrl,
          href: t.href,
          anchorText: t.anchorText,
        })
      }
    }
  }
  if (!siteId || links.length === 0) {
    return NextResponse.json(
      { error: 'siteId and links (or sourceUrl + targets) are required' },
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

  const grouped = groupRelatedLinkItems(links)
  const findings = grouped.map((g) => relatedFindingCandidate(g.sourceUrl, g.targets))
  await store.upsertFindings({
    siteId,
    userId: user.id,
    runId: latest.id,
    findings,
    internalEvidence: [],
  })

  return NextResponse.json({
    ok: true,
    runId: latest.id,
    findingCount: findings.length,
    requiresApproval: true,
    applied: false,
    merged: false,
  })
}
