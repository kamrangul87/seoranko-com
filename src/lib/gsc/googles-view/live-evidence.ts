/**
 * Live fetches for Google's view — redirect chains without following
 * (via hop recorder) and single-URL status for 404 / canonical targets.
 */

import {
  extractHtmlCanonical,
  isSelfCanonical,
  recordRedirectHops,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'
import type { LiveUrlEvidence } from './build'
import type { RedirectChainEvidence } from './types'

export async function recordRedirectChainEvidence(
  url: string,
  deps: HopRecordingDeps,
): Promise<RedirectChainEvidence> {
  const raw = await recordRedirectHops(url, deps, {
    maxHops: 10,
    readFinalBody: true,
  })
  const redirectHops = raw.hops.filter((h) => h.status >= 300 && h.status < 400)
  const canonical = raw.finalBody
    ? extractHtmlCanonical(
        raw.finalBody,
        raw.finalUrl,
        raw.finalHeaders.get('content-type') || 'text/html',
      )
    : null
  const selfCanonical =
    raw.finalStatus === 200
      ? isSelfCanonical(raw.finalUrl, canonical)
      : true

  return {
    hops: redirectHops.map((h) => ({
      url: h.url,
      status: h.status,
      location: h.location,
    })),
    finalUrl: raw.finalUrl,
    finalStatus: raw.finalStatus,
    finalSelfCanonical: selfCanonical,
  }
}

export async function fetchLiveStatus(
  url: string,
  deps: HopRecordingDeps,
): Promise<{ status: number; selfCanonical: boolean; finalUrl: string }> {
  const chain = await recordRedirectHops(url, deps, {
    maxHops: 5,
    readFinalBody: true,
  })
  const canonical = chain.finalBody
    ? extractHtmlCanonical(
        chain.finalBody,
        chain.finalUrl,
        chain.finalHeaders.get('content-type') || 'text/html',
      )
    : null
  return {
    status: chain.finalStatus,
    finalUrl: chain.finalUrl,
    selfCanonical: isSelfCanonical(chain.finalUrl, canonical),
  }
}

export async function collectLiveEvidenceForInspections(
  inspections: Array<{
    url: string
    coverageState: string | null
    googleCanonical?: string | null
    userCanonical?: string | null
  }>,
  deps: HopRecordingDeps,
): Promise<Map<string, LiveUrlEvidence>> {
  const { coverageStateToReasonKind } = await import('./reason-kind')
  const out = new Map<string, LiveUrlEvidence>()

  for (const row of inspections) {
    const kind = coverageStateToReasonKind(row.coverageState)
    if (kind === 'page_with_redirect') {
      try {
        const redirectChain = await recordRedirectChainEvidence(row.url, deps)
        out.set(row.url, { redirectChain })
      } catch {
        out.set(row.url, {})
      }
      continue
    }
    if (kind === 'not_found_404') {
      try {
        const live = await fetchLiveStatus(row.url, deps)
        out.set(row.url, { liveStatus: live.status })
      } catch {
        out.set(row.url, { liveStatus: null })
      }
      continue
    }
    if (kind === 'alternate_canonical') {
      const target = row.googleCanonical || row.userCanonical
      if (!target) {
        out.set(row.url, { liveStatus: null, targetSelfCanonical: false })
        continue
      }
      try {
        const live = await fetchLiveStatus(target, deps)
        out.set(row.url, {
          liveStatus: live.status,
          canonicalTargetUrl: target,
          targetSelfCanonical: live.selfCanonical,
        })
      } catch {
        out.set(row.url, {
          liveStatus: null,
          canonicalTargetUrl: target,
          targetSelfCanonical: false,
        })
      }
    }
  }

  return out
}
