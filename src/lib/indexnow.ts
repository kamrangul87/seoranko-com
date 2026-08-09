// IndexNow protocol — https://www.indexnow.org/documentation
// A one-time HTTP POST notifying supporting search engines (Bing, Yandex,
// and others) that a URL was published/updated, so they can (re)crawl
// sooner instead of waiting for their next scheduled pass. Confirmed absent
// entirely from this pipeline before this change.
//
// Needs a real IndexNow key (a GUID-style string, registered by hosting a
// matching {key}.txt file at the site's root — see IndexNow's docs) and a
// real production domain. Neither exists in this dev/sandbox environment,
// so this is env-var driven: it no-ops with a warning log (never a thrown
// error, and never a ping with fabricated values) whenever INDEXNOW_KEY
// isn't set. Configure INDEXNOW_KEY (and INDEXNOW_KEY_LOCATION, if the key
// file won't live at the default https://{host}/{key}.txt path) in Vercel
// once a real key exists.

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

export interface IndexNowPingResult {
  fired: boolean
  reason: string
}

export async function pingIndexNow(url: string): Promise<IndexNowPingResult> {
  const key = process.env.INDEXNOW_KEY
  if (!key) {
    return { fired: false, reason: 'INDEXNOW_KEY not set — skipping (configure in Vercel once a real IndexNow key exists)' }
  }

  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return { fired: false, reason: `could not parse URL: ${url}` }
  }

  // Never ping with a placeholder — article-v2/route.ts falls back to
  // https://example.com/... for the canonical/schema URL when brand/domain
  // are both absent from the request. Only fire once that context is real.
  if (host === 'example.com' || host.endsWith('.example.com')) {
    return { fired: false, reason: 'URL uses the placeholder example.com domain — brand/domain not set for this article, skipping' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: process.env.INDEXNOW_KEY_LOCATION || `https://${host}/${key}.txt`,
        urlList: [url],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { fired: false, reason: `IndexNow responded HTTP ${res.status}` }
    }
    return { fired: true, reason: `HTTP ${res.status}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { fired: false, reason: `fetch failed: ${message}` }
  } finally {
    clearTimeout(timer)
  }
}
