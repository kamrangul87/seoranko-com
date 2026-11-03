import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import type { RolledPersistCandidate } from '@/lib/fix-strategies/findings-ui/crawl/run-detectors'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : ''
    const targets = Array.isArray(body.targets) ? (body.targets as Array<{ href: string; anchorText: string }>) : []
    if (!siteId || !sourceUrl || targets.length === 0) {
      return NextResponse.json({ error: 'siteId, sourceUrl, and targets are required' }, { status: 400 })
    }
    const cookieStore = cookies()
    const authClient = createSupabaseSsrClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const store = getFindingsStore()
    const origin = (() => {
      try {
        return new URL(sourceUrl).origin
      } catch {
        return ''
      }
    })()
    const run = await store.createRun({ siteId, userId: user.id, origin, trigger: 'manual' })
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
      runId: run.id,
      findings: [candidate],
      internalEvidence: [],
    })

    return NextResponse.json({ ok: true, runId: run.id })
  } catch (err) {
    console.error('[gsc/internal-links/apply]', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

