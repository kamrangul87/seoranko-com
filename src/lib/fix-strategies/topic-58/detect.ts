/**
 * Topic 58 — Index set vs crawl set divergence (after canonical normalisation).
 * "In crawl not in GSC" is low severity (B22 — Search Analytics top rows only).
 */

import { normalizeCanonicalForGscMatch } from '@/lib/fix-strategies/shared/canonical-normalize'
import type { GscDetectContext } from '@/lib/fix-strategies/shared/gsc-detect-context'

export type Topic58Verdict =
  | 'in-gsc-not-in-crawl'
  | 'in-crawl-not-in-gsc-weak'

export type Topic58Finding = {
  verdict: Topic58Verdict
  pageUrl: string
  detail: string
  severity: 'moderate' | 'low'
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

export type DetectTopic58Result = {
  findings: Topic58Finding[]
  suppressed: Array<{ pageUrl: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

export type DetectTopic58Options = {
  gsc: GscDetectContext | null
  /** Normalized URLs successfully crawled (exclude our fetch failures). */
  crawledNormalized: Set<string>
  /** Normalized URLs we failed to fetch — exclude from reporting as site defects. */
  fetchFailedNormalized?: Set<string>
  /** Normalized URLs excluded by our crawler config — our defect. */
  crawlerExcludedNormalized?: Set<string>
  orphanNormalized?: Set<string>
}

export function detectIndexedVsCrawlMismatch(
  opts: DetectTopic58Options,
): DetectTopic58Result {
  const findings: Topic58Finding[] = []
  const suppressed: Array<{ pageUrl: string; reason: string }> = []
  const ok: Array<{ pageUrl: string; verdict: string }> = []

  if (!opts.gsc) return { findings, suppressed, ok }

  const gscSet = new Set<string>()
  const gscUrlByNorm = new Map<string, string>()
  for (const m of opts.gsc.metrics) {
    gscSet.add(m.urlNormalized)
    gscUrlByNorm.set(m.urlNormalized, m.url)
  }
  for (const i of opts.gsc.inspections) {
    gscSet.add(i.urlNormalized)
    gscUrlByNorm.set(i.urlNormalized, i.url)
  }

  // Direction 1: in GSC, not in our crawl
  for (const norm of gscSet) {
    if (opts.fetchFailedNormalized?.has(norm)) {
      suppressed.push({
        pageUrl: gscUrlByNorm.get(norm) || norm,
        reason: 'our_fetch_failed_re_crawl',
      })
      continue
    }
    if (opts.crawlerExcludedNormalized?.has(norm)) {
      suppressed.push({
        pageUrl: gscUrlByNorm.get(norm) || norm,
        reason: 'our_crawler_config_exclusion',
      })
      continue
    }
    if (opts.crawledNormalized.has(norm)) {
      ok.push({
        pageUrl: gscUrlByNorm.get(norm) || norm,
        verdict: 'in_both_sets',
      })
      continue
    }

    const pageUrl = gscUrlByNorm.get(norm) || norm
    const orphan = opts.orphanNormalized?.has(norm) === true
    findings.push({
      verdict: 'in-gsc-not-in-crawl',
      pageUrl,
      severity: 'moderate',
      autoFixable: false,
      detail:
        `Google knows this URL (Search Analytics and/or Inspection) but our crawl did not reach it` +
        (orphan ? ' — zero inbound crawlable internal links on the site graph' : '') +
        `. Compared after canonical normalisation. Historical GSC data; Inspection coverage may be partial.`,
      evidenceValues: {
        direction: 'gsc_not_crawl',
        urlNormalized: norm,
        orphan,
        historical: true,
        inspectionCoveragePartial: opts.gsc.inspectionCoveragePartial,
      },
    })
  }

  // Direction 2: in crawl, not in GSC — WEAK (B22)
  for (const norm of opts.crawledNormalized) {
    if (gscSet.has(norm)) continue
    const pageUrl = norm
    findings.push({
      verdict: 'in-crawl-not-in-gsc-weak',
      pageUrl,
      severity: 'low',
      autoFixable: false,
      detail:
        `Our crawl found this URL but it did not appear in Search Analytics top rows or stored Inspections. ` +
        `Absence from Search Analytics is not proof Google does not know the URL (only top rows are returned). ` +
        `Low confidence; labelled weak.`,
      evidenceValues: {
        direction: 'crawl_not_gsc',
        urlNormalized: normalizeCanonicalForGscMatch(norm),
        weakBecauseTopRowsOnly: true,
        b22: true,
        historical: true,
      },
    })
  }

  return { findings, suppressed, ok }
}
