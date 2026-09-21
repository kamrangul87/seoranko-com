import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  CRAWL_URL_CHUNK_SIZE,
  startCrawlRun,
  processCrawlTick,
  getFindingsStore,
} from '@/lib/fix-strategies/findings-ui/crawl'

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
 * Body: { siteId, action: 'start' | 'tick', runId? }
 *
 * Chunk size = CRAWL_URL_CHUNK_SIZE (5): each URL does stream-complete fetch +
 * topic-68 re-fetch + multi-detector work. Five URLs fit a ~45s tick under
 * Hobby maxDuration=60 with backoff headroom; remaining URLs resume via tick.
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
    action?: 'start' | 'tick'
    runId?: string
    maxUrls?: number
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
  const store = getFindingsStore()

  if (body.action === 'start') {
    const { runId, urlsDiscovered } = await startCrawlRun({
      siteId,
      userId: user.id,
      origin,
      store,
      maxUrls: body.maxUrls,
    })
    return NextResponse.json({
      runId,
      urlsDiscovered,
      chunkSize: CRAWL_URL_CHUNK_SIZE,
      status: 'queued',
      origin,
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
 * Returns latest (or specific) crawl run status for the UI.
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
  const runId = url.searchParams.get('runId')
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

  const store = getFindingsStore()
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
