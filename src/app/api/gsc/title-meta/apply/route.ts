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
    const url = typeof body.url === 'string' ? body.url : ''
    const title = typeof body.title === 'string' ? body.title : ''
    const description = typeof body.description === 'string' ? body.description : ''
    const queries = Array.isArray(body.queries) ? (body.queries as string[]) : []
    if (!siteId || !url || (!title && !description)) {
      return NextResponse.json({ error: 'siteId, url and at least one of title/description are required' }, { status: 400 })
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
    // Synthetic manual run — scopes the upsert/findings
    const origin = (() => {
      try {
        return new URL(url).origin
      } catch {
        return ''
      }
    })()
    const run = await store.createRun({ siteId, userId: user.id, origin, trigger: 'manual' })
    const decl = normalizeFixStrategyUrl(url) ?? url
    const rollupKey = ['titlemeta', 'auto-update-title-description', decl].join('|')
    const candidate: RolledPersistCandidate = {
      topicId: 'titlemeta',
      kind: 'head/title-meta-suggestion',
      verdict: 'auto-update-title-description',
      severity: null,
      detail: `Update <title> and meta description based on Search Console top queries: ${queries.join(', ')}`,
      pageUrl: url,
      declarationSite: decl,
      rollupKey,
      affectedUrlCount: 1,
      rolledUp: false,
      bucket: 'actionable',
      autoFixable: true,
      reportOnly: false,
      surfaceClass: 'finding',
      proposedDiff: {
        proposed: {
          title: title || null,
          description: description || null,
          queries,
        },
      },
      evidenceValues: {
        proposed: {
          title: title || null,
          description: description || null,
          queries,
        },
      },
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
    console.error('[gsc/title-meta/apply]', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

