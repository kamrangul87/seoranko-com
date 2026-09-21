import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  CRAWL_URL_CHUNK_SIZE,
  getFindingsStore,
} from '@/lib/fix-strategies/findings-ui/crawl'
import { persistedToUiFinding } from '@/lib/fix-strategies/findings-ui/map-persisted'
import type { FindingsListResponse } from '@/lib/fix-strategies/findings-ui/types'

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
  const includeInformational = url.searchParams.get('informational') === '1'

  if (!siteId) {
    return NextResponse.json(
      { error: 'siteId is required' },
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

  const store = getFindingsStore()
  const runs = await store.listRunsForSite(siteId)
  const latest = runs[0] ?? null
  const rows = await store.listFindings({ siteId, includeInformational })
  const counts = await store.counts(siteId)

  const findings = []
  for (const row of rows) {
    const evidence = await store.listEvidenceForFinding(row.id)
    findings.push(persistedToUiFinding(row, evidence))
  }

  const origin = `https://${String(site.domain).replace(/^www\./, '')}`

  const body: FindingsListResponse = {
    origin,
    crawledAt: latest?.finishedAt ?? latest?.startedAt ?? null,
    demo: false,
    siteId,
    crawl: latest
      ? {
          runId: latest.id,
          status: latest.status,
          isPartial: latest.isPartial,
          coverageNotes: latest.coverageNotes,
          urlsDiscovered: latest.urlsDiscovered,
          urlsCrawled: latest.urlsCrawled,
          chunkSize: latest.chunkSize || CRAWL_URL_CHUNK_SIZE,
        }
      : null,
    counts,
    findings,
  }

  return NextResponse.json(body)
}
