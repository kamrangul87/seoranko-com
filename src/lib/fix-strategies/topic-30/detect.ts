/**
 * Topic 30 — title missing or malformed.
 *
 * NO LENGTH THRESHOLDS. A 200-character title is not a finding (H9).
 * Writing title text is content generation — out of bounds.
 * Auto-fix only: remove identical duplicate <title> elements.
 */

import type { HeadInspection } from '@/lib/fix-strategies/shared/head-inspect'
import {
  hasNoindexDirective,
  isSelfCanonical,
  extractHtmlCanonical,
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic30Verdict =
  | 'ok'
  | 'human-review-missing'
  | 'human-review-empty'
  | 'auto-remove-identical-duplicates'
  | 'human-review-differing-duplicates'
  | 'route-topic-29'
  | 'suppress-not-indexable'
  | 'suppress-iframe-srcdoc'
  | 'indeterminate-generateMetadata'
  /** Product-decision display warning only — never a Google defect. */
  | 'product-display-truncation-warning'

export type Topic30Finding = {
  kind: 'head/title-missing-or-malformed'
  verdict: Topic30Verdict
  severity: 'high' | null
  detail: string
  autoFixable: boolean
  /** Candidate from primary heading — proposal only, never applied. */
  proposedFromHeading: string | null
  fixTarget: FixTargetResult
  /**
   * True when this row is a product display-truncation warning (not a defect).
   * Never attribute to Google (H9).
   */
  isProductDecisionOnly: boolean
}

export type DetectTopic30Result = {
  findings: Topic30Finding[]
  suppressed: Array<{ verdict: Topic30Verdict; detail: string }>
}

export type DetectTopic30Page = {
  inspection: HeadInspection
  status200?: boolean
  headers?: Headers
  body?: string
  contentType?: string | null
  iframeSrcdoc?: boolean
  generateMetadataIndeterminate?: boolean
}

export type DetectTopic30Options = {
  page: DetectTopic30Page
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function detectTitleMissingOrMalformed(
  options: DetectTopic30Options,
): DetectTopic30Result {
  const findings: Topic30Finding[] = []
  const suppressed: DetectTopic30Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/page.tsx',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })
  const page = options.page
  const insp = page.inspection

  const row = (
    verdict: Topic30Verdict,
    detail: string,
    autoFixable: boolean,
    proposed: string | null = null,
  ): Topic30Finding => ({
    kind: 'head/title-missing-or-malformed',
    verdict,
    severity: verdict.startsWith('suppress') || verdict === 'ok' ? null : 'high',
    detail,
    autoFixable,
    proposedFromHeading: proposed,
    fixTarget,
    isProductDecisionOnly: false,
  })

  if (page.iframeSrcdoc) {
    suppressed.push({
      verdict: 'suppress-iframe-srcdoc',
      detail: 'iframe srcdoc may omit title (H7)',
    })
    return { findings, suppressed }
  }

  if (page.generateMetadataIndeterminate) {
    findings.push(
      row(
        'indeterminate-generateMetadata',
        'generateMetadata sets title conditionally — indeterminate',
        false,
      ),
    )
    return { findings, suppressed }
  }

  // Indexable check
  const status200 = page.status200 !== false
  const body = page.body ?? ''
  const headers = page.headers ?? new Headers()
  const ct = page.contentType ?? 'text/html'
  const noindex = body
    ? hasNoindexDirective(headers, body, ct)
    : false
  const canonical = body
    ? extractHtmlCanonical(body, insp.pageUrl, ct)
    : null
  const selfCanon = !body || isSelfCanonical(insp.pageUrl, canonical)

  if (!status200 || noindex || !selfCanon) {
    suppressed.push({
      verdict: 'suppress-not-indexable',
      detail: 'Not an indexable page — never raise title findings',
    })
    return { findings, suppressed }
  }

  // Topic 29: title only in body after premature close
  if (
    insp.titlesInHead.length === 0 &&
    insp.titlesInBody.length > 0 &&
    insp.prematureClose.detected
  ) {
    findings.push(
      row(
        'route-topic-29',
        'title only in body after premature <head> close — topic 29 first',
        false,
      ),
    )
    return { findings, suppressed }
  }

  const titles = insp.titlesInHead
  if (titles.length === 0) {
    findings.push(
      row(
        'human-review-missing',
        'No <title> in <head> (parser view). Scaffold from heading requires human approval — no model writes titles.',
        false,
        insp.primaryHeading,
      ),
    )
    return { findings, suppressed }
  }

  if (titles.length === 1) {
    if (titles[0]!.normalized === '') {
      findings.push(
        row(
          'human-review-empty',
          'Empty or whitespace-only <title>. Scaffold requires human approval.',
          false,
          insp.primaryHeading,
        ),
      )
      return { findings, suppressed }
    }
    // Long titles are NOT a defect (H9). Produce nothing.
    suppressed.push({
      verdict: 'ok',
      detail: 'Exactly one non-empty title — length is never a threshold (H9)',
    })
    return { findings, suppressed }
  }

  // Multiple titles
  const norms = titles.map((t) => t.normalized)
  const allIdentical = norms.every((n) => n === norms[0])
  if (allIdentical) {
    findings.push(
      row(
        'auto-remove-identical-duplicates',
        `Identical duplicate <title> ×${titles.length} — keep one, remove extras`,
        true,
      ),
    )
  } else {
    findings.push(
      row(
        'human-review-differing-duplicates',
        'Differing duplicate <title> elements — intent unknown; propose, do not apply',
        false,
      ),
    )
  }

  return { findings, suppressed }
}

/** REJECTED — no model authors title text. */
export function rejectedGenerateTitleText(): never {
  throw new Error(
    'REJECTED: writing title text is content generation and is out of bounds',
  )
}
