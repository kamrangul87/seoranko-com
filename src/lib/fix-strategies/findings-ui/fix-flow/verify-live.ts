/**
 * Live verify after deploy — calls each topic's registry verifier against
 * the served response. Never stub-passes.
 */

import type { PersistedFindingRow } from '../crawl/constants'
import { verifyRegisteredTransform } from '../fix-run/apply-registry'

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
  /** Optional finding row for registry verifiers that need evidence. */
  finding?: Pick<
    PersistedFindingRow,
    'id' | 'topicId' | 'verdict' | 'pageUrl' | 'evidenceValues' | 'kind'
  >
  verdict?: string
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
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        verifiedUrl: liveUrl,
        detail:
          'Your preview is protected by a login; turn off Vercel Authentication for previews',
      }
    }
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

  const verdict = input.finding?.verdict ?? input.verdict ?? ''
  const finding = (input.finding ?? {
    id: 'live-verify',
    topicId: input.topicId,
    verdict,
    pageUrl: liveUrl,
    evidenceValues: null,
    kind: `topic/${input.topicId}`,
  }) as PersistedFindingRow

  if (!verdict && !input.finding) {
    // Backward-compatible topic-49-only path used by commitFix tests.
    if (input.topicId === '49') {
      const stub = {
        ...finding,
        verdict: 'auto-set-dimensions',
      } as PersistedFindingRow
      const v = await verifyRegisteredTransform({
        finding: stub,
        body: html,
        liveUrl,
        stage: 'production',
        fetchImpl,
        responseHeaders: res.headers,
      })
      return { ok: v.ok, verifiedUrl: liveUrl, detail: v.detail }
    }
    return {
      ok: false,
      verifiedUrl: liveUrl,
      detail: `No live verifier wired for topic ${input.topicId}`,
    }
  }

  const v = await verifyRegisteredTransform({
    finding,
    body: html,
    liveUrl,
    stage: 'production',
    fetchImpl,
    responseHeaders: res.headers,
  })
  return { ok: v.ok, verifiedUrl: liveUrl, detail: v.detail }
}
