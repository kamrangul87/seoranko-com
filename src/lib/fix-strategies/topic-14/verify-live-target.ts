/**
 * Topic 14 postcondition: live canonical target returns 200 in zero redirects.
 * Never imports the fixer.
 */

import {
  extractCanonicalDeclarations,
  recordRedirectHops,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'

export type LiveCanonicalTargetVerification = {
  ok: boolean
  detail: string
}

export async function verifyLiveCanonicalTarget200(
  liveBody: string,
  liveHeaders: Headers,
  pageUrl: string,
  contentType: string | null,
  deps: HopRecordingDeps,
): Promise<LiveCanonicalTargetVerification> {
  const extracted = extractCanonicalDeclarations(
    liveBody,
    liveHeaders,
    pageUrl,
    contentType,
  )

  const decl =
    extracted.effectiveHead ??
    (extracted.header.length === 1 ? extracted.header[0]! : null)

  if (!decl?.normalized) {
    return { ok: false, detail: 'no single canonical declaration to verify' }
  }

  const chain = await recordRedirectHops(decl.normalized, deps, {
    readFinalBody: false,
  })

  if (chain.hops.some((h) => h.status >= 300 && h.status < 400)) {
    return {
      ok: false,
      detail: `canonical target still redirects (${chain.hops[0]?.status})`,
    }
  }

  if (chain.finalStatus !== 200) {
    return {
      ok: false,
      detail: `canonical target status ${chain.finalStatus}`,
    }
  }

  return {
    ok: true,
    detail: 'canonical target returns 200 in zero redirects',
  }
}
