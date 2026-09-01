/**
 * Mechanical redirect config merges for Fix Agent (Next.js next.config.js).
 */

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

export function redirectEntryObject(fromUrl: string, toUrl: string): string {
  const fromPath = pathFromUrl(fromUrl)
  const toPath = pathFromUrl(toUrl)
  return `{
        source: '${fromPath}',
        destination: '${toPath}',
        permanent: true,
      }`
}

export function redirectAlreadyInConfig(content: string, fromUrl: string): boolean {
  const fromPath = pathFromUrl(fromUrl)
  const escaped = fromPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`source:\\s*['"]${escaped}['"]`, 'i').test(content)
}

export function mergeNextConfigRedirect(
  content: string,
  fromUrl: string,
  toUrl: string,
): { content: string; changed: boolean; summary: string } {
  if (redirectAlreadyInConfig(content, fromUrl)) {
    return { content, changed: false, summary: `Redirect for ${pathFromUrl(fromUrl)} already present in config.` }
  }

  const entry = redirectEntryObject(fromUrl, toUrl)

  if (/async\s+redirects\s*\(\s*\)/i.test(content) && /return\s*\[/i.test(content)) {
    const next = content.replace(/return\s*\[/i, (m) => `${m}\n      ${entry},`)
    return {
      content: next,
      changed: true,
      summary: `Added redirect ${pathFromUrl(fromUrl)} → ${pathFromUrl(toUrl)} to existing redirects().`,
    }
  }

  const fullConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      ${entry},
    ]
  },
}

module.exports = nextConfig
`
  return {
    content: fullConfig,
    changed: true,
    summary: `Created next.config.js with redirect ${pathFromUrl(fromUrl)} → ${pathFromUrl(toUrl)}.`,
  }
}

/** Verify a URL now redirects to the expected destination (follow up to 5 hops). */
export async function verifyRedirectLive(fromUrl: string, expectedDestPath: string): Promise<{ ok: boolean; detail: string }> {
  try {
    let current = fromUrl
    for (let i = 0; i < 6; i++) {
      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'SEORANKO-FixAgent/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) break
        current = new URL(loc, current).href
        continue
      }
      const finalPath = new URL(current).pathname.replace(/\/$/, '') || '/'
      const want = expectedDestPath.replace(/\/$/, '') || '/'
      const ok = finalPath === want || current.replace(/\/$/, '') === expectedDestPath.replace(/\/$/, '')
      return {
        ok,
        detail: ok
          ? `Redirect resolves to ${current} (expected path ${want}).`
          : `Fetched ${current} (path ${finalPath}) — expected ${want}. Rebuild may still be pending.`,
      }
    }
    return { ok: false, detail: 'Redirect chain did not resolve to expected destination.' }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'Redirect verification fetch failed.' }
  }
}
