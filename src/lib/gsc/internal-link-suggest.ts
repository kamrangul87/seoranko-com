import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'

export type SourceStrength = { url: string; impressions: number }

export type InternalLinkSuggestion = {
  sourceUrl: string
  targetUrl: string
  anchorText: string
  insertion: 'related-list'
}

// Reserved for future contextual insertion logic
// function tokens(s: string): Set<string> {
//   return new Set(
//     s
//       .toLowerCase()
//       .split(/[^a-z0-9]+/i)
//       .filter(Boolean),
//   )
// }

function topQueries(queries: string[], limit = 3): string[] {
  const out: string[] = []
  for (const q of queries) {
    const t = q.trim()
    if (!t) continue
    if (!out.includes(t)) out.push(t)
    if (out.length >= limit) break
  }
  return out
}

async function pageLinksToTarget(
  sourceHtml: string,
  sourceUrl: string,
  targetUrl: string,
): Promise<boolean> {
  try {
    const a = new URL(sourceUrl)
    const b = new URL(targetUrl)
    const bPath = b.pathname.replace(/\/$/, '')
    const normB = normalizeFixStrategyUrl(b.toString(), a.toString()) ?? b.toString()
    const hrefs = Array.from(
      sourceHtml.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi),
    ).map((m) => m[1])
    for (const href of hrefs) {
      try {
        const u = new URL(href, a.toString())
        if (
          (u.pathname.replace(/\/$/, '') === bPath && u.host === b.host) ||
          u.toString() === normB
        ) {
          return true
        }
      } catch {
        // ignore bad hrefs
      }
    }
  } catch {
    /* ignore */
  }
  return false
}

export async function suggestInternalLinks(input: {
  siteOrigin: string
  targetUrl: string
  targetQueries: string[]
  candidateSources: SourceStrength[]
  fetchImpl?: typeof fetch
  maxSuggestions?: number
}): Promise<InternalLinkSuggestion[]> {
  const fetchImpl = input.fetchImpl ?? fetch
  const max = input.maxSuggestions ?? 3
  const allowedQueries = topQueries(input.targetQueries, 3)
  if (allowedQueries.length === 0) return []
  const anchorText = allowedQueries[0]!
  // Prefer homepage first, then strongest pages by impressions
  const homepage = input.siteOrigin.replace(/\/$/, '')
  const picked: string[] = []
  if (!picked.includes(homepage)) picked.push(homepage)
  for (const s of input.candidateSources.sort((a, b) => b.impressions - a.impressions)) {
    if (picked.length >= 8) break
    if (!s.url || s.url === input.targetUrl) continue
    if (!picked.includes(s.url)) picked.push(s.url)
  }
  const out: InternalLinkSuggestion[] = []
  for (const source of picked) {
    if (out.length >= max) break
    try {
      const res = await fetchImpl(source, { redirect: 'follow', signal: AbortSignal.timeout(8000) })
      const ct = res.headers.get('content-type') || ''
      const ok = res.ok && /text\/html/i.test(ct)
      const body = ok ? await res.text() : ''
      if (!ok || !body) continue
      const already = await pageLinksToTarget(body, source, input.targetUrl)
      if (already) continue
      out.push({
        sourceUrl: source,
        targetUrl: input.targetUrl,
        anchorText,
        insertion: 'related-list',
      })
    } catch {
      /* ignore network errors */
    }
  }
  return out
}

