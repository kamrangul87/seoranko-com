/**
 * Topic 29 — non-metadata content in <head> (premature head close).
 *
 * Severity depends on WHAT FOLLOWS the offender (casualties). Canonical after
 * it → critical; robots meta after it → low (R8). Empty casualty list →
 * informational. Uses parser view from HeadInspection — never source regex.
 */

import type { HeadInspection, HeadCasualty } from '@/lib/fix-strategies/shared/head-inspect'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic29Verdict =
  | 'ok'
  | 'critical-canonical-casualty'
  | 'critical-hreflang-casualty'
  | 'high-description-casualty'
  | 'moderate-og-casualty'
  | 'low-robots-casualty'
  | 'informational-no-casualty'
  | 'suppress-post-hydration'
  | 'suppress-iframe-srcdoc'

export type Topic29Finding = {
  kind: 'head/tags-outside-head'
  verdict: Topic29Verdict
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'informational' | null
  offenderTag: string | null
  casualties: HeadCasualty['kind'][]
  detail: string
  autoFixable: boolean
  fixTarget: FixTargetResult
}

export type DetectTopic29Result = {
  findings: Topic29Finding[]
  suppressed: Array<{ verdict: Topic29Verdict; detail: string }>
}

export type DetectTopic29Options = {
  inspection: HeadInspection
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /** Shared layout / third-party injection → human-review. */
  sharedInjection?: boolean
  postHydrationOnly?: boolean
  iframeSrcdoc?: boolean
}

function severityFromCasualties(casualties: HeadCasualty[]): {
  verdict: Topic29Verdict
  severity: Topic29Finding['severity']
} {
  const kinds = new Set(casualties.map((c) => c.kind))
  if (kinds.has('canonical')) {
    return { verdict: 'critical-canonical-casualty', severity: 'critical' }
  }
  if (kinds.has('hreflang')) {
    return { verdict: 'critical-hreflang-casualty', severity: 'critical' }
  }
  if (kinds.has('meta-description') || kinds.has('title')) {
    return { verdict: 'high-description-casualty', severity: 'high' }
  }
  if (kinds.has('og-or-twitter')) {
    return { verdict: 'moderate-og-casualty', severity: 'moderate' }
  }
  if (kinds.has('robots-meta') || kinds.has('other-metadata')) {
    // Robots-only → low (R8). other-metadata alone also low.
    if (kinds.has('robots-meta') && kinds.size === 1) {
      return { verdict: 'low-robots-casualty', severity: 'low' }
    }
    if (kinds.has('robots-meta')) {
      return { verdict: 'low-robots-casualty', severity: 'low' }
    }
    return { verdict: 'low-robots-casualty', severity: 'low' }
  }
  return { verdict: 'informational-no-casualty', severity: 'informational' }
}

export function detectTagsOutsideHead(
  options: DetectTopic29Options,
): DetectTopic29Result {
  const findings: Topic29Finding[] = []
  const suppressed: DetectTopic29Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/layout.tsx',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })

  if (options.iframeSrcdoc) {
    suppressed.push({
      verdict: 'suppress-iframe-srcdoc',
      detail: 'iframe srcdoc — different rules (H7)',
    })
    return { findings, suppressed }
  }

  if (options.postHydrationOnly) {
    suppressed.push({
      verdict: 'suppress-post-hydration',
      detail: 'Injected post-hydration — assess served HTML (topic 67)',
    })
    return { findings, suppressed }
  }

  const { prematureClose } = options.inspection
  if (!prematureClose.detected || !prematureClose.offender) {
    suppressed.push({
      verdict: 'ok',
      detail: 'No premature <head> close (parser view)',
    })
    return { findings, suppressed }
  }

  const casualties = prematureClose.casualties
  if (casualties.length === 0) {
    findings.push({
      kind: 'head/tags-outside-head',
      verdict: 'informational-no-casualty',
      severity: 'informational',
      offenderTag: prematureClose.offender.tagName,
      casualties: [],
      detail: `<${prematureClose.offender.tagName}> closed <head> early but nothing followed — informational only`,
      autoFixable: false,
      fixTarget,
    })
    return { findings, suppressed }
  }

  const { verdict, severity } = severityFromCasualties(casualties)
  const autoFixable =
    !options.sharedInjection &&
    fixTarget.action === 'fix-artefact' &&
    casualties.length > 0

  findings.push({
    kind: 'head/tags-outside-head',
    verdict,
    severity,
    offenderTag: prematureClose.offender.tagName,
    casualties: casualties.map((c) => c.kind),
    detail: `<${prematureClose.offender.tagName}> closed <head>; casualties: ${casualties
      .map((c) => c.kind)
      .join(', ')}. Severity from casualty list (C2 vs R8 asymmetry).`,
    autoFixable,
    fixTarget,
  })

  return { findings, suppressed }
}
