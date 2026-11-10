/**
 * Link health from the latest crawl edges. Mechanical items queue through
 * the existing approval flow and never auto-merge.
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import { isTransformRegistered } from '@/lib/fix-strategies/findings-ui/fix-run/apply-registry'
import {
  extractPageSignals,
  LINK_MAP_MAX_PAGES,
  listCrawlLinkEdges,
  listSlimCrawlJobs,
  loadHtmlJobsForRun,
  loadOwnedConnectedSite,
  rebuildMissingCrawlLinkEdges,
} from '@/lib/internal-link-map'
import { detectLinkHealthIssues } from '@/lib/internal-link-map/link-health'
import { healthFindingsFromIssues } from '@/lib/internal-link-map/queue-health-findings'
import { RELATED_LINK_VERDICT } from '@/lib/internal-link-map/queue-related-findings'

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

async function healthForSite(input: {
  userId: string
  siteId: string
  origin: string
  runId: string
  listJobsForRun: () => Promise<
    Array<{
      url: string
      status: string
      httpStatus: number | null
      finalUrl: string | null
      html: string | null
    }>
  >
}) {
  const htmlJobs = await loadHtmlJobsForRun(input.runId, input.listJobsForRun)
  const jobs =
    htmlJobs.length > 0
      ? htmlJobs.map((j) => ({
          url: j.url,
          status: j.status,
          httpStatus: j.httpStatus,
          finalUrl: j.finalUrl,
        }))
      : await listSlimCrawlJobs(input.runId)

  let edges = await listCrawlLinkEdges(input.runId)
  if (edges.length === 0) {
    const rebuilt = await rebuildMissingCrawlLinkEdges({
      runId: input.runId,
      siteId: input.siteId,
      userId: input.userId,
      origin: input.origin,
      existingEdges: edges,
      jobs: htmlJobs,
    })
    edges = rebuilt.edges
  }

  const sliced = htmlJobs.slice(0, LINK_MAP_MAX_PAGES)
  const htmlByUrl: Record<string, string> = {}
  const source =
    sliced.length > 0
      ? sliced.map((j) => ({
          url: j.finalUrl || j.url,
          httpStatus: j.httpStatus,
          finalUrl: j.finalUrl,
          status: j.status,
          html: j.html,
        }))
      : jobs.map((j) => ({
          url: j.finalUrl || j.url,
          httpStatus: j.httpStatus,
          finalUrl: j.finalUrl,
          status: j.status,
          html: null as string | null,
        }))
  const pages = source.map((j) => {
    const html = j.html
    const signals = extractPageSignals(html || '')
    if (html) {
      htmlByUrl[j.finalUrl || j.url] = html
      htmlByUrl[j.url] = html
    }
    return {
      url: j.finalUrl || j.url,
      title: signals.title,
      h1: signals.h1,
      html,
      httpStatus: j.httpStatus,
      finalUrl: j.finalUrl,
      jobStatus: j.status,
    }
  })

  const issues = detectLinkHealthIssues({
    originUrl: input.origin,
    homepageUrl: input.origin,
    pages,
    edges,
    htmlByUrl,
  })
  return { issues, runId: input.runId }
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
  const runs = await store.listRunsForSite(siteId)
  const latest = runs[0]
  if (!latest) {
    return NextResponse.json({
      siteId,
      runId: null,
      issues: [],
      merged: false as const,
    })
  }

  const origin = latest.origin || `https://${site.domain}`
  const { issues, runId } = await healthForSite({
    userId: user.id,
    siteId: site.id,
    origin,
    runId: latest.id,
    listJobsForRun: () => store.listJobsForRun(latest.id),
  })

  return NextResponse.json({
    siteId: site.id,
    runId,
    issues,
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
    action?: string
    issueIds?: unknown
  }
  const siteId = typeof body.siteId === 'string' ? body.siteId : ''
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }
  if (body.action !== 'queue') {
    return NextResponse.json(
      { error: 'This route queues mechanical health items for approval' },
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
      { error: 'Run a crawl before queuing link health fixes' },
      { status: 400 },
    )
  }

  const origin = latest.origin || `https://${site.domain}`
  const { issues, runId } = await healthForSite({
    userId: user.id,
    siteId: site.id,
    origin,
    runId: latest.id,
    listJobsForRun: () => store.listJobsForRun(latest.id),
  })

  const wanted = new Set(
    Array.isArray(body.issueIds)
      ? body.issueIds.filter((id): id is string => typeof id === 'string')
      : issues.filter((i) => i.mechanical).map((i) => i.id),
  )
  const selected = issues.filter((i) => wanted.has(i.id) && i.mechanical)
  const findings = healthFindingsFromIssues(selected).filter((f) =>
    isTransformRegistered(f.topicId, f.verdict),
  )
  if (findings.length === 0) {
    return NextResponse.json(
      {
        error: 'No mechanical health items to queue',
        issues,
        queued: 0,
        merged: false as const,
      },
      { status: 400 },
    )
  }
  if (
    findings.some((f) => f.verdict === RELATED_LINK_VERDICT) &&
    !isTransformRegistered('related', RELATED_LINK_VERDICT)
  ) {
    return NextResponse.json(
      { error: 'No safe transform is registered for this suggestion' },
      { status: 400 },
    )
  }

  await store.upsertFindings({
    siteId,
    userId: user.id,
    runId,
    findings,
    internalEvidence: [],
  })

  return NextResponse.json({
    siteId,
    runId,
    issues,
    queued: findings.length,
    requiresApproval: true,
    applied: false,
    merged: false as const,
  })
}
