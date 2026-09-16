/**
 * Live postcondition verifiers for topics 4–7.
 * Never import the fixer.
 */

import {
  recordRedirectHops,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'

export type LiveRedirectVerification = {
  ok: boolean
  detail: string
}

/** Topic 4: origin returns a single 3xx whose Location returns 200 in one hop. */
export async function verifyLiveChainCollapsed(
  originUrl: string,
  deps: HopRecordingDeps,
): Promise<LiveRedirectVerification> {
  const chain = await recordRedirectHops(originUrl, deps)
  const redirectHops = chain.hops.filter(
    (h) => h.status >= 300 && h.status < 400,
  )
  if (redirectHops.length !== 1) {
    return {
      ok: false,
      detail: `expected exactly 1 redirect hop, found ${redirectHops.length}`,
    }
  }
  if (chain.finalStatus !== 200 || chain.stoppedReason !== 'non-3xx') {
    return {
      ok: false,
      detail: `final status ${chain.finalStatus} (${chain.stoppedReason})`,
    }
  }
  return {
    ok: true,
    detail: 'origin has single 3xx; Location target returns 200 in one hop',
  }
}

/** Topic 5/7: origin resolves to 200 within one hop, or honest non-redirect status. */
export async function verifyLiveOriginResolvesCleanly(
  originUrl: string,
  deps: HopRecordingDeps,
  opts?: { allowDirectNon200?: boolean },
): Promise<LiveRedirectVerification> {
  const chain = await recordRedirectHops(originUrl, deps)
  if (chain.stoppedReason === 'repeat-url') {
    return { ok: false, detail: 'still loops' }
  }
  if (chain.stoppedReason === 'missing-location') {
    return { ok: false, detail: '3xx still missing Location' }
  }
  const redirectHops = chain.hops.filter(
    (h) => h.status >= 300 && h.status < 400,
  )
  if (redirectHops.length === 0) {
    if (chain.finalStatus === 200) {
      return { ok: true, detail: 'origin returns 200 directly' }
    }
    if (opts?.allowDirectNon200) {
      return {
        ok: true,
        detail: `origin returns honest ${chain.finalStatus} with no redirect`,
      }
    }
    return {
      ok: false,
      detail: `origin status ${chain.finalStatus} without redirect`,
    }
  }
  if (redirectHops.length === 1 && chain.finalStatus === 200) {
    return {
      ok: true,
      detail: 'origin resolves to 200 in one hop',
    }
  }
  return {
    ok: false,
    detail: `${redirectHops.length} hops, final ${chain.finalStatus}`,
  }
}

/** Topic 6: origin returns 301 or 308. */
export async function verifyLivePermanentRedirect(
  originUrl: string,
  deps: HopRecordingDeps,
): Promise<LiveRedirectVerification> {
  const chain = await recordRedirectHops(originUrl, deps, {
    maxHops: 1,
    readFinalBody: false,
  })
  const first = chain.hops[0]
  if (!first || (first.status !== 301 && first.status !== 308)) {
    return {
      ok: false,
      detail: `expected 301/308, got ${first?.status ?? 'none'}`,
    }
  }
  return {
    ok: true,
    detail: `origin returns ${first.status}`,
  }
}
