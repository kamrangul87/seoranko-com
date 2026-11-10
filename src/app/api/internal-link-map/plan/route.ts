/**
 * Build a site-wide internal linking plan from the latest crawl.
 * Never applies or merges — review + Send to Audit only.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import {
  assembleInternalLinkMap,
  extractPageSignals,
  LINK_MAP_MAX_PAGES,
  listCrawlLinkEdges,
  listSlimCrawlJobs,
  loadHtmlJobsForRun,
  loadOwnedConnectedSite,
  planSitewideInternalLinks,
  rebuildMissingCrawlLinkEdges,
} from '@/lib/internal-link-map'

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
  const supabase = authClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { siteId?: string }
  const siteId = typeof body.siteId === 'string' ? body.siteId : ''
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
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
      { error: 'Run a crawl before planning internal links' },
      { status: 400 },
    )
  }

  const origin = latest.origin || `https://${site.domain}`
  const htmlJobs = await loadHtmlJobsForRun(latest.id, () =>
    store.listJobsForRun(latest.id),
  )
  const jobs =
    htmlJobs.length > 0
      ? htmlJobs.map((j) => ({
          url: j.url,
          status: j.status,
          httpStatus: j.httpStatus,
          finalUrl: j.finalUrl,
        }))
      : await listSlimCrawlJobs(latest.id)

  let edges = await listCrawlLinkEdges(latest.id)
  if (edges.length === 0) {
    const rebuilt = await rebuildMissingCrawlLinkEdges({
      runId: latest.id,
      siteId,
      userId: user.id,
      origin,
      existingEdges: edges,
      jobs: htmlJobs,
    })
    edges = rebuilt.edges
  }

  const sliced = htmlJobs.slice(0, LINK_MAP_MAX_PAGES)
  const pages = sliced.map((j) => {
    const signals = extractPageSignals(j.html || '')
    return {
      url: j.finalUrl || j.url,
      finalUrl: j.finalUrl,
      httpStatus: j.httpStatus,
      jobStatus: j.status,
      title: signals.title,
      h1: signals.h1,
      headings: signals.headings,
      text: signals.text,
      noindex: signals.noindex,
    }
  })

  const plan = planSitewideInternalLinks({
    originUrl: origin,
    homepageUrl: origin,
    pages,
    edges,
  })

  const titles = new Map<string, string | null>()
  for (const p of pages) {
    titles.set(p.url, p.title)
  }
  const map = assembleInternalLinkMap({
    originUrl: origin,
    jobs,
    edges,
    titles,
  })

  return NextResponse.json({
    origin,
    siteId,
    runId: latest.id,
    requiresApproval: true,
    clusters: plan.clusters,
    links: plan.links,
    graph: {
      homepageUrl: map.homepageUrl,
      nodes: map.nodes,
      edges: map.visualEdges,
      metrics: map.metrics,
    },
  })
}
