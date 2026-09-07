/**
 * Build the allowlist of site URLs that may be ingested into url_metrics_daily.
 * Source of truth: Index Diagnosis crawl + live sitemap discovery (post-normalizeUrl).
 * Fallbacks: site_audit_results, then link_targets — never the full GSC property dump.
 */

import { normalizeDomain, normalizeUrl } from '@/lib/supabase/audit-db'

export type KnownUrlSource = 'index_diagnosis' | 'site_audit_results' | 'link_targets' | 'none'

export type KnownUrlAllowlist = {
  urls: Set<string>
  source: KnownUrlSource
  domain: string | null
}

/** Normalize and collect unique URLs from crawl pages + sitemap lists. */
export function buildKnownUrlSet(parts: {
  pageUrls?: Array<string | null | undefined>
  sitemapUrls?: Array<string | null | undefined>
}): Set<string> {
  const out = new Set<string>()
  const add = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== 'string') return
    const trimmed = raw.trim()
    if (!trimmed) return
    try {
      out.add(normalizeUrl(trimmed))
    } catch {
      out.add(trimmed.toLowerCase().replace(/\/$/, ''))
    }
  }
  for (const u of parts.pageUrls || []) add(u)
  for (const u of parts.sitemapUrls || []) add(u)
  return out
}

/** Keep only GSC rows whose page URL (post-normalizeUrl) is in the allowlist. */
export function filterRowsToKnownUrls<T extends { page: string }>(
  rows: T[],
  allowlist: Set<string>,
): { kept: T[]; dropped: number } {
  if (allowlist.size === 0) return { kept: [], dropped: rows.length }
  const kept: T[] = []
  let dropped = 0
  for (const row of rows) {
    if (!row.page) {
      dropped += 1
      continue
    }
    let norm: string
    try {
      norm = normalizeUrl(row.page)
    } catch {
      norm = row.page
    }
    if (allowlist.has(norm)) kept.push(row)
    else dropped += 1
  }
  return { kept, dropped }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** Load known live/crawl URLs for a connected site (by site_id). */
export async function loadKnownUrlsForSite(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opts: { siteId: string; userId: string },
): Promise<KnownUrlAllowlist> {
  const { data: site, error: siteErr } = await supabase
    .from('connected_sites')
    .select('id, domain, user_id')
    .eq('id', opts.siteId)
    .maybeSingle()

  if (siteErr || !site?.domain) {
    return { urls: new Set(), source: 'none', domain: null }
  }

  const domain = normalizeDomain(site.domain)
  const userId = site.user_id || opts.userId

  // 1) Latest Index Diagnosis run (crawl pages + sitemap discoveries).
  const { data: run } = await supabase
    .from('index_diagnosis_runs')
    .select('pages, coverage')
    .eq('user_id', userId)
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (run) {
    const pages = Array.isArray(run.pages) ? run.pages : []
    const pageUrls = pages
      .map((p: { url?: string }) => (p && typeof p.url === 'string' ? p.url : null))
      .filter(Boolean) as string[]
    const coverage = run.coverage && typeof run.coverage === 'object' ? run.coverage : {}
    const sitemapUrls = [
      ...asStringArray((coverage as { sitemapDiscoveredUrls?: unknown }).sitemapDiscoveredUrls),
      ...asStringArray((coverage as { sitemapOnlyUrls?: unknown }).sitemapOnlyUrls),
    ]
    const urls = buildKnownUrlSet({ pageUrls, sitemapUrls })
    if (urls.size > 0) {
      return { urls, source: 'index_diagnosis', domain }
    }
  }

  // 2) site_audit_results for this domain.
  const { data: auditRows } = await supabase
    .from('site_audit_results')
    .select('page_url')
    .eq('domain', domain)
    .limit(5000)

  if (Array.isArray(auditRows) && auditRows.length > 0) {
    const urls = buildKnownUrlSet({
      pageUrls: auditRows.map((r: { page_url?: string }) => r.page_url),
    })
    if (urls.size > 0) {
      return { urls, source: 'site_audit_results', domain }
    }
  }

  // 3) Latest link-graph targets for this domain.
  const { data: audit } = await supabase
    .from('link_graph_audits')
    .select('id')
    .eq('user_id', userId)
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (audit?.id) {
    const { data: targets } = await supabase
      .from('link_targets')
      .select('url_normalized')
      .eq('audit_id', audit.id)
      .limit(10000)

    if (Array.isArray(targets) && targets.length > 0) {
      const urls = buildKnownUrlSet({
        pageUrls: targets.map((t: { url_normalized?: string }) => t.url_normalized),
      })
      if (urls.size > 0) {
        return { urls, source: 'link_targets', domain }
      }
    }
  }

  return { urls: new Set(), source: 'none', domain }
}
