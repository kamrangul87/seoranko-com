/**
 * Page audit engine — crawl a URL, detect site type, run general site-audit
 * scoring + e-commerce checks, map into Quality Gate dimension cards, and
 * record history for trend views.
 *
 * Crawl uses HTTP fetch (same stack as site-audit). JS-heavy SPAs may need
 * a headless browser later — flagged in the report when body text is thin
 * despite a 200 response.
 */

import { fetchPageSignals, scorePage, type AuditIssue, type PageSignals } from '@/lib/site-audit/scorer'
import { detectSiteType, type SiteTypeDetection } from '@/lib/site-type-detector'
import { runEcommerceAuditChecks, type EcommerceAuditIssue } from '@/lib/ecommerce-audit-checks'
import {
  buildExplainableScore,
  type ExplainableScoreResult,
  type QualityDimensionId,
} from '@/lib/quality-score-dimensions'
import {
  insertAuditHistory,
  normalizeDomain,
  normalizeUrl,
  upsertAuditResults,
} from '@/lib/supabase/audit-db'
import { createClient } from '@supabase/supabase-js'
import { isSafePublicUrl } from '@/lib/fetch-page-content'

export interface PageAuditIssue {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: string
  title: string
  description: string
  remediation?: string
  affectsDimensions?: QualityDimensionId[]
  blocking?: boolean
}

export interface PageAuditResult {
  url: string
  fetchedAt: string
  httpStatus: number
  siteType: SiteTypeDetection
  score: number
  searchScore: number
  aiScore: number
  issues: PageAuditIssue[]
  opportunities: string[]
  explainable: ExplainableScoreResult
  signals: Pick<
    PageSignals,
    'title' | 'metaDescription' | 'h1' | 'wordCount' | 'hasSchema' | 'hasProductSchema' | 'hasBreadcrumbSchema' | 'imagesWithoutAlt' | 'internalLinks'
  >
  history: Array<{ auditedAt: string; score: number }>
  crawlNotes: string[]
}

function mapAuditIssue(issue: AuditIssue, index: number): PageAuditIssue {
  const severity =
    issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'info'
  const dimMap: Record<string, QualityDimensionId[]> = {
    crawlability: ['technical_seo'],
    onpage: ['technical_seo', 'editorial'],
    technical: ['technical_seo'],
    content: ['editorial', 'readability'],
    schema: ['structured_data'],
    security: ['technical_seo'],
    speed: ['technical_seo'],
    ai: ['editorial'],
    links: ['internal_linking'],
    mobile: ['technical_seo'],
    depth: ['editorial'],
  }
  return {
    id: `audit-${issue.category}-${index}`,
    severity,
    category: issue.category,
    title: issue.message,
    description: issue.current_value
      ? `${issue.message} (current: ${issue.current_value})`
      : issue.message,
    remediation: issue.fix_preview || issue.fix_value || undefined,
    affectsDimensions: dimMap[issue.category] || ['technical_seo'],
    blocking: severity === 'critical',
  }
}

function mapEcommerceIssue(issue: EcommerceAuditIssue): PageAuditIssue {
  return {
    id: issue.id,
    severity: issue.severity,
    category: issue.category,
    title: issue.title,
    description: issue.description,
    remediation: issue.remediation,
    affectsDimensions: issue.affectsDimensions,
    blocking: issue.severity === 'critical',
  }
}

async function fetchRawHtml(url: string): Promise<{ html: string; status: number }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEORANKO-Copilot-Audit/1.0' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
    const html = await res.text()
    return { html, status: res.status }
  } catch {
    return { html: '', status: 0 }
  }
}

async function loadScoreHistory(pageUrl: string): Promise<Array<{ auditedAt: string; score: number }>> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    )
    const { data } = await supabase
      .from('audit_history')
      .select('audited_at, score')
      .eq('page_url', normalizeUrl(pageUrl))
      .order('audited_at', { ascending: false })
      .limit(12)
    return (data || []).map((r: { audited_at: string; score: number }) => ({
      auditedAt: r.audited_at,
      score: r.score,
    }))
  } catch {
    return []
  }
}

export async function runPageAudit(rawUrl: string): Promise<PageAuditResult> {
  const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
  if (!isSafePublicUrl(url)) {
    throw new Error('URL is not allowed (must be a public http(s) URL)')
  }

  const crawlNotes: string[] = []
  const [{ html, status }, signals] = await Promise.all([fetchRawHtml(url), fetchPageSignals(url)])

  if (!html && signals.wordCount === 0) {
    crawlNotes.push('Fetch returned no HTML body — page may be blocked or unreachable.')
  } else if (signals.wordCount < 40 && status >= 200 && status < 400) {
    crawlNotes.push(
      'Very little extractable text on a 2xx response — this may be a JS-rendered SPA. Consider a headless crawl in a later pass; current audit uses HTTP fetch only.',
    )
  }

  const detection = detectSiteType(html || '', url)
  const scored = scorePage(signals, [signals])
  const ecommerceIssues = runEcommerceAuditChecks(html || '', url, detection)

  const issues: PageAuditIssue[] = [
    ...scored.issues.map(mapAuditIssue),
    ...ecommerceIssues.map(mapEcommerceIssue),
  ]

  const explainable = buildExplainableScore(issues)

  // Persist for trend (best-effort — tables may be absent in local empty DBs)
  try {
    const domain = normalizeDomain(url)
    await upsertAuditResults(domain, [
      {
        url,
        score: scored.score,
        grade: scored.score >= 80 ? 'A' : scored.score >= 70 ? 'B' : scored.score >= 50 ? 'C' : 'D',
        wordCount: signals.wordCount,
        issues: scored.issues,
        opportunities: scored.opportunities,
        aiAnalysis: { siteType: detection, ecommerceIssueCount: ecommerceIssues.length },
        httpStatus: signals.httpStatus || status,
        title: signals.title,
        metaDescription: signals.metaDescription,
        h1: signals.h1,
        hasSchema: signals.hasSchema,
        hasFaq: signals.hasFaq,
      },
    ])
    await insertAuditHistory(domain, [{ url, score: scored.score, aiScore: scored.aiScore }])
  } catch (err) {
    crawlNotes.push(`History persist skipped: ${err instanceof Error ? err.message : 'unknown'}`)
  }

  const history = await loadScoreHistory(url)

  return {
    url: normalizeUrl(url),
    fetchedAt: new Date().toISOString(),
    httpStatus: signals.httpStatus || status,
    siteType: detection,
    score: scored.score,
    searchScore: scored.searchScore,
    aiScore: scored.aiScore,
    issues,
    opportunities: scored.opportunities,
    explainable,
    signals: {
      title: signals.title,
      metaDescription: signals.metaDescription,
      h1: signals.h1,
      wordCount: signals.wordCount,
      hasSchema: signals.hasSchema,
      hasProductSchema: signals.hasProductSchema,
      hasBreadcrumbSchema: signals.hasBreadcrumbSchema,
      imagesWithoutAlt: signals.imagesWithoutAlt,
      internalLinks: signals.internalLinks,
    },
    history,
    crawlNotes,
  }
}
