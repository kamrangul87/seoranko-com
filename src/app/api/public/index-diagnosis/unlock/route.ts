import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { clientIpFromHeaders, hashIp } from '@/lib/public-index-diagnosis/validate-domain'

export const dynamic = 'force-dynamic'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * POST { scanId, email } — store email on the scan and return full URL evidence table.
 * No email is sent.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const scanId = typeof body.scanId === 'string' ? body.scanId.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''

    if (!scanId) {
      return NextResponse.json({ ok: false, message: 'scanId is required' }, { status: 400 })
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, message: 'Enter a valid email address to unlock the full URL table.' },
        { status: 400 },
      )
    }

    const ipHash = hashIp(clientIpFromHeaders(req.headers))
    const supabase = serviceClient()

    const { data: row, error } = await supabase
      .from('public_scans')
      .select('id, ip_hash, evidence, email, urls_discovered, urls_fetched, verdict_summary, domain')
      .eq('id', scanId)
      .maybeSingle()

    if (error || !row) {
      return NextResponse.json({ ok: false, message: 'Scan not found.' }, { status: 404 })
    }
    if (row.ip_hash !== ipHash) {
      return NextResponse.json(
        { ok: false, message: 'This scan belongs to a different network session.' },
        { status: 403 },
      )
    }

    if (!row.email) {
      const { error: upErr } = await supabase
        .from('public_scans')
        .update({ email })
        .eq('id', scanId)
      if (upErr) {
        console.warn('[public/index-diagnosis/unlock] email update failed', upErr.message)
      }
    }

    const evidence = (row.evidence || {}) as { urls?: unknown[] }
    const urls = Array.isArray(evidence.urls) ? evidence.urls : []

    return NextResponse.json({
      ok: true,
      scanId,
      domain: row.domain,
      urlsUnlocked: true,
      urlCount: urls.length,
      urls,
      verdictSummary: row.verdict_summary,
    })
  } catch (err) {
    console.error('[public/index-diagnosis/unlock]', err)
    return NextResponse.json({ ok: false, message: 'Could not unlock report.' }, { status: 500 })
  }
}
