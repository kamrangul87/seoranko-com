import { createClient } from '@supabase/supabase-js'
import { normalizeDomain } from '@/lib/supabase/audit-db'
import { runIndexDiagnosis } from '@/lib/index-diagnosis/run'
import type { CrawlCoverage, IndexDiagnosisResult, PageIndexability } from '@/lib/index-diagnosis/types'
import type { SitemapCrawlInput } from './types'

const RECENT_CRAWL_MS = 7 * 24 * 60 * 60 * 1000

function seedUrlFromDomain(domain: string): string {
  return `https://${domain.replace(/^www\./, '')}/`
}

async function fetchRobotsTxt(seedUrl: string): Promise<string> {
  try {
    const base = seedUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/robots.txt`, {
      headers: { 'User-Agent': 'SEORANKO-Sitemap/1.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

interface StoredRunRow {
  seed_url: string
  coverage: CrawlCoverage
  pages: PageIndexability[]
  created_at: string
}

async function loadRecentCrawl(userId: string, domain: string): Promise<StoredRunRow | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )
    const since = new Date(Date.now() - RECENT_CRAWL_MS).toISOString()
    const { data, error } = await supabase
      .from('index_diagnosis_runs')
      .select('seed_url, coverage, pages, created_at')
      .eq('user_id', userId)
      .eq('domain', domain)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null
    return data as StoredRunRow
  } catch {
    return null
  }
}

export interface LoadCrawlOptions {
  domainOrUrl: string
  userId: string
  forceFresh?: boolean
}

export interface LoadCrawlResult extends SitemapCrawlInput {
  fullResult?: IndexDiagnosisResult
}

/** Reuse a recent Index Diagnosis crawl when available; otherwise run a fresh crawl. */
export async function loadOrRunCrawlForSitemap(opts: LoadCrawlOptions): Promise<LoadCrawlResult> {
  const domain = normalizeDomain(opts.domainOrUrl)
  const seedUrl = opts.domainOrUrl.startsWith('http') ? opts.domainOrUrl : seedUrlFromDomain(domain)

  if (!opts.forceFresh) {
    const stored = await loadRecentCrawl(opts.userId, domain)
    if (stored && Array.isArray(stored.pages) && stored.pages.length > 0) {
      const robotsTxt = await fetchRobotsTxt(stored.seed_url || seedUrl)
      return {
        domain,
        seedUrl: stored.seed_url || seedUrl,
        pages: stored.pages,
        coverage: stored.coverage,
        robotsTxt,
        ranAt: stored.created_at,
        crawlSource: 'reused',
      }
    }
  }

  const resolvedSeed = seedUrl.startsWith('http') ? seedUrl : seedUrlFromDomain(domain)
  const result = await runIndexDiagnosis(resolvedSeed)

  return {
    domain: result.coverage.domain,
    seedUrl: result.coverage.seedUrl,
    pages: result.pages,
    coverage: result.coverage,
    htmlByUrl: result.htmlByUrl,
    robotsTxt: result.robotsTxt || (await fetchRobotsTxt(result.coverage.seedUrl)),
    ranAt: result.ranAt,
    crawlSource: 'fresh',
    fullResult: result,
  }
}
