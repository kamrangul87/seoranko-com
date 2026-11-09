/**
 * Precompute Page-2 title/meta and internal-link suggestions on the daily
 * GSC sync. Reuses existing suggestion functions — no paid APIs.
 * Create PR remains a user click.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { QueryPageDaily } from './opportunities'
import { page2OpportunitiesFromRows, page2WindowFromRows } from './weekly-report'
import { suggestTitleAndDescription } from './title-meta-suggest'
import { suggestInternalLinks } from './internal-link-suggest'

export type CachedTitleMeta = {
  currentTitle: string | null
  currentDescription: string | null
  suggestedTitle: string | null
  suggestedDescription: string | null
  targetedQueries: string[]
}

export type CachedInternalLinks = {
  anchorText: string
  sources: Array<{ sourceUrl: string; insertion: 'related-list' }>
}

export type Page2SuggestionsCache = {
  computedAt: string
  startDate: string | null
  endDate: string | null
  windowDays: number
  titleMeta: Record<string, CachedTitleMeta>
  internalLinks: Record<string, CachedInternalLinks>
}

export function asPage2SuggestionsCache(
  raw: unknown,
): Page2SuggestionsCache | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<Page2SuggestionsCache>
  if (!o.titleMeta || typeof o.titleMeta !== 'object') return null
  if (!o.internalLinks || typeof o.internalLinks !== 'object') return null
  return {
    computedAt: typeof o.computedAt === 'string' ? o.computedAt : '',
    startDate: o.startDate ?? null,
    endDate: o.endDate ?? null,
    windowDays: typeof o.windowDays === 'number' ? o.windowDays : 0,
    titleMeta: o.titleMeta as Page2SuggestionsCache['titleMeta'],
    internalLinks: o.internalLinks as Page2SuggestionsCache['internalLinks'],
  }
}

export function selectUrlsForPrecompute(
  urls: string[],
  limit = 5,
): string[] {
  const out: string[] = []
  for (const u of urls) {
    if (!u) continue
    if (!out.includes(u)) out.push(u)
    if (out.length >= limit) break
  }
  return out
}

async function fetchHtml(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  try {
    const res = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    const ct = res.headers.get('content-type') || ''
    if (res.ok && /text\/html/i.test(ct)) return await res.text()
  } catch {
    /* ignore */
  }
  return ''
}

export async function buildPage2SuggestionsCache(input: {
  rows: QueryPageDaily[]
  fetchImpl?: typeof fetch
  limit?: number
  nowIso?: string
}): Promise<Page2SuggestionsCache> {
  const fetchImpl = input.fetchImpl ?? fetch
  const window = page2WindowFromRows(input.rows)
  const opps = page2OpportunitiesFromRows(input.rows)
  const urls = selectUrlsForPrecompute(
    opps.map((o) => o.url),
    input.limit ?? 5,
  )
  const titleMeta: Record<string, CachedTitleMeta> = {}
  const internalLinks: Record<string, CachedInternalLinks> = {}

  const byUrl = new Map<string, number>()
  if (window) {
    for (const r of input.rows) {
      if (!r.is_final) continue
      if (r.date < window.startDate || r.date > window.endDate) continue
      byUrl.set(r.url, (byUrl.get(r.url) || 0) + (Number(r.impressions) || 0))
    }
  }
  const candidateSources = Array.from(byUrl.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([url, impressions]) => ({ url, impressions }))
  const origin = (() => {
    const any = urls[0] || input.rows[0]?.url || ''
    try {
      return new URL(any).origin
    } catch {
      return ''
    }
  })()

  for (const url of urls) {
    const queries = opps.filter((o) => o.url === url).map((o) => o.query)
    const html = await fetchHtml(url, fetchImpl)
    if (html && queries.length > 0) {
      const sug = suggestTitleAndDescription({ url, html, queries: queries.slice(0, 5) })
      titleMeta[url] = {
        currentTitle: sug.currentTitle,
        currentDescription: sug.currentDescription,
        suggestedTitle: sug.suggestedTitle,
        suggestedDescription: sug.suggestedDescription,
        targetedQueries: sug.targetedQueries,
      }
    }
    if (origin) {
      const links = await suggestInternalLinks({
        siteOrigin: origin,
        targetUrl: url,
        targetQueries: queries,
        candidateSources,
        fetchImpl,
        maxSuggestions: 2,
      })
      if (links.length > 0) {
        internalLinks[url] = {
          anchorText: links[0]!.anchorText,
          sources: links.map((s) => ({
            sourceUrl: s.sourceUrl,
            insertion: s.insertion,
          })),
        }
      }
    }
  }

  return {
    computedAt: input.nowIso ?? new Date().toISOString(),
    startDate: window?.startDate ?? null,
    endDate: window?.endDate ?? null,
    windowDays: window?.windowDays ?? 0,
    titleMeta,
    internalLinks,
  }
}

export async function persistPage2SuggestionsForSite(input: {
  siteId: string
  rows: QueryPageDaily[]
  fetchImpl?: typeof fetch
}): Promise<Page2SuggestionsCache> {
  const cache = await buildPage2SuggestionsCache({
    rows: input.rows,
    fetchImpl: input.fetchImpl,
    limit: 3,
  })
  const sb = createServiceRoleClient()
  await sb
    .from('gsc_connections')
    .update({ page2_suggestions: cache })
    .eq('site_id', input.siteId)
    .eq('status', 'active')
  return cache
}
