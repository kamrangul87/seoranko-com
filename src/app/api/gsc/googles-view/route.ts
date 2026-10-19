import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseSsrClient } from '@/lib/supabase/ssr-client'
import { createSupabaseJsClient } from '@/lib/supabase/js-client'
import {
  buildGooglesView,
  collectLiveEvidenceForInspections,
  googlesViewProblemFindings,
  isExplainedNotIndexedReason,
} from '@/lib/gsc/googles-view'
import { normalizeUrl } from '@/lib/supabase/audit-db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function serviceClient() {
  return createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function requireUser() {
  const cookieStore = cookies()
  const authClient = createSupabaseSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const {
    data: { user },
  } = await authClient.auth.getUser()
  return user
}

/**
 * GET ?siteId= — Google's view table for Index Diagnosis.
 * Pulls latest GSC inspection coverage states, live-fetches redirect
 * chains / statuses, classifies EXPECTED vs PROBLEM.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('siteId') || ''
    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
    }

    const supabase = serviceClient()
    const { data: site } = await supabase
      .from('connected_sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: conn } = await supabase
      .from('gsc_connections')
      .select('id, status, property_url')
      .eq('site_id', siteId)
      .maybeSingle()

    if (!conn || conn.status !== 'active') {
      return NextResponse.json({
        ok: true,
        connected: false,
        table: null,
        problemFindings: [],
        framing:
          'Connect Google Search Console to see Google\'s view of not-indexed reasons.',
      })
    }

    const { data: rows } = await supabase
      .from('gsc_url_inspections')
      .select(
        'url, coverage_state, google_canonical, user_canonical, inspected_at, status, raw_result',
      )
      .eq('site_id', siteId)
      .eq('status', 'succeeded')
      .order('inspected_at', { ascending: false })
      .limit(2000)

    const latestByUrl = new Map<
      string,
      {
        url: string
        coverageState: string | null
        googleCanonical: string | null
        userCanonical: string | null
        gscValidationPassed?: boolean
      }
    >()
    for (const row of rows || []) {
      let key = row.url
      try {
        key = normalizeUrl(row.url)
      } catch {
        /* keep */
      }
      if (latestByUrl.has(key)) continue
      const raw = row.raw_result as Record<string, unknown> | null
      const validationPassed = extractValidationPassed(raw)
      latestByUrl.set(key, {
        url: row.url,
        coverageState: row.coverage_state ?? null,
        googleCanonical: row.google_canonical ?? null,
        userCanonical: row.user_canonical ?? null,
        gscValidationPassed: validationPassed,
      })
    }

    const inspections = Array.from(latestByUrl.values()).filter((r) =>
      isExplainedNotIndexedReason(r.coverageState),
    )

    // Sitemap + inbound link sets from latest index diagnosis run for this domain
    const domainRaw = String(site.domain || '').toLowerCase()
    const domainBare = domainRaw.replace(/^www\./i, '')

    // Host-variant probes: GSC often lists http/www forms under "Page with
    // redirect" before URL Inspection has covered them. Probe a small set so
    // Index Diagnosis can still explain healthy host/scheme redirects.
    const already = new Set(inspections.map((i) => i.url))
    const hostVariantSeeds = [
      `http://${domainBare}/`,
      `http://www.${domainBare}/`,
      `https://www.${domainBare}/`,
      `http://${domainBare}`,
      `https://${domainBare}/`,
    ]
    for (const seed of hostVariantSeeds) {
      if (already.has(seed)) continue
      // Only add as page_with_redirect candidates; live collector drops non-redirects.
      inspections.push({
        url: seed,
        coverageState: 'Page with redirect',
        googleCanonical: null,
        userCanonical: null,
      })
      already.add(seed)
    }
    const { data: diagnosisRun } = await supabase
      .from('index_diagnosis_runs')
      .select('coverage, pages')
      .in('domain', [domainBare, `www.${domainBare}`, domainRaw])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const sitemapUrls = new Set<string>()
    const linkedInternallyUrls = new Set<string>()
    const diagnosisCausesByUrl = new Map<
      string,
      { url: string; causes: string[] }
    >()

    const coverage = diagnosisRun?.coverage as {
      sitemapDiscoveredUrls?: string[]
      sitemapOnlyUrls?: string[]
    } | null
    if (coverage) {
      for (const u of coverage.sitemapDiscoveredUrls || []) sitemapUrls.add(u)
      for (const u of coverage.sitemapOnlyUrls || []) sitemapUrls.add(u)
    }
    // www twin of apex sitemap URLs often appear in GSC as Page with redirect
    for (const u of Array.from(sitemapUrls)) {
      try {
        const parsed = new URL(u)
        if (parsed.hostname.replace(/^www\./i, '') !== domainBare) continue
        if (parsed.hostname.startsWith('www.')) continue
        parsed.hostname = `www.${domainBare}`
        const wwwUrl = parsed.toString()
        if (already.has(wwwUrl)) continue
        inspections.push({
          url: wwwUrl,
          coverageState: 'Page with redirect',
          googleCanonical: null,
          userCanonical: null,
        })
        already.add(wwwUrl)
      } catch {
        /* skip */
      }
    }

    const pages = (diagnosisRun?.pages || []) as Array<{
      url: string
      crawlDepth?: number
      internalLinksIn?: number
      duplicateClusterSize?: number
      decisiveEvidence?: string
      inboundLinks?: unknown[]
    }>
    for (const p of pages) {
      if (p.inboundLinks && p.inboundLinks.length > 0) {
        linkedInternallyUrls.add(p.url)
      }
      const causes: string[] = []
      if (typeof p.crawlDepth === 'number') causes.push(`depth=${p.crawlDepth}`)
      if (typeof p.internalLinksIn === 'number') {
        causes.push(`inbound_links=${p.internalLinksIn}`)
      }
      if (p.duplicateClusterSize && p.duplicateClusterSize > 1) {
        causes.push(`duplicate_cluster_size=${p.duplicateClusterSize}`)
      }
      if (p.decisiveEvidence) causes.push(p.decisiveEvidence)
      if (causes.length) {
        diagnosisCausesByUrl.set(p.url, { url: p.url, causes })
      }
    }

    // Live evidence (bounded — only explained not-indexed URLs)
    const liveByUrl = await collectLiveEvidenceForInspections(
      inspections,
      { fetch },
    )

    // Drop host-variant probes that did not actually redirect (live 200, 0 hops).
    const gscRedirectUrls = new Set(
      Array.from(latestByUrl.values())
        .filter((r) => /page with redirect/i.test(r.coverageState || ''))
        .map((r) => r.url),
    )
    const inspectionsFinal = inspections.filter((row) => {
      if (row.coverageState !== 'Page with redirect') return true
      if (gscRedirectUrls.has(row.url)) return true
      const hops = liveByUrl.get(row.url)?.redirectChain?.hops?.length ?? 0
      return hops > 0
    })

    const table = buildGooglesView({
      siteId,
      inspections: inspectionsFinal,
      liveByUrl,
      sitemapUrls,
      linkedInternallyUrls,
      diagnosisCausesByUrl,
    })

    const problemFindings = googlesViewProblemFindings(table)

    return NextResponse.json({
      ok: true,
      connected: true,
      propertyUrl: conn.property_url,
      domain: site.domain,
      table,
      problemFindings,
      inspectionCount: inspections.length,
    })
  } catch (err) {
    console.error(
      '[gsc/googles-view GET]',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(
      { error: 'Could not build Google\'s view' },
      { status: 500 },
    )
  }
}

function extractValidationPassed(
  raw: Record<string, unknown> | null | undefined,
): boolean {
  if (!raw || typeof raw !== 'object') return false
  const blob = JSON.stringify(raw).toLowerCase()
  return (
    blob.includes('"validationresult":"pass"') ||
    blob.includes('"validation_state":"pass"') ||
    blob.includes('validation passed') ||
    (/"verdict"\s*:\s*"pass"/.test(blob) && blob.includes('validat'))
  )
}
