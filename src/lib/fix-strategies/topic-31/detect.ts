/**
 * Topic 31 — meta description missing / duplicate / empty.
 *
 * A MISSING description is NOT a defect — informational only (H14, H16).
 * Real findings: more than one, or empty.
 * NO LENGTH THRESHOLDS (H15).
 * Do NOT apply Open Graph "first wins" (H22) — HTML has no documented
 * resolution rule for differing duplicates (H30).
 */

import type { HeadInspection } from '@/lib/fix-strategies/shared/head-inspect'
import {
  hasNoindexDirective,
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic31Verdict =
  | 'ok'
  | 'informational-missing'
  | 'auto-remove-identical-duplicates'
  | 'human-review-differing-duplicates'
  | 'auto-remove-empty'
  | 'route-topic-29'
  | 'route-topic-33-sitewide'
  | 'suppress-not-indexable'

export type Topic31Finding = {
  kind: 'head/meta-description'
  verdict: Topic31Verdict
  severity: 'high' | 'moderate' | 'informational' | null
  detail: string
  autoFixable: boolean
  /** Never encode OG first-wins for HTML descriptions. */
  usesOgFirstWins: false
  fixTarget: FixTargetResult
}

export type DetectTopic31Result = {
  findings: Topic31Finding[]
  informational: Topic31Finding[]
  suppressed: Array<{ verdict: Topic31Verdict; detail: string }>
}

export type DetectTopic31Page = {
  inspection: HeadInspection
  status200?: boolean
  headers?: Headers
  body?: string
  contentType?: string | null
  /** Description identical site-wide → topic 33. */
  sitewideIdentical?: boolean
}

export type DetectTopic31Options = {
  page: DetectTopic31Page
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function detectMetaDescriptionIssues(
  options: DetectTopic31Options,
): DetectTopic31Result {
  const findings: Topic31Finding[] = []
  const informational: Topic31Finding[] = []
  const suppressed: DetectTopic31Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/page.tsx',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })
  const page = options.page
  const insp = page.inspection

  const make = (
    verdict: Topic31Verdict,
    severity: Topic31Finding['severity'],
    detail: string,
    autoFixable: boolean,
  ): Topic31Finding => ({
    kind: 'head/meta-description',
    verdict,
    severity,
    detail,
    autoFixable,
    usesOgFirstWins: false,
    fixTarget,
  })

  const status200 = page.status200 !== false
  const body = page.body ?? ''
  const headers = page.headers ?? new Headers()
  const ct = page.contentType ?? 'text/html'
  if (!status200 || (body && hasNoindexDirective(headers, body, ct))) {
    suppressed.push({
      verdict: 'suppress-not-indexable',
      detail: 'Not indexable — never raise',
    })
    return { findings, informational, suppressed }
  }

  if (
    insp.descriptionsInHead.length === 0 &&
    insp.descriptionsInBody.length > 0 &&
    insp.prematureClose.detected
  ) {
    findings.push(
      make(
        'route-topic-29',
        null,
        'description only in body after premature <head> close — topic 29',
        false,
      ),
    )
    return { findings, informational, suppressed }
  }

  if (page.sitewideIdentical && insp.descriptionsInHead.length >= 1) {
    findings.push(
      make(
        'route-topic-33-sitewide',
        'moderate',
        'Description identical site-wide — belongs to topic 33 (H17)',
        false,
      ),
    )
    return { findings, informational, suppressed }
  }

  const descs = insp.descriptionsInHead

  if (descs.length === 0) {
    // Missing is NOT a defect
    informational.push(
      make(
        'informational-missing',
        'informational',
        'No meta description — not a defect (H14, H16). Google may generate snippets from content.',
        false,
      ),
    )
    return { findings, informational, suppressed }
  }

  if (descs.length === 1) {
    if (descs[0]!.normalized === '') {
      findings.push(
        make(
          'auto-remove-empty',
          'moderate',
          'Empty meta description — remove to restore Google default snippet behaviour',
          true,
        ),
      )
      return { findings, informational, suppressed }
    }
    // Long descriptions are NOT a defect (H15)
    suppressed.push({
      verdict: 'ok',
      detail:
        'Single non-empty description — length is never a threshold (H15); programmatic page-specific is fine (H18)',
    })
    return { findings, informational, suppressed }
  }

  // More than one (case-insensitive name already folded in collection)
  const norms = descs.map((d) => d.normalized)
  const allIdentical = norms.every((n) => n === norms[0])
  if (allIdentical) {
    findings.push(
      make(
        'auto-remove-identical-duplicates',
        'high',
        `Identical duplicate meta descriptions ×${descs.length} — remove extras (H4)`,
        true,
      ),
    )
  } else {
    findings.push(
      make(
        'human-review-differing-duplicates',
        'high',
        'Differing duplicate meta descriptions — no documented HTML resolution rule (H30). Do not apply OG first-wins. Propose, do not apply.',
        false,
      ),
    )
  }

  return { findings, informational, suppressed }
}

export function rejectedGenerateDescriptionText(): never {
  throw new Error(
    'REJECTED: writing description text is content generation and is out of bounds',
  )
}

export function rejectedOgFirstWinsForHtmlDescription(): never {
  throw new Error(
    'REJECTED: do not apply Open Graph first-declaration-wins to HTML meta descriptions (H30 ≠ H22)',
  )
}
