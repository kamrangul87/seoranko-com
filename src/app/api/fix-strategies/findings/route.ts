import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  CRAWL_URL_CHUNK_SIZE,
  failAbandonedCrawlRuns,
  getFindingsStore,
} from '@/lib/fix-strategies/findings-ui/crawl'
import { normalizePublicOrigin } from '@/lib/fix-strategies/findings-ui/crawl/normalize-public-origin'
import {
  buildWhatChangedDigest,
  pickPreviousTerminalRunId,
} from '@/lib/fix-strategies/findings-ui/crawl/what-changed'
import {
  aggregateLeftAlone,
  persistedToUiFinding,
} from '@/lib/fix-strategies/findings-ui/map-persisted'
import type { FindingsListResponse } from '@/lib/fix-strategies/findings-ui/types'
import { canRunFixAgent } from '@/lib/fix-strategies/findings-ui/fix-run/master-gate'

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
 * GET /api/fix-strategies/findings?siteId=…
 * Detect-only: ?detectOrigin=https://example.com (no connected site)
 * Optional: informational=1
 * Internal-bucket rows are never returned.
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
  const siteId = url.searchParams.get('siteId')
  const detectOriginRaw = url.searchParams.get('detectOrigin')
  const includeInformational = url.searchParams.get('informational') === '1'
  const store = getFindingsStore()

  if (detectOriginRaw && !siteId) {
    const origin = normalizePublicOrigin(detectOriginRaw)
    if (!origin) {
      return NextResponse.json(
        { error: 'A valid public detectOrigin is required' },
        { status: 400 },
      )
    }
    const runsRaw = await store.listRunsForDetectOrigin(user.id, origin)
    await failAbandonedCrawlRuns(store, runsRaw)
    const runs = await store.listRunsForDetectOrigin(user.id, origin)
    const latest = runs[0] ?? null
    const rows = await store.listFindings({
      detectOrigin: origin,
      userId: user.id,
      includeInformational,
    })
    const counts = await store.counts({
      detectOrigin: origin,
      userId: user.id,
    })

    const findings = []
    for (const row of rows) {
      const evidence = await store.listEvidenceForFinding(row.id)
      findings.push(persistedToUiFinding(row, evidence))
    }

    const terminal =
      latest &&
      (latest.status === 'complete' || latest.status === 'partial')
    const whatChanged = terminal
      ? buildWhatChangedDigest({
          currentRunId: latest.id,
          previousRunId: pickPreviousTerminalRunId(runs, latest.id),
          findings: rows,
        })
      : null

    const body: FindingsListResponse = {
      origin,
      crawledAt: latest?.finishedAt ?? latest?.startedAt ?? null,
      demo: false,
      siteId: null,
      canRunFixAgent: canRunFixAgent(user.email),
      crawl: latest
        ? {
            runId: latest.id,
            status: latest.status,
            isPartial: latest.isPartial,
            coverageNotes: latest.coverageNotes,
            urlsFound: latest.urlsFound || latest.urlsDiscovered,
            urlsDiscovered: latest.urlsDiscovered,
            urlsCrawled: latest.urlsCrawled,
            urlsFailed: latest.urlsFailed ?? 0,
            urlsClientOnly: latest.urlsClientOnly ?? 0,
            urlCap: latest.urlCap ?? null,
            chunkSize: latest.chunkSize || CRAWL_URL_CHUNK_SIZE,
            pagesRendered: latest.pagesRendered ?? 0,
            pagesRenderFailed: latest.pagesRenderFailed ?? 0,
            totalRenderTimeMs: latest.totalRenderTimeMs ?? 0,
            updatedAt: latest.updatedAt ?? null,
          }
        : null,
      whatChanged,
      counts,
      findings,
      leftAlone: aggregateLeftAlone(findings),
    }
    return NextResponse.json(body)
  }

  if (!siteId) {
    return NextResponse.json(
      { error: 'siteId or detectOrigin is required' },
      { status: 400 },
    )
  }

  const { data: site, error: siteErr } = await supabase
    .from('connected_sites')
    .select('id, domain, brand')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (siteErr || !site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const runsRaw = await store.listRunsForSite(siteId)
  await failAbandonedCrawlRuns(store, runsRaw)
  const runs = await store.listRunsForSite(siteId)
  const latest = runs[0] ?? null
  const rows = await store.listFindings({ siteId, includeInformational })
  const counts = await store.counts({ siteId })

  const findings = []
  for (const row of rows) {
    const evidence = await store.listEvidenceForFinding(row.id)
    findings.push(persistedToUiFinding(row, evidence))
  }

  const origin = `https://${String(site.domain).replace(/^www\./, '')}`

  const terminal =
    latest &&
    (latest.status === 'complete' || latest.status === 'partial')
  const whatChanged = terminal
    ? buildWhatChangedDigest({
        currentRunId: latest.id,
        previousRunId: pickPreviousTerminalRunId(runs, latest.id),
        findings: rows,
      })
    : null

  const body: FindingsListResponse = {
    origin,
    crawledAt: latest?.finishedAt ?? latest?.startedAt ?? null,
    demo: false,
    siteId,
    canRunFixAgent: canRunFixAgent(user.email),
    crawl: latest
      ? {
          runId: latest.id,
          status: latest.status,
          isPartial: latest.isPartial,
          coverageNotes: latest.coverageNotes,
          urlsFound: latest.urlsFound || latest.urlsDiscovered,
          urlsDiscovered: latest.urlsDiscovered,
          urlsCrawled: latest.urlsCrawled,
          urlsFailed: latest.urlsFailed ?? 0,
          urlsClientOnly: latest.urlsClientOnly ?? 0,
          urlCap: latest.urlCap ?? null,
          chunkSize: latest.chunkSize || CRAWL_URL_CHUNK_SIZE,
          pagesRendered: latest.pagesRendered ?? 0,
          pagesRenderFailed: latest.pagesRenderFailed ?? 0,
          totalRenderTimeMs: latest.totalRenderTimeMs ?? 0,
          updatedAt: latest.updatedAt ?? null,
        }
      : null,
    whatChanged,
    counts,
    findings,
    leftAlone: aggregateLeftAlone(findings),
  }

  return NextResponse.json(body)
}
