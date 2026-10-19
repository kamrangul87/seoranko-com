/**
 * Topic 57 — Crawled — currently not indexed.
 * Deliberately uninformative about cause (B12). Never infer thin/duplicate/quality.
 */

import {
  isCrawledNotIndexed,
  type GscDetectContext,
} from '@/lib/fix-strategies/shared/gsc-detect-context'
import type { IndexDiagnosis } from '@/lib/fix-strategies/shared/index-diagnosis'

/** Informational — Google's choice, not a technical finding (bucket via prefix). */
export type Topic57Verdict = 'informational-crawled-not-indexed'

export type Topic57Finding = {
  verdict: Topic57Verdict
  pageUrl: string
  detail: string
  severity: 'low'
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

export type DetectTopic57Result = {
  findings: Topic57Finding[]
  suppressed: Array<{ pageUrl: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

export type DetectTopic57Options = {
  gsc: GscDetectContext | null
  /** Independent findings already raised on the same URL (other topics) — listed, never as cause. */
  independentFindingsByUrl?: Map<string, string[]>
  /** Side-by-side crawl evidence + honest classification (Index Diagnosis). */
  diagnosisByUrl?: Map<string, IndexDiagnosis>
}

export function detectCrawledNotIndexed(
  opts: DetectTopic57Options,
): DetectTopic57Result {
  const findings: Topic57Finding[] = []
  const suppressed: Array<{ pageUrl: string; reason: string }> = []
  const ok: Array<{ pageUrl: string; verdict: string }> = []

  if (!opts.gsc) return { findings, suppressed, ok }

  for (const row of opts.gsc.inspections) {
    if (!isCrawledNotIndexed(row.coverageState)) {
      ok.push({ pageUrl: row.url, verdict: 'not_crawled_not_indexed_state' })
      continue
    }

    const independent =
      opts.independentFindingsByUrl?.get(row.urlNormalized) ||
      opts.independentFindingsByUrl?.get(row.url) ||
      []
    const diagnosis =
      opts.diagnosisByUrl?.get(row.urlNormalized) ||
      opts.diagnosisByUrl?.get(row.url) ||
      null

    const diagnosisLine = diagnosis
      ? ` Index Diagnosis: inbound raw links ${diagnosis.inboundInternalLinksRaw}, ` +
        `words ${diagnosis.wordCount}, canonical ${diagnosis.canonical ?? 'none'}, ` +
        `robots ${diagnosis.robots ?? 'none'}, last-modified ${diagnosis.lastModified ?? 'unknown'}. ` +
        `${diagnosis.classificationDetail}`
      : ''

    findings.push({
      verdict: 'informational-crawled-not-indexed',
      pageUrl: row.url,
      severity: 'low',
      autoFixable: false,
      detail:
        `Google's choice, not a technical error — SEORANKO can't force indexing. ` +
        `Google crawled this page and has not indexed it. Last crawl: ${row.lastCrawlTime || 'unknown'}. ` +
        `No resubmission is needed. ` +
        (independent.length
          ? `Separately, independent findings on this URL (not claimed as the cause): ${independent.join('; ')}. `
          : '') +
        diagnosisLine +
        ` Historical Inspection state; coverage may be partial.`,
      evidenceValues: {
        coverageState: row.coverageState,
        lastCrawlTime: row.lastCrawlTime,
        inspectedAt: row.inspectedAt,
        historical: true,
        noPublishedClassifier: true,
        neverInferThinOrDuplicateOrQuality: true,
        independentFindings: independent,
        doNotResubmit: true,
        inspectionCoveragePartial: opts.gsc.inspectionCoveragePartial,
        indexDiagnosis: diagnosis,
        neverPromiseIndexing: true,
      },
    })
  }

  return { findings, suppressed, ok }
}
