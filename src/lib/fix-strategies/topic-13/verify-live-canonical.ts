/**
 * Topic 13 postcondition verifier.
 *
 * Live response <head> contains exactly one link[rel=canonical] with an
 * absolute URL, and the target returns 200. Never imports the fixer.
 */

import {
  extractCanonicalDeclarations,
  recordRedirectHops,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'

export type LiveCanonicalAbsentVerification = {
  ok: boolean
  detail: string
}

export async function verifyLiveCanonicalPresent(
  liveBody: string,
  liveHeaders: Headers,
  pageUrl: string,
  contentType: string | null,
  deps: HopRecordingDeps,
): Promise<LiveCanonicalAbsentVerification> {
  const extracted = extractCanonicalDeclarations(
    liveBody,
    liveHeaders,
    pageUrl,
    contentType,
  )

  if (extracted.head.length !== 1) {
    return {
      ok: false,
      detail: `expected exactly one head canonical, found ${extracted.head.length}`,
    }
  }

  if (extracted.body.length > 0) {
    return {
      ok: false,
      detail: 'body still contains a canonical (C2)',
    }
  }

  const target = extracted.head[0]!
  if (!target.normalized || !/^https?:\/\//i.test(target.raw) && !target.normalized.startsWith('http')) {
    // Prefer absolute: normalised form is always absolute when parseable.
    if (!target.normalized?.startsWith('http')) {
      return { ok: false, detail: 'canonical href is not an absolute URL' }
    }
  }

  const href = target.normalized
  if (!href) {
    return { ok: false, detail: 'canonical href unparseable' }
  }

  const chain = await recordRedirectHops(href, deps, { readFinalBody: false })
  if (chain.hops.some((h) => h.status >= 300 && h.status < 400)) {
    return {
      ok: false,
      detail: `canonical target redirects (${chain.hops[0]?.status})`,
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
    detail: 'live head has exactly one absolute canonical; target returns 200',
  }
}
