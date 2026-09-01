import { normalizeUrl } from '@/lib/supabase/audit-db'
import { extractSitemapUrlsFromRobots } from './robots-parser'

function parseSitemapUrls(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?<\/loc>/gi))
    .map((m) => m[1].trim().replace(/&amp;/g, '&').replace(/&#x2F;/g, '/'))
    .filter((u) => u.startsWith('http'))
}

export interface SitemapDiscoveryResult {
  urls: string[]
  evidence: string
}

export async function discoverSitemapUrls(baseUrl: string, robotsTxt: string): Promise<SitemapDiscoveryResult> {
  const base = baseUrl.replace(/\/$/, '')
  const candidates = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap/sitemap.xml`,
    `${base}/blog/sitemap.xml`,
    `${base}/wp-sitemap.xml`,
    `${base}/news-sitemap.xml`,
    ...extractSitemapUrlsFromRobots(robotsTxt).map((u) => (u.startsWith('http') ? u : `${base}/${u.replace(/^\//, '')}`)),
  ]

  const seen = new Set<string>()
  const all: string[] = []

  for (const sitemapUrl of candidates) {
    if (seen.has(sitemapUrl)) continue
    seen.add(sitemapUrl)
    try {
      const res = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'SEORANKO-IndexDiagnosis/1.0' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      })
      if (!res.ok) continue
      const xml = await res.text()

      if (xml.includes('<sitemapindex')) {
        const childLocs = parseSitemapUrls(xml).filter((u) => /sitemap/i.test(u))
        for (const childUrl of childLocs.slice(0, 5)) {
          try {
            const childRes = await fetch(childUrl, {
              headers: { 'User-Agent': 'SEORANKO-IndexDiagnosis/1.0' },
              signal: AbortSignal.timeout(6000),
            })
            if (!childRes.ok) continue
            const childXml = await childRes.text()
            all.push(...parseSitemapUrls(childXml).filter((u) => !/sitemap/i.test(u)))
          } catch {
            /* skip child */
          }
        }
        if (all.length > 0) {
          return {
            urls: Array.from(new Set(all.map(normalizeUrl))),
            evidence: `Sitemap index ${sitemapUrl} → ${all.length} URLs`,
          }
        }
        continue
      }

      const urls = parseSitemapUrls(xml).filter((u) => !/sitemap/i.test(u))
      if (urls.length > 0) {
        return {
          urls: Array.from(new Set(urls.map(normalizeUrl))),
          evidence: `${sitemapUrl} → ${urls.length} URLs`,
        }
      }
    } catch {
      /* try next */
    }
  }

  return { urls: [], evidence: 'No sitemap URLs discovered' }
}

export function extractInternalLinks(html: string, pageUrl: string, siteHost: string): string[] {
  const hostNorm = siteHost.replace(/^www\./, '').toLowerCase()
  const out: string[] = []

  for (const m of Array.from(html.matchAll(/href=["']([^"'#?]+)["']/gi))) {
    const href = m[1].trim()
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue

    let abs: string | null = null
    if (href.startsWith('http')) {
      try {
        const h = new URL(href).hostname.replace(/^www\./, '').toLowerCase()
        if (h === hostNorm) abs = normalizeUrl(href)
      } catch {
        /* skip */
      }
    } else if (href.startsWith('/')) {
      try {
        abs = normalizeUrl(new URL(href, pageUrl).href)
      } catch {
        /* skip */
      }
    }

    if (!abs) continue
    if (/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|pdf|zip|xml|webp|avif)\b/i.test(abs)) continue
    out.push(abs)
  }

  return Array.from(new Set(out))
}
