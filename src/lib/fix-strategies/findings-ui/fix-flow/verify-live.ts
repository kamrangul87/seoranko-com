/**
 * Live verify after deploy — calls each topic's verify-live module against
 * the served HTML. Never stub-passes.
 */

import { verifyLiveImgDimensions } from '@/lib/fix-strategies/topic-49/verify-live-dimensions'

export type LiveVerifyResult = {
  ok: boolean
  detail: string
  verifiedUrl: string
}

export async function verifyFindingLive(input: {
  topicId: string
  /** URL to fetch (preview or production). */
  liveUrl: string
  fetchImpl?: typeof fetch
}): Promise<LiveVerifyResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const liveUrl = input.liveUrl

  let res: Response
  try {
    res = await fetchImpl(liveUrl, {
      headers: {
        'User-Agent': 'SEORANKO-Findings-Verifier/1.0',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    })
  } catch (e) {
    return {
      ok: false,
      verifiedUrl: liveUrl,
      detail: `Live fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      verifiedUrl: liveUrl,
      detail: `Live fetch HTTP ${res.status} for ${liveUrl}`,
    }
  }

  const html = await res.text()

  // Vercel Authentication / SSO interstitial — never treat as a successful
  // postcondition (empty img set / logo-only page would vacuous-pass).
  const looksLikeAuthWall =
    /vercel\.com\/sso-api|Authentication Required|\/_vercel\//i.test(html) &&
    !/mot-advisories-uk|<h1\b/i.test(html)
  if (looksLikeAuthWall) {
    return {
      ok: false,
      verifiedUrl: liveUrl,
      detail:
        'Live fetch returned a Vercel authentication interstitial, not page content — cannot verify postcondition',
    }
  }

  if (input.topicId === '49') {
    const v = await verifyLiveImgDimensions(html, liveUrl, fetchImpl)
    return {
      ok: v.ok,
      verifiedUrl: liveUrl,
      detail: v.ok
        ? `Topic 49 live verify OK: ${v.detail}`
        : `Topic 49 live verify FAILED: ${v.detail}; ${v.failures
            .slice(0, 5)
            .map((f) => `${f.src}: ${f.reason}`)
            .join('; ')}`,
    }
  }

  return {
    ok: false,
    verifiedUrl: liveUrl,
    detail: `No live verifier wired for topic ${input.topicId}`,
  }
}
