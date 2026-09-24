import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  CRAWL_URL_CHUNK_SIZE,
  startCrawlRun,
  processCrawlTick,
  getFindingsStore,
} from '@/lib/fix-strategies/findings-ui/crawl'
import { normalizePublicOrigin } from '@/lib/fix-strategies/findings-ui/crawl/normalize-public-origin'
import {
  assertCrawlStartAllowed,
  recordCrawlStart,
} from '@/lib/fix-strategies/findings-ui/crawl/rate-limit'
import { crawlDailyLimitForUser, crawlPageQuotaForUser } from '@/lib/stripe/entitlements'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
 * POST /api/fix-strategies/findings/crawl
 *
 * Connected: { siteId, action: 'start' | 'tick', runId? }
 * Detect-only: { mode: 'detect', url, action: 'start' | 'tick', runId? }
 *   — public URL, no connected_sites row, no repo, no stored site credentials.
 */
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
    mode?: 'detect' | 'connected'
    url?: string
    action?: 'start' | 'tick'
    runId?: string
    maxUrls?: number
  }

  const detectOnly = body.mode === 'detect'
  const store = getFindingsStore()

  if (detectOnly) {
    if (body.action === 'start') {
      const origin = normalizePublicOrigin(body.url ?? '')
      if (!origin) {
        return NextResponse.json(
          { error: 'A valid public URL is required for detect-only mode' },
          { status: 400 },
        )
      }
      const dailyLimit = await crawlDailyLimitForUser({
        userId: user.id,
        email: user.email,
      })
      const quota = assertCrawlStartAllowed(user.id, dailyLimit)
      if (quota) {
        return NextResponse.json({ error: quota, code: 'CRAWL_QUOTA' }, { status: 429 })
      }
      const pageQuota = await crawlPageQuotaForUser({
        userId: user.id,
        email: user.email,
      })
      // Plan page cap is authoritative; optional body.maxUrls may only lower it (tests).
      const maxUrls =
        typeof body.maxUrls === 'number' && body.maxUrls > 0
          ? Math.min(body.maxUrls, pageQuota.maxPages)
          : pageQuota.maxPages
      const { runId, urlsDiscovered, urlsFound } = await startCrawlRun({
        siteId: null,
        userId: user.id,
        origin,
        detectOnly: true,
        store,
        maxUrls,
        planPageLimit: { planLabel: pageQuota.planLabel },
      })
      recordCrawlStart(user.id)
      return NextResponse.json({
        runId,
        urlsDiscovered,
        urlsFound,
        pageLimit: pageQuota.maxPages,
        planLabel: pageQuota.planLabel,
        chunkSize: CRAWL_URL_CHUNK_SIZE,
        status: 'queued',
        origin,
        detectOnly: true,
      })
    }

    if (body.action === 'tick') {
      if (!body.runId) {
        return NextResponse.json(
          { error: 'runId is required for tick' },
          { status: 400 },
        )
      }
      const run = await store.getRun(body.runId)
      if (
        !run ||
        run.userId !== user.id ||
        !run.detectOnly
      ) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      }
      const tick = await processCrawlTick(body.runId, { store })
      return NextResponse.json({ ...tick, detectOnly: true, origin: run.origin })
    }

    return NextResponse.json(
      { error: "action must be 'start' or 'tick'" },
      { status: 400 },
    )
  }

  const siteId = body.siteId
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
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

  const origin = `https://${String(site.domain).replace(/^www\./, '')}`

  if (body.action === 'start') {
    const dailyLimit = await crawlDailyLimitForUser({
      userId: user.id,
      email: user.email,
    })
    const quota = assertCrawlStartAllowed(user.id, dailyLimit)
    if (quota) {
      return NextResponse.json({ error: quota, code: 'CRAWL_QUOTA' }, { status: 429 })
    }
    const pageQuota = await crawlPageQuotaForUser({
      userId: user.id,
      email: user.email,
    })
    const maxUrls =
      typeof body.maxUrls === 'number' && body.maxUrls > 0
        ? Math.min(body.maxUrls, pageQuota.maxPages)
        : pageQuota.maxPages
    const { runId, urlsDiscovered, urlsFound } = await startCrawlRun({
      siteId,
      userId: user.id,
      origin,
      store,
      maxUrls,
      planPageLimit: { planLabel: pageQuota.planLabel },
    })
    recordCrawlStart(user.id)
    return NextResponse.json({
      runId,
      urlsDiscovered,
      urlsFound,
      pageLimit: pageQuota.maxPages,
      planLabel: pageQuota.planLabel,
      chunkSize: CRAWL_URL_CHUNK_SIZE,
      status: 'queued',
      origin,
      detectOnly: false,
    })
  }

  if (body.action === 'tick') {
    if (!body.runId) {
      return NextResponse.json({ error: 'runId is required for tick' }, { status: 400 })
    }
    const run = await store.getRun(body.runId)
    if (!run || run.userId !== user.id || run.siteId !== siteId) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
    const tick = await processCrawlTick(body.runId, { store })
    return NextResponse.json(tick)
  }

  return NextResponse.json(
    { error: "action must be 'start' or 'tick'" },
    { status: 400 },
  )
}

/**
 * GET /api/fix-strategies/findings/crawl?siteId=&runId=
 * Detect-only: ?detectOrigin=&runId=
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
  const runId = url.searchParams.get('runId')
  const store = getFindingsStore()

  if (detectOriginRaw || (runId && !siteId)) {
    if (runId) {
      const run = await store.getRun(runId)
      if (!run || run.userId !== user.id || !run.detectOnly) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      }
      return NextResponse.json({
        run,
        chunkSize: CRAWL_URL_CHUNK_SIZE,
        detectOnly: true,
      })
    }
    const origin = normalizePublicOrigin(detectOriginRaw ?? '')
    if (!origin) {
      return NextResponse.json(
        { error: 'detectOrigin is required' },
        { status: 400 },
      )
    }
    const runs = await store.listRunsForDetectOrigin(user.id, origin)
    return NextResponse.json({
      run: runs[0] ?? null,
      runs: runs.slice(0, 10),
      chunkSize: CRAWL_URL_CHUNK_SIZE,
      detectOnly: true,
      origin,
    })
  }

  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }

  const { data: site } = await supabase
    .from('connected_sites')
    .select('id')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  if (runId) {
    const run = await store.getRun(runId)
    if (!run || run.userId !== user.id || run.siteId !== siteId) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
    return NextResponse.json({ run, chunkSize: CRAWL_URL_CHUNK_SIZE })
  }

  const runs = await store.listRunsForSite(siteId)
  const latest = runs[0] ?? null
  return NextResponse.json({
    run: latest,
    runs: runs.slice(0, 10),
    chunkSize: CRAWL_URL_CHUNK_SIZE,
  })
}
