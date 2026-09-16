/**
 * Topic 22 live verifier. Never imports the fixer.
 */

export type LiveRobotsTxtVerification = {
  ok: boolean
  detail: string
}

export async function verifyLiveRobotsTxt(
  originUrl: string,
  fetchImpl: typeof fetch,
): Promise<LiveRobotsTxtVerification> {
  const origin = new URL(originUrl).origin
  const res = await fetchImpl(`${origin}/robots.txt`, { redirect: 'follow' })

  if (res.status >= 400 && res.status < 500) {
    // 404 is normal — "ok" for postcondition when we didn't require a file
    return {
      ok: true,
      detail: `robots.txt ${res.status} — permitted (R20)`,
    }
  }

  if (res.status >= 500) {
    return { ok: false, detail: `robots.txt still ${res.status}` }
  }

  const ct = res.headers.get('content-type') ?? ''
  if (!/^text\/plain/i.test(ct)) {
    return { ok: false, detail: `content-type still ${ct}` }
  }

  const body = await res.text()
  if (/^\s*crawl-delay\s*:/im.test(body)) {
    return { ok: false, detail: 'crawl-delay still present' }
  }

  if (new TextEncoder().encode(body).length > 500 * 1024) {
    return { ok: false, detail: 'still exceeds 500 KiB' }
  }

  return {
    ok: true,
    detail: 'robots.txt 200 text/plain under 500 KiB without crawl-delay',
  }
}
