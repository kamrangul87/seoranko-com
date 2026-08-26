/**
 * Pre-save reachability check for Link Registry entries.
 * Browser cannot reliably HEAD third-party origins (CORS) — this runs server-side.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  applyKnownRegistryUrlCorrection,
  checkUrlReachable,
  correctKnownRegistryUrl,
} from '@/lib/registry-url-health'

export async function POST(req: NextRequest) {
  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = (body.url || '').trim()
  if (!raw) {
    return NextResponse.json({ error: 'url required' }, { status: 400 })
  }

  const correction = correctKnownRegistryUrl(raw)
  const effectiveUrl = applyKnownRegistryUrlCorrection(raw)
  const reach = await checkUrlReachable(effectiveUrl)

  return NextResponse.json({
    url: raw,
    effectiveUrl,
    correction: correction
      ? { from: correction.from, to: correction.to, reason: correction.reason }
      : null,
    ok: reach.ok,
    detail: reach.detail,
    suggestion: !reach.ok && !correction
      ? 'This URL does not resolve. Add the live page URL, or leave it out until the page exists (e.g. a future /running-costs guide).'
      : undefined,
  })
}
