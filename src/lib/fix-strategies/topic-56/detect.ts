/**
 * Topic 56 — Discovered — currently not indexed (report-only).
 * Never assert server overload from the state alone (B9).
 */

import {
  isDiscoveredNotIndexed,
  type GscDetectContext,
} from '@/lib/fix-strategies/shared/gsc-detect-context'
import { normalizeCanonicalForGscMatch } from '@/lib/fix-strategies/shared/canonical-normalize'

export type Topic56Verdict = 'discovered-not-indexed'

export type Topic56Finding = {
  verdict: Topic56Verdict
  pageUrl: string
  detail: string
  severity: 'low' | 'moderate'
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

export type DetectTopic56Result = {
  findings: Topic56Finding[]
  suppressed: Array<{ pageUrl: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

export type DetectTopic56Options = {
  gsc: GscDetectContext | null
  /** Normalized URLs with zero inbound crawlable links (topic 43). */
  orphanNormalized?: Set<string>
  /** Normalized URLs that returned persistent 5xx on our crawl. */
  persistent5xxNormalized?: Set<string>
  /** Normalized URLs Disallow'd for Googlebot. */
  disallowedNormalized?: Set<string>
}

export function detectDiscoveredNotIndexed(
  opts: DetectTopic56Options,
): DetectTopic56Result {
  const findings: Topic56Finding[] = []
  const suppressed: Array<{ pageUrl: string; reason: string }> = []
  const ok: Array<{ pageUrl: string; verdict: string }> = []

  if (!opts.gsc) return { findings, suppressed, ok }

  for (const row of opts.gsc.inspections) {
    if (!isDiscoveredNotIndexed(row.coverageState)) {
      ok.push({ pageUrl: row.url, verdict: 'not_discovered_state' })
      continue
    }

    // B8 — last crawl date should be empty for this state.
    if (row.lastCrawlTime) {
      suppressed.push({
        pageUrl: row.url,
        reason: 'last_crawl_populated_not_discovered_state',
      })
      continue
    }

    const norm = row.urlNormalized || normalizeCanonicalForGscMatch(row.url)
    if (opts.disallowedNormalized?.has(norm)) {
      suppressed.push({ pageUrl: row.url, reason: 'disallowed_investigate_conflict' })
      continue
    }

    const orphan = opts.orphanNormalized?.has(norm) === true
    const persistent5xx = opts.persistent5xxNormalized?.has(norm) === true
    const corroborations: string[] = []
    if (orphan) corroborations.push('zero_inbound_crawlable_links')
    if (persistent5xx) corroborations.push('persistent_5xx_on_our_crawl')

    findings.push({
      verdict: 'discovered-not-indexed',
      pageUrl: row.url,
      severity: corroborations.length > 0 ? 'moderate' : 'low',
      autoFixable: false,
      detail:
        `Google reports "Discovered — currently not indexed" for this URL (historical). ` +
        `Google has not crawled it yet; last crawl date is empty. ` +
        `Google's "expected overload" wording is typical context, not proof the server is overloaded. ` +
        (corroborations.length
          ? `Independent corroboration: ${corroborations.join(', ')}. `
          : `No independent corroborating defect on our crawl. `) +
        `Inspection coverage may be partial.`,
      evidenceValues: {
        coverageState: row.coverageState,
        lastCrawlTime: null,
        inspectedAt: row.inspectedAt,
        historical: true,
        corroborations,
        neverAssertServerOverload: true,
        inspectionCoveragePartial: opts.gsc.inspectionCoveragePartial,
      },
    })
  }

  return { findings, suppressed, ok }
}
