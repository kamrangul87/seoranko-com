/**
 * Topic 22 — robots.txt invalid or unreachable.
 *
 * Uses shared inspect; parse result feeds topic 21.
 * Never auto-edit Disallow. Never create robots.txt where none exists.
 * Auto-fix only: text/plain content-type, remove crawl-delay.
 */

import {
  fetchAndInspectRobotsTxt,
  inspectRobotsTxtBody,
  type HopRecordingLikeDeps,
  type RobotsTxtInspection,
} from '@/lib/fix-strategies/shared/robots-txt-inspect'
import { resolveFixTarget, type FixTargetResult } from '@/lib/fix-strategies/shared'

export type Topic22Verdict =
  | 'ok'
  | 'suppress-404-normal'
  | 'critical-5xx-complete-disallow'
  | 'route-topic-3-transient-5xx'
  | 'auto-set-text-plain'
  | 'auto-remove-crawl-delay'
  | 'human-review-noindex-in-robots'
  | 'human-review-malformed'
  | 'human-review-size-limit'
  | 'report-5xx-unreachable'

export type Topic22Finding = {
  kind: 'robots/invalid-or-unreachable'
  verdict: Topic22Verdict
  severity: 'critical' | 'high' | 'moderate' | 'informational' | null
  detail: string
  inspection: RobotsTxtInspection
  autoFixable: boolean
  fixTarget: FixTargetResult
}

export type DetectTopic22Result = {
  findings: Topic22Finding[]
  /** Shared parse result for topic 21 — always present after detect. */
  inspection: RobotsTxtInspection
}

export type DetectTopic22Options = {
  deps: HopRecordingLikeDeps
  /** Pre-built inspection (fixtures / shared with topic 21). */
  inspection?: RobotsTxtInspection
  originUrl: string
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function classifyRobotsTxtInspection(
  inspection: RobotsTxtInspection,
): Array<{
  verdict: Topic22Verdict
  severity: Topic22Finding['severity']
  detail: string
  autoFixable: boolean
}> {
  const out: Array<{
    verdict: Topic22Verdict
    severity: Topic22Finding['severity']
    detail: string
    autoFixable: boolean
  }> = []

  if (inspection.fetchStatus === 'not-found') {
    out.push({
      verdict: 'suppress-404-normal',
      severity: null,
      detail:
        'robots.txt 4xx — crawling permitted (R20). Normal, not a defect. Never raise.',
      autoFixable: false,
    })
    return out
  }

  if (inspection.fetchStatus === 'transient-5xx') {
    out.push({
      verdict: 'route-topic-3-transient-5xx',
      severity: null,
      detail: 'Transient 5xx on robots.txt — topic 3',
      autoFixable: false,
    })
    return out
  }

  if (inspection.fetchStatus === 'server-error') {
    out.push({
      verdict: 'critical-5xx-complete-disallow',
      severity: 'critical',
      detail:
        'robots.txt 5xx/unreachable — crawlers assume complete disallow for the origin (R21). No repo transform.',
      autoFixable: false,
    })
    return out
  }

  // ok — check content issues (can stack)
  if (!inspection.isTextPlain) {
    out.push({
      verdict: 'auto-set-text-plain',
      severity: 'high',
      detail: `Served as ${inspection.contentType ?? 'unknown'} — must be text/plain (R13)`,
      autoFixable: true,
    })
  }

  if (inspection.crawlDelayLines.length > 0) {
    out.push({
      verdict: 'auto-remove-crawl-delay',
      severity: 'informational',
      detail: `crawl-delay ignored by Google (R26) — safe to remove (${inspection.crawlDelayLines.length} line(s))`,
      autoFixable: true,
    })
  }

  if (inspection.noindexLines.length > 0) {
    out.push({
      verdict: 'human-review-noindex-in-robots',
      severity: 'high',
      detail:
        'noindex in robots.txt unsupported since 2019 (R9) — propose removal + real page noindex together',
      autoFixable: false,
    })
  }

  if (inspection.exceedsSizeLimit) {
    out.push({
      verdict: 'human-review-size-limit',
      severity: 'high',
      detail: `Exceeds 500 KiB (${inspection.byteLength} bytes) — rules past limit ignored (R24)`,
      autoFixable: false,
    })
  }

  if (inspection.malformedLines.length > 0) {
    out.push({
      verdict: 'human-review-malformed',
      severity: 'moderate',
      detail: `${inspection.malformedLines.length} malformed line(s) — correcting changes crawl permissions`,
      autoFixable: false,
    })
  }

  if (out.length === 0) {
    out.push({
      verdict: 'ok',
      severity: null,
      detail: 'Valid robots.txt',
      autoFixable: false,
    })
  }

  return out
}

export async function detectRobotsTxtIssues(
  options: DetectTopic22Options,
): Promise<DetectTopic22Result> {
  const inspection =
    options.inspection ??
    (await fetchAndInspectRobotsTxt(options.originUrl, options.deps))

  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/robots.ts',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })

  const classified = classifyRobotsTxtInspection(inspection)
  const findings: Topic22Finding[] = classified
    .filter((c) => c.verdict !== 'ok' && c.verdict !== 'suppress-404-normal')
    .map((c) => ({
      kind: 'robots/invalid-or-unreachable' as const,
      verdict: c.verdict,
      severity: c.severity,
      detail: c.detail,
      inspection,
      autoFixable: c.autoFixable,
      fixTarget,
    }))

  // Always retain suppress-404 in findings list as suppressed-style for fixtures
  const suppressed = classified.filter(
    (c) => c.verdict === 'suppress-404-normal' || c.verdict === 'ok',
  )
  for (const s of suppressed) {
    if (s.verdict === 'suppress-404-normal') {
      findings.push({
        kind: 'robots/invalid-or-unreachable',
        verdict: s.verdict,
        severity: null,
        detail: s.detail,
        inspection,
        autoFixable: false,
        fixTarget,
      })
    }
  }

  return { findings, inspection }
}

export { inspectRobotsTxtBody, fetchAndInspectRobotsTxt }
