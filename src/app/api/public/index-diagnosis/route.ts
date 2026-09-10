import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  clientIpFromHeaders,
  hashIp,
  validatePublicDomainInput,
} from '@/lib/public-index-diagnosis/validate-domain'
import { runPublicIndexDiagnosis } from '@/lib/public-index-diagnosis/run-public'
import {
  PUBLIC_SCAN_RATE_LIMIT_PER_HOUR,
  countScansLastHour,
  releaseScanLock,
  tryAcquireScanLock,
} from '@/lib/public-index-diagnosis/rate-limit'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * POST { domain } — public Index Diagnosis (no auth).
 */
export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers)
  const ipHash = hashIp(ip)

  if (!tryAcquireScanLock(ipHash)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'busy',
        message: 'A scan is already running for your network. Wait for it to finish, then try again.',
      },
      { status: 429 },
    )
  }

  try {
    const recent = await countScansLastHour(ipHash)
    if (recent >= PUBLIC_SCAN_RATE_LIMIT_PER_HOUR) {
      return NextResponse.json(
        {
          ok: false,
          code: 'rate_limited',
          message: `Rate limit: ${PUBLIC_SCAN_RATE_LIMIT_PER_HOUR} scans per hour from your network. Try again later.`,
        },
        { status: 429 },
      )
    }

    const body = await req.json().catch(() => ({}))
    const domainRaw = typeof body.domain === 'string' ? body.domain : ''
    const validated = await validatePublicDomainInput(domainRaw)
    if (!validated.ok) {
      const code =
        validated.code === 'unresolvable'
          ? 'unreachable'
          : validated.code === 'private' || validated.code === 'ip_literal'
            ? 'invalid_domain'
            : 'invalid_domain'
      return NextResponse.json(
        { ok: false, code, message: validated.message },
        { status: 400 },
      )
    }

    const result = await runPublicIndexDiagnosis(validated.normalizedUrl)
    if (!result.ok) {
      const status = result.code === 'robots_blocks_all' ? 422 : 400
      return NextResponse.json(result, { status })
    }

    const verdictSummary = {
      topCauses: result.topCauses,
      indexableCount: result.indexableCount,
      problemCount: result.problemCount,
      partial: result.partial,
      terminationReason: result.terminationReason,
      urlsDiscovered: result.urlsDiscovered,
      urlsFetched: result.urlsFetched,
    }

    const evidencePayload = {
      ...result.evidence,
      urls: result.urls,
    }

    let scanId: string | null = null
    try {
      const { data, error } = await serviceClient()
        .from('public_scans')
        .insert({
          domain: result.domain,
          scanned_at: result.scannedAt,
          urls_discovered: result.urlsDiscovered,
          urls_fetched: result.urlsFetched,
          verdict_summary: verdictSummary,
          evidence: evidencePayload,
          email: null,
          ip_hash: ipHash,
        })
        .select('id')
        .maybeSingle()
      if (error) console.warn('[public/index-diagnosis] persist failed', error.message)
      else scanId = data?.id ?? null
    } catch (err) {
      console.warn('[public/index-diagnosis] persist error', err)
    }

    // Public response: top 3 always; full URL table gated until email capture
    return NextResponse.json({
      ok: true,
      scanId,
      domain: result.domain,
      scannedAt: result.scannedAt,
      urlsDiscovered: result.urlsDiscovered,
      urlsFetched: result.urlsFetched,
      partial: result.partial,
      terminationReason: result.terminationReason,
      terminationEvidence: result.terminationEvidence,
      topCauses: result.topCauses,
      indexableCount: result.indexableCount,
      problemCount: result.problemCount,
      urlCount: result.urls.length,
      siteTooLarge:
        Boolean((result.evidence as { siteTooLargeHint?: boolean }).siteTooLargeHint) ||
        result.urlsDiscovered >= 200,
      // Preview only — first 0 URLs until email unlock
      urlsUnlocked: false,
      urls: [] as unknown[],
    })
  } catch (err) {
    console.error('[public/index-diagnosis]', err)
    return NextResponse.json(
      {
        ok: false,
        code: 'scan_failed',
        message: 'Scan failed unexpectedly. Try again in a few minutes.',
      },
      { status: 500 },
    )
  } finally {
    releaseScanLock(ipHash)
  }
}
