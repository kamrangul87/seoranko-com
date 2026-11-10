import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  CRAWL_URL_CHUNK_SIZE,
  failAbandonedCrawlRuns,
  getFindingsStore,
} from '@/lib/fix-strategies/findings-ui/crawl'
import { normalizePublicOrigin } from '@/lib/fix-strategies/findings-ui/crawl/normalize-public-origin'
import { isTransformRegistered } from '@/lib/fix-strategies/findings-ui/fix-run/apply-registry'
import {
  assembleInternalLinkMap,
  listCrawlLinkEdges,
  listSlimCrawlJobs,
  loadHtmlJobsForRun,
  loadOwnedConnectedSite,
  nodeDetailForUrl,
  rebuildMissingCrawlLinkEdges,
} from '@/lib/internal-link-map'
import { asPage2SuggestionsCache } from '@/lib/gsc/precompute-suggestions'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import type { Page2LinkCache } from '@/lib/internal-link-map/types'

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

function page2ForUrl(
  cache: ReturnType<typeof asPage2SuggestionsCache>,
  url: string,
): Page2LinkCache | null {
  if (!cache) return null
  const n = normalizeFixStrategyUrl(url) ?? url
  for (const [k, v] of Object.entries(cache.internalLinks)) {
    const kn = normalizeFixStrategyUrl(k) ?? k
    if (kn === n) return v
  }
  return null
}

async function loadPage2Cache(siteId: string | null): Promise<ReturnType<typeof asPage2SuggestionsCache>> {
  if (!siteId) return null
  try {
    const sb = createServiceRoleClient()
    const { data } = await sb
      .from('gsc_connections')
      .select('page2_suggestions')
      .eq('site_id', siteId)
      .eq('status', 'active')
      .maybeSingle()
    return asPage2SuggestionsCache(data?.page2_suggestions)
  } catch {
    return null
  }
}

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
  const selectedUrl = url.searchParams.get('url')
  const store = getFindingsStore()

  let origin = ''
  let ownedSiteId: string | null = null

  if (detectOriginRaw && !siteId) {
    const detected = normalizePublicOrigin(detectOriginRaw)
    if (!detected) {
      return NextResponse.json(
        { error: 'A valid public detectOrigin is required' },
        { status: 400 },
      )
    }
    origin = detected
  } else {
    if (!siteId) {
      return NextResponse.json(
        { error: 'siteId or detectOrigin is required' },
        { status: 400 },
      )
    }
    const site = await loadOwnedConnectedSite(supabase, user.id, siteId)
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }
    ownedSiteId = site.id
    origin = `https://${site.domain}`
  }

  const runsRaw = ownedSiteId
    ? await store.listRunsForSite(ownedSiteId)
    : await store.listRunsForDetectOrigin(user.id, origin)
  await failAbandonedCrawlRuns(store, runsRaw)
  const runs = ownedSiteId
    ? await store.listRunsForSite(ownedSiteId)
    : await store.listRunsForDetectOrigin(user.id, origin)
  const latest = runs[0] ?? null

  if (!latest) {
    return NextResponse.json({
      origin,
      siteId: ownedSiteId,
      crawl: null,
      graph: null,
      detail: null,
    })
  }

  origin = latest.origin || origin

  let jobs = await listSlimCrawlJobs(latest.id)
  const loadHtml = () =>
    loadHtmlJobsForRun(latest.id, () => store.listJobsForRun(latest.id))
  const toSlim = (rows: Awaited<ReturnType<typeof loadHtml>>) =>
    rows.map((j) => ({
      url: j.url,
      status: j.status,
      httpStatus: j.httpStatus,
      finalUrl: j.finalUrl,
    }))
  const htmlJobs = jobs.length === 0 ? await loadHtml() : null
  if (htmlJobs) {
    jobs = toSlim(htmlJobs)
  }
  let edges = await listCrawlLinkEdges(latest.id)
  if (edges.length === 0) {
    const html = htmlJobs ?? (await loadHtml())
    const rebuilt = await rebuildMissingCrawlLinkEdges({
      runId: latest.id,
      siteId: ownedSiteId ?? latest.siteId,
      userId: latest.userId,
      origin,
      existingEdges: edges,
      jobs: html,
    })
    edges = rebuilt.edges
    if (jobs.length === 0) {
      jobs = toSlim(html)
    }
  }
  const map = assembleInternalLinkMap({
    originUrl: origin,
    jobs,
    edges,
  })

  const page2 = selectedUrl
    ? page2ForUrl(await loadPage2Cache(ownedSiteId), selectedUrl)
    : null
  const detail = selectedUrl ? nodeDetailForUrl(map, selectedUrl, page2) : null

  let orphanFindingId: string | null = null
  if (detail?.node?.kind === 'orphan' && ownedSiteId) {
    try {
      const findings = await store.listFindings({
        siteId: ownedSiteId,
        includeInformational: false,
      })
      const hit = findings.find(
        (f) =>
          f.topicId === '43' &&
          f.pageUrl &&
          (normalizeFixStrategyUrl(f.pageUrl) ?? f.pageUrl) ===
            detail.node!.url,
      )
      orphanFindingId = hit?.id ?? null
    } catch {
      orphanFindingId = null
    }
  }

  const canCreateRelatedFinding = isTransformRegistered(
    'related',
    'auto-add-related-articles',
  )

  return NextResponse.json({
    origin,
    siteId: ownedSiteId,
    crawl: {
      runId: latest.id,
      status: latest.status,
      isPartial: latest.isPartial,
      urlsFound: latest.urlsFound || latest.urlsDiscovered,
      urlsDiscovered: latest.urlsDiscovered,
      urlsCrawled: latest.urlsCrawled,
      urlsFailed: latest.urlsFailed ?? 0,
      urlCap: latest.urlCap ?? null,
      chunkSize: latest.chunkSize || CRAWL_URL_CHUNK_SIZE,
      updatedAt: latest.updatedAt ?? null,
      startedAt: latest.startedAt ?? null,
      finishedAt: latest.finishedAt ?? null,
      errorDetail: latest.errorDetail ?? null,
    },
    graph: {
      homepageUrl: map.homepageUrl,
      nodes: map.nodes,
      edges: map.visualEdges,
      metrics: map.metrics,
    },
    detail: detail
      ? {
          ...detail,
          orphanFindingId,
          canCreateRelatedFinding,
        }
      : null,
  })
}
