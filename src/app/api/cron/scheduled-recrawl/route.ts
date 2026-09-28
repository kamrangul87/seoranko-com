/**
 * Change Monitoring 3.3 — weekly scheduled recrawl (Hobby-safe: once weekly).
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 * Optional: ?domain=autodun.com to limit to one host (acceptance / ops).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  runScheduledRecrawlForSite,
  runScheduledRecrawlPass,
} from '@/lib/fix-strategies/findings-ui/crawl/scheduled-recrawl'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthorized()
  }

  const domainFilter = req.nextUrl.searchParams.get('domain')
  const continueRunId = req.nextUrl.searchParams.get('continue')
  const store = getFindingsStore()

  // Continue draining a single in-flight scheduled run (chained from a prior tick).
  if (continueRunId) {
    const run = await store.getRun(continueRunId)
    if (!run || run.trigger !== 'scheduled') {
      return NextResponse.json(
        { ok: false, error: 'Scheduled run not found' },
        { status: 404 },
      )
    }
    const result = await runScheduledRecrawlForSite(
      {
        siteId: run.siteId,
        userId: run.userId,
        origin: run.origin,
        detectOnly: run.detectOnly,
      },
      { store, resumeInProgress: true },
    )
    return NextResponse.json({ ok: true, continue: true, result })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: 'Supabase service role not configured' },
      { status: 500 },
    )
  }

  const supabase = createClient(url, key)
  const { data: sites, error } = await supabase
    .from('connected_sites')
    .select('id, user_id, domain')
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    )
  }

  const inputs = (sites ?? []).map((s) => {
    const domain = String(s.domain).replace(/^www\./, '')
    return {
      siteId: String(s.id),
      userId: String(s.user_id),
      origin: `https://${domain}`,
      detectOnly: false as const,
    }
  })

  const pass = await runScheduledRecrawlPass(inputs, {
    store,
    domainFilter,
    maxNewStarts: 2,
    resumeInProgress: true,
  })

  // If any run is still non-terminal (should be rare — drain forces failed),
  // chain a continue request so Hobby 60s does not leave status=running.
  const stillOpen = pass.processed.filter(
    (p) =>
      p.runId &&
      (p.status === 'queued' || p.status === 'running' || !p.finishedAt),
  )
  const continueUrls: string[] = []
  for (const p of stillOpen) {
    const host =
      process.env.VERCEL_URL != null
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_SITE_URL || null
    if (!host || !p.runId || !process.env.CRON_SECRET) continue
    const cont = `${host}/api/cron/scheduled-recrawl?continue=${p.runId}`
    continueUrls.push(cont)
    // Fire-and-forget; drainCrawlRunToTerminal already tries hard in-process.
    void fetch(cont, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    }).catch(() => undefined)
  }

  return NextResponse.json({
    ok: true,
    domainFilter: domainFilter || null,
    started: pass.started,
    skipped: pass.skipped,
    failed: pass.failed,
    continueUrls,
    results: pass.processed.map((p) => ({
      siteId: p.siteId,
      origin: p.origin,
      decision: p.decision,
      resumed: p.resumed ?? false,
      runId: p.runId ?? null,
      status: p.status ?? null,
      finishedAt: p.finishedAt ?? null,
      urlsFound: p.urlsFound ?? null,
      urlsDiscovered: p.urlsDiscovered ?? null,
      urlsCrawled: p.urlsCrawled ?? null,
      pagesRendered: p.pagesRendered ?? null,
      pagesRenderFailed: p.pagesRenderFailed ?? null,
      urlCap: p.urlCap ?? null,
      isPartial: p.isPartial ?? null,
      planPageLimitNote:
        p.coverageNotes?.find((n) => n.code === 'plan_page_limit')?.detail ??
        null,
      resolvedCount: p.resolvedCount ?? 0,
      regressedCount: p.regressedCount ?? 0,
      error: p.error ?? null,
    })),
  })
}
