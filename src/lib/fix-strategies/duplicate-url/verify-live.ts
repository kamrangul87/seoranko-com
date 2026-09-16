/**
 * Live postcondition verifier for duplicate-URL fixes.
 * Never imports the fixer.
 *
 * Preferred form returns 200 in one hop with self-referential canonical;
 * non-preferred returns 301/308 to preferred — OR (12a canonical branch)
 * parameterised URL carries canonical to clean URL.
 */

import {
  extractCanonicalDeclarations,
  isSelfCanonical,
  recordRedirectHops,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'

export type LiveDuplicateUrlVerification = {
  ok: boolean
  detail: string
}

export async function verifyLiveDuplicateNormalized(
  preferredUrl: string,
  nonPreferredUrl: string,
  deps: HopRecordingDeps,
  opts?: {
    /** 12a: accept canonical annotation instead of redirect. */
    allowCanonicalBranch?: boolean
  },
): Promise<LiveDuplicateUrlVerification> {
  // Preferred: 200, zero redirects
  const pref = await recordRedirectHops(preferredUrl, deps)
  if (pref.hops.some((h) => h.status >= 300 && h.status < 400)) {
    return {
      ok: false,
      detail: `preferred form still redirects (${pref.hops[0]?.status})`,
    }
  }
  if (pref.finalStatus !== 200) {
    return {
      ok: false,
      detail: `preferred form status ${pref.finalStatus}`,
    }
  }

  const extracted = extractCanonicalDeclarations(
    pref.finalBody,
    pref.finalHeaders,
    preferredUrl,
    pref.finalHeaders.get('content-type'),
  )
  const canon =
    extracted.effectiveHead?.normalized ??
    (extracted.header.length === 1 ? extracted.header[0]!.normalized : null)
  if (!isSelfCanonical(preferredUrl, canon)) {
    return {
      ok: false,
      detail: 'preferred form lacks self-referential canonical',
    }
  }

  // Non-preferred: redirect to preferred, OR canonical branch
  const non = await recordRedirectHops(nonPreferredUrl, deps, {
    maxHops: 1,
    readFinalBody: true,
  })

  const redirected =
    non.hops.length > 0 &&
    non.hops[0]!.status >= 300 &&
    non.hops[0]!.status < 400 &&
    non.hops[0]!.location != null

  if (redirected) {
    try {
      const dest = new URL(non.hops[0]!.location!, nonPreferredUrl)
      const prefU = new URL(preferredUrl)
      if (
        dest.protocol === prefU.protocol &&
        dest.host === prefU.host &&
        dest.pathname === prefU.pathname &&
        dest.search === prefU.search
      ) {
        return {
          ok: true,
          detail:
            'non-preferred redirects to preferred; preferred is 200 self-canonical',
        }
      }
    } catch {
      // fall through
    }
    return {
      ok: false,
      detail: 'non-preferred redirects but not to preferred form',
    }
  }

  if (opts?.allowCanonicalBranch) {
    const nonExtracted = extractCanonicalDeclarations(
      non.finalBody,
      non.finalHeaders,
      nonPreferredUrl,
      non.finalHeaders.get('content-type'),
    )
    const nonCanon =
      nonExtracted.effectiveHead?.normalized ??
      (nonExtracted.header[0]?.normalized ?? null)
    if (nonCanon === new URL(preferredUrl).href.replace(/\/$/, '') ||
        nonCanon === preferredUrl ||
        (nonCanon != null &&
          nonCanon.replace(/\/$/, '') === preferredUrl.replace(/\/$/, ''))) {
      return {
        ok: true,
        detail:
          '12a canonical branch: parameterised URL canonicalises to clean preferred',
      }
    }
    return {
      ok: false,
      detail: 'canonical branch: parameterised URL missing canonical to clean URL',
    }
  }

  return {
    ok: false,
    detail: 'non-preferred neither redirects nor canonicalises to preferred',
  }
}
