/**
 * Fix-run / verifier page fetch: never uses redirect:'follow' (undici throws
 * TypeError "redirect count exceeded" on loops — Sentry on /api/cron/fix-site
 * after autodun-ai #60 preview: /privacy ↔ /privacy/).
 *
 * Uses recordRedirectHops (redirect:'manual', max 10, visited-set loop detect).
 * Always returns a result — never throws.
 */

import {
  recordRedirectHops,
  type HopRecordingResult,
} from '@/lib/fix-strategies/shared/hop-recording-fetch'

export type RedirectFailureKind =
  | 'redirect-loop'
  | 'max-hops'
  | 'missing-location'
  | 'transport'

export type FetchPageResult = {
  ok: boolean
  body: string
  status: number
  /** Final response headers when a non-redirect terminal was reached. */
  headers?: Headers
  redirectFailure?: {
    kind: RedirectFailureKind
    /** Full hop chain (URLs in visit order, including the cycle close). */
    chain: string[]
    detail: string
  }
}

const MAX_HOPS = 10

function withBypassQuery(url: string, bypass: string): string {
  try {
    const u = new URL(url)
    if (!u.searchParams.has('x-vercel-protection-bypass')) {
      u.searchParams.set('x-vercel-protection-bypass', bypass)
    }
    return u.toString()
  } catch {
    return url
  }
}

function isAuthWallBody(body: string, okHttp: boolean): boolean {
  return (
    okHttp &&
    body.length < 50_000 &&
    /Authentication Required|vercel\.com\/sso-api|\/_vercel\//i.test(body)
  )
}

function chainFromHops(result: HopRecordingResult): string[] {
  if (result.visitedNormalized.length > 0) {
    return [...result.visitedNormalized]
  }
  return result.hops.map((h) => h.url)
}

function failureFromHops(
  result: HopRecordingResult,
): FetchPageResult['redirectFailure'] | undefined {
  const chain = chainFromHops(result)
  if (result.stoppedReason === 'repeat-url') {
    return {
      kind: 'redirect-loop',
      chain,
      detail: `Redirect loop: ${chain.join(' → ')}`,
    }
  }
  if (result.stoppedReason === 'max-hops') {
    return {
      kind: 'max-hops',
      chain,
      detail: `Redirect chain exceeded ${MAX_HOPS} hops: ${chain.join(' → ')}`,
    }
  }
  if (result.stoppedReason === 'missing-location') {
    return {
      kind: 'missing-location',
      chain,
      detail: `Redirect missing Location at ${result.finalUrl}`,
    }
  }
  if (result.stoppedReason === 'transport-error') {
    return {
      kind: 'transport',
      chain,
      detail: `Transport error fetching ${result.finalUrl}${
        result.transportError?.message
          ? `: ${result.transportError.message}`
          : ''
      }`,
    }
  }
  return undefined
}

/**
 * Fetch a page for fix-run preview/production verify.
 * Caps redirects at 10; detects URL-seen-twice loops; never throws.
 */
export async function fetchPreviewPage(
  url: string,
  opts?: {
    bypass?: string | null
    fetchImpl?: typeof fetch
    timeoutMs?: number
    maxHops?: number
  },
): Promise<FetchPageResult> {
  const bypass = opts?.bypass?.trim() || ''
  const timeoutMs = opts?.timeoutMs ?? 20_000
  const maxHops = opts?.maxHops ?? MAX_HOPS
  const baseFetch = opts?.fetchImpl ?? fetch

  let fetchUrl = url
  const headers: Record<string, string> = {
    'User-Agent': 'SEORANKO-FixRun/1.0',
  }
  if (bypass && /\.vercel\.app(?::|\/|$)/i.test(url)) {
    headers['x-vercel-protection-bypass'] = bypass
    headers['x-vercel-set-bypass-cookie'] = 'true'
    fetchUrl = withBypassQuery(url, bypass)
  }

  const wrappedFetch: typeof fetch = async (input, init) => {
    let target = String(input)
    if (bypass && /\.vercel\.app(?::|\/|$)/i.test(target)) {
      target = withBypassQuery(target, bypass)
    }
    const nextHeaders = new Headers(init?.headers)
    for (const [k, v] of Object.entries(headers)) {
      if (!nextHeaders.has(k)) nextHeaders.set(k, v)
    }
    return baseFetch(target, {
      ...init,
      headers: nextHeaders,
      redirect: 'manual',
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    })
  }

  try {
    const hops = await recordRedirectHops(
      fetchUrl,
      { fetch: wrappedFetch },
      { maxHops, readFinalBody: true },
    )

    const redirectFailure = failureFromHops(hops)
    if (redirectFailure) {
      return {
        ok: false,
        body: '',
        status: 0,
        redirectFailure,
      }
    }

    const okHttp =
      hops.finalStatus >= 200 && hops.finalStatus < 400
    const body = hops.finalBody
    const authWall = isAuthWallBody(body, okHttp)
    return {
      ok: okHttp && !authWall,
      body,
      status: authWall ? 401 : hops.finalStatus,
      headers: hops.finalHeaders,
    }
  } catch (err) {
    // Belt-and-braces: recordRedirectHops should not throw, but never crash cron.
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      body: '',
      status: 0,
      redirectFailure: {
        kind: 'transport',
        chain: [url],
        detail: `Fetch failed (no throw to caller): ${message}`,
      },
    }
  }
}
