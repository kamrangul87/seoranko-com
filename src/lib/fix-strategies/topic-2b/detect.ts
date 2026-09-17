/**
 * Topic 2b — potential soft 404 (observation only).
 *
 * Text matching for error phrases is REJECTED. Report as "potential soft 404",
 * never "soft 404". Structural emptiness signals only — no phrase classifiers.
 */

import {
  checkRepoDeclaredNoindex,
  type NoindexDeclaration,
} from '@/lib/fix-strategies/shared/repo-declared-noindex'
import { parseHtml } from '@/lib/fix-strategies/shared/html-parser'
import { presenceAfterServedHtml } from '@/lib/fix-strategies/fetch/content-presence'

export type Topic2bVerdict =
  | 'observation-potential-soft-404'
  | 'suppress-repo-declared-noindex'
  | 'suppress-availability-5xx'
  | 'suppress-not-200'
  | 'client-only-pre-hydration'
  | 'human-review-conditional-noindex'
  | 'ok'

export type Topic2bFinding = {
  kind: 'soft-404/potential'
  verdict: Topic2bVerdict
  /** Always null — never a defect severity for unprovable 2b. */
  severity: null
  pageUrl: string
  /** Must say "potential soft 404", never "soft 404". */
  detail: string
  autoFixable: false
  /** Structural signals only — never matched error phrases. */
  structuralSignals: string[]
}

export type DetectTopic2bResult = {
  findings: Topic2bFinding[]
  suppressed: Array<{ verdict: Topic2bVerdict; detail: string }>
}

export type DetectTopic2bOptions = {
  pageUrl: string
  status: number | null
  html: string
  /**
   * Topic 70 discriminator. When omitted and routeFile/appDir given, computed.
   */
  repoNoindex?: NoindexDeclaration | null
  routeFile?: string | null
  appDir?: string | null
  /**
   * True when the page is known to render main content only after hydration
   * (topic 67). Do not treat pre-hydration emptiness as potential soft 404.
   */
  contentClientOnly?: boolean
}

/**
 * Visible text length in body, excluding script/style. Structural only.
 */
export function structuralBodyTextLength(html: string): number {
  const parsed = parseHtml(html)
  let total = 0
  for (const tag of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'article', 'main', 'section']) {
    for (const el of parsed.bodyElements(tag)) {
      total += (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
    }
  }
  // Fallback: body text if no block elements
  if (total === 0) {
    for (const el of parsed.bodyElements('body')) {
      total += (el.textContent ?? '').replace(/\s+/g, ' ').trim().length
    }
  }
  return total
}

/** Rejected — never implement phrase matching. */
export function rejectedTextMatchErrorPhrases(): never {
  throw new Error(
    'topic 2b: text matching for error phrases is rejected — never search for "page not found" etc.',
  )
}

/** Rejected — never claim Google's soft-404 classification. */
export function rejectedClaimSoft404Classifier(): never {
  throw new Error(
    'topic 2b: report "potential soft 404" only — product does not reproduce Google\'s classifier',
  )
}

export function detectPotentialSoft404(
  options: DetectTopic2bOptions,
): DetectTopic2bResult {
  const findings: Topic2bFinding[] = []
  const suppressed: DetectTopic2bResult['suppressed'] = []

  if (options.status != null && options.status >= 500) {
    suppressed.push({
      verdict: 'suppress-availability-5xx',
      detail: 'Availability problem — never this finding (topic 3 / 68)',
    })
    return { findings, suppressed }
  }

  if (options.status != null && options.status !== 200) {
    suppressed.push({
      verdict: 'suppress-not-200',
      detail: `Status ${options.status} is not a soft-404 candidate`,
    })
    return { findings, suppressed }
  }

  let repoNoindex = options.repoNoindex ?? null
  if (
    repoNoindex == null &&
    options.routeFile &&
    options.appDir
  ) {
    repoNoindex = checkRepoDeclaredNoindex(options.routeFile, options.appDir)
  }

  if (repoNoindex === 'true') {
    suppressed.push({
      verdict: 'suppress-repo-declared-noindex',
      detail: 'Repo declares noindex — valid deliberately excluded page',
    })
    return { findings, suppressed }
  }

  if (repoNoindex === 'indeterminate') {
    findings.push({
      kind: 'soft-404/potential',
      verdict: 'human-review-conditional-noindex',
      severity: null,
      pageUrl: options.pageUrl,
      detail:
        'generateMetadata may set robots conditionally — indeterminate (human-review)',
      autoFixable: false,
      structuralSignals: [],
    })
    return { findings, suppressed }
  }

  if (options.contentClientOnly) {
    const presence = presenceAfterServedHtml(false)
    findings.push({
      kind: 'soft-404/potential',
      verdict: 'client-only-pre-hydration',
      severity: null,
      pageUrl: options.pageUrl,
      detail: `Pre-hydration HTML empty (${presence}) — do not assess as potential soft 404 (topic 67)`,
      autoFixable: false,
      structuralSignals: ['client_only'],
    })
    return { findings, suppressed }
  }

  const textLen = structuralBodyTextLength(options.html)
  const signals: string[] = []
  if (textLen === 0) signals.push('body-block-text-empty')
  else if (textLen < 40) signals.push(`body-block-text-very-short:${textLen}`)

  const hasMain = parseHtml(options.html).bodyElements('main').length > 0
  if (!hasMain && textLen < 40) signals.push('no-main-landmark')

  if (signals.length === 0) {
    return { findings, suppressed }
  }

  findings.push({
    kind: 'soft-404/potential',
    verdict: 'observation-potential-soft-404',
    severity: null,
    pageUrl: options.pageUrl,
    detail: `Observation: potential soft 404 — 200 with structurally sparse content (${signals.join(', ')}). Not Google's soft-404 classifier.`,
    autoFixable: false,
    structuralSignals: signals,
  })

  return { findings, suppressed }
}
