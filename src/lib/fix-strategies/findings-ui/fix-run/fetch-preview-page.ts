/**
 * Fetch a customer preview (or any) page for fix-run verify.
 * Never throws on redirect loops / network errors — returns ok:false.
 * Caps redirects (Vercel SSO can 307-loop when bypass is wrong or stripped).
 */

export type FetchPreviewPageResult = {
  ok: boolean
  body: string
  status: number
}

const MAX_REDIRECTS = 5

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

function isAuthWallBody(body: string, ok: boolean): boolean {
  return (
    ok &&
    body.length < 50_000 &&
    /Authentication Required|vercel\.com\/sso-api|\/_vercel\//i.test(body)
  )
}

export async function fetchPreviewPage(
  url: string,
  opts?: {
    bypass?: string | null
    fetchImpl?: typeof fetch
    timeoutMs?: number
    maxRedirects?: number
  },
): Promise<FetchPreviewPageResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const bypass = opts?.bypass?.trim() || ''
  const timeoutMs = opts?.timeoutMs ?? 20_000
  const maxRedirects = opts?.maxRedirects ?? MAX_REDIRECTS

  const headers: Record<string, string> = {
    'User-Agent': 'SEORANKO-FixRun/1.0',
  }
  let fetchUrl = url
  if (bypass && /\.vercel\.app(?::|\/|$)/i.test(url)) {
    headers['x-vercel-protection-bypass'] = bypass
    headers['x-vercel-set-bypass-cookie'] = 'true'
    fetchUrl = withBypassQuery(url, bypass)
  }

  try {
    let current = fetchUrl
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetchImpl(current, {
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        redirect: 'manual',
      })

      const status = res.status
      if (status >= 300 && status < 400) {
        const loc = res.headers.get('location')
        if (!loc) {
          return { ok: false, body: '', status }
        }
        if (hop === maxRedirects) {
          return { ok: false, body: '', status: 310 }
        }
        let nextUrl: string
        try {
          nextUrl = new URL(loc, current).toString()
        } catch {
          return { ok: false, body: '', status }
        }
        // Keep bypass on vercel.app hops so SSO does not strip it.
        if (bypass && /\.vercel\.app(?::|\/|$)/i.test(nextUrl)) {
          nextUrl = withBypassQuery(nextUrl, bypass)
        }
        current = nextUrl
        continue
      }

      const body = await res.text()
      const authWall = isAuthWallBody(body, res.ok)
      return {
        ok: res.ok && !authWall,
        body,
        status: authWall ? 401 : res.status,
      }
    }
    return { ok: false, body: '', status: 310 }
  } catch {
    // redirect count exceeded / network / timeout — fail soft
    return { ok: false, body: '', status: 0 }
  }
}
