/**
 * Topic 59 — Impressions above floor + zero inbound crawlable internal links.
 * Auto-fixable only for onclick/javascript: → real <a href> (topic 43 guard C).
 */

import type { GscDetectContext } from '@/lib/fix-strategies/shared/gsc-detect-context'
import { FIX_STRATEGY_PRODUCT_DECISIONS } from '@/lib/fix-strategies/product-decisions'

export type Topic59Verdict =
  | 'impressions-no-internal-links'
  | 'impressions-only-noncrawlable-link'

export type Topic59Finding = {
  verdict: Topic59Verdict
  pageUrl: string
  detail: string
  severity: 'moderate'
  autoFixable: boolean
  evidenceValues: Record<string, unknown>
}

export type DetectTopic59Result = {
  findings: Topic59Finding[]
  suppressed: Array<{ pageUrl: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

export type DetectTopic59Options = {
  gsc: GscDetectContext | null
  orphanNormalized: Set<string>
  /** Normalized URLs reachable only via onclick / javascript: href. */
  onlyNoncrawlableNormalized?: Set<string>
  /** Override product floor in tests. */
  impressionsFloor?: number
}

export function detectImpressionsNoInternalLinks(
  opts: DetectTopic59Options,
): DetectTopic59Result {
  const findings: Topic59Finding[] = []
  const suppressed: Array<{ pageUrl: string; reason: string }> = []
  const ok: Array<{ pageUrl: string; verdict: string }> = []

  if (!opts.gsc) return { findings, suppressed, ok }

  const floorRaw =
    opts.impressionsFloor ?? FIX_STRATEGY_PRODUCT_DECISIONS.impressionsFloor
  if (floorRaw == null || typeof floorRaw !== 'number') {
    // Product decision unset — refuse to invent a threshold.
    return {
      findings,
      suppressed: [
        {
          pageUrl: opts.gsc.propertyUrl,
          reason: 'impressions_floor_unset',
        },
      ],
      ok,
    }
  }
  const floor = floorRaw

  for (const m of opts.gsc.metrics) {
    if (m.impressions < floor) {
      ok.push({ pageUrl: m.url, verdict: 'below_impressions_floor' })
      continue
    }
    if (!opts.orphanNormalized.has(m.urlNormalized)) {
      ok.push({ pageUrl: m.url, verdict: 'has_inbound_crawlable_links' })
      continue
    }

    const onlyJs = opts.onlyNoncrawlableNormalized?.has(m.urlNormalized) === true
    findings.push({
      verdict: onlyJs
        ? 'impressions-only-noncrawlable-link'
        : 'impressions-no-internal-links',
      pageUrl: m.url,
      severity: 'moderate',
      autoFixable: onlyJs,
      detail: onlyJs
        ? `This URL has ${m.impressions} finalized Search impressions (floor ${floor}, product decision) ` +
          `but is reachable only via a non-crawlable onclick/javascript: link. Converting that to a real ` +
          `<a href> is deterministic. Date range from finalized Search Analytics; top-row coverage applies.`
        : `This URL has ${m.impressions} finalized Search impressions (floor ${floor}, product decision — not a Google threshold) ` +
          `and zero inbound crawlable internal links. Adding a body link from a related page is editorial (human-review). ` +
          `Absence of a row is never read as zero impressions elsewhere.`,
      evidenceValues: {
        impressions: m.impressions,
        clicks: m.clicks,
        impressionsFloor: floor,
        impressionsFloorIsProductDecision: true,
        orphan: true,
        onlyNoncrawlableLink: onlyJs,
        b22TopRows: true,
        historical: true,
      },
    })
  }

  return { findings, suppressed, ok }
}
