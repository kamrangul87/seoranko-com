/**
 * Topic 15 — canonical points to a noindexed target.
 *
 * Topic 70 discriminator is MANDATORY:
 * - repo-declared noindex → this finding (always human-review)
 * - injected noindex → topic 14 (dead target)
 * - conditional generateMetadata → indeterminate
 *
 * Never auto-remove a deliberate noindex.
 */

import {
  extractCanonicalDeclarations,
  hasNoindexDirective,
  normalizeFixStrategyUrl,
  type CanonicalExtraction,
} from '@/lib/fix-strategies/shared'
import type { NoindexDeclaration } from '@/lib/fix-strategies/shared/repo-declared-noindex'
import {
  extractPageRobotsDirectives,
  setHasNoindex,
} from '@/lib/fix-strategies/shared/robots-directives'

export type Topic15Verdict =
  | 'human-review-repo-noindex-contradiction'
  | 'route-topic-14-injected'
  | 'report-layout-cascade-source'
  | 'route-topic-20-directive-conflict'
  | 'human-review-indeterminate'
  | 'suppress-healthy-target'
  | 'suppress-target-not-200'
  | 'route-topic-18-cross-domain'

export type Topic15Finding = {
  kind: 'canonical/points-to-noindexed'
  verdict: Topic15Verdict
  severity: 'high' | null
  pageUrl: string
  canonicalUrl: string | null
  detail: string
  autoFixable: false
  /** Layout/cascade file when noindex comes from above the page. */
  cascadeSource: string | null
  proposals: Array<'remove-noindex-from-target' | 'repoint-or-self-canonical'>
}

export type DetectTopic15Result = {
  findings: Topic15Finding[]
  suppressed: Array<{ verdict: Topic15Verdict; detail: string }>
  extraction: CanonicalExtraction | null
}

export type DetectTopic15Target = {
  url: string
  status: number
  html: string
  headers?: Headers
  contentType?: string | null
  /** Topic 70 on the target route. */
  repoNoindex: NoindexDeclaration
  /** When noindex comes from a parent layout.tsx */
  noindexCascadeSource?: string | null
  crossDomain?: boolean
}

export type DetectTopic15Options = {
  pageUrl: string
  html: string
  headers?: Headers
  contentType?: string | null
  target: DetectTopic15Target | null
}

function metaNoindex(html: string, headers: Headers): boolean {
  return hasNoindexDirective(headers, html, 'text/html')
}

function headerMetaDisagree(
  html: string,
  headers: Headers,
): boolean {
  const page = extractPageRobotsDirectives(headers, html, 'text/html')
  if (!page.metaRobots || page.xRobotsTags.length === 0) return false
  const headerNo = page.xRobotsTags.some((x) => setHasNoindex(x.tokens))
  const metaNo = setHasNoindex(page.metaRobots.tokens)
  return headerNo !== metaNo
}

/** Never auto-remove deliberate noindex. */
export function rejectedAutoRemoveNoindex(): never {
  throw new Error(
    'topic 15: never auto-remove repo-declared noindex — always human-review',
  )
}

export function detectCanonicalPointsToNoindexed(
  options: DetectTopic15Options,
): DetectTopic15Result {
  const findings: Topic15Finding[] = []
  const suppressed: DetectTopic15Result['suppressed'] = []
  const headers = options.headers ?? new Headers()
  const extraction = extractCanonicalDeclarations(
    options.html,
    headers,
    options.pageUrl,
    options.contentType ?? 'text/html',
  )

  const decl =
    extraction.effectiveHead ??
    (extraction.header.length === 1 ? extraction.header[0]! : null)

  if (!decl?.normalized) {
    return { findings, suppressed, extraction }
  }

  const target = options.target
  if (!target) {
    return { findings, suppressed, extraction }
  }

  const targetNorm =
    normalizeFixStrategyUrl(target.url, options.pageUrl) ?? target.url
  if (decl.normalized !== targetNorm) {
    // Caller should pass the resolved target; still proceed if they match loosely
  }

  if (target.crossDomain) {
    findings.push({
      kind: 'canonical/points-to-noindexed',
      verdict: 'route-topic-18-cross-domain',
      severity: null,
      pageUrl: options.pageUrl,
      canonicalUrl: decl.normalized,
      detail: 'Cross-domain canonical target — topic 18; crawler may not see real directives',
      autoFixable: false,
      cascadeSource: null,
      proposals: [],
    })
    return { findings, suppressed, extraction }
  }

  if (target.status !== 200) {
    suppressed.push({
      verdict: 'suppress-target-not-200',
      detail: `Target status ${target.status} — not this finding`,
    })
    return { findings, suppressed, extraction }
  }

  const tHeaders = target.headers ?? new Headers()
  if (headerMetaDisagree(target.html, tHeaders)) {
    findings.push({
      kind: 'canonical/points-to-noindexed',
      verdict: 'route-topic-20-directive-conflict',
      severity: 'high',
      pageUrl: options.pageUrl,
      canonicalUrl: decl.normalized,
      detail: 'X-Robots-Tag and meta robots disagree on target — topic 20 first',
      autoFixable: false,
      cascadeSource: null,
      proposals: [],
    })
    return { findings, suppressed, extraction }
  }

  if (!metaNoindex(target.html, tHeaders)) {
    suppressed.push({
      verdict: 'suppress-healthy-target',
      detail: 'Canonical target is 200 and indexable',
    })
    return { findings, suppressed, extraction }
  }

  // Target has noindex — topic 70 discriminator
  if (target.repoNoindex === 'false') {
    findings.push({
      kind: 'canonical/points-to-noindexed',
      verdict: 'route-topic-14-injected',
      severity: 'high',
      pageUrl: options.pageUrl,
      canonicalUrl: decl.normalized,
      detail: 'Target noindex is injected, not repo-declared — topic 14 (dead target)',
      autoFixable: false,
      cascadeSource: null,
      proposals: [],
    })
    return { findings, suppressed, extraction }
  }

  if (target.repoNoindex === 'indeterminate') {
    findings.push({
      kind: 'canonical/points-to-noindexed',
      verdict: 'human-review-indeterminate',
      severity: 'high',
      pageUrl: options.pageUrl,
      canonicalUrl: decl.normalized,
      detail: 'Target generateMetadata sets robots conditionally — indeterminate',
      autoFixable: false,
      cascadeSource: null,
      proposals: [
        'remove-noindex-from-target',
        'repoint-or-self-canonical',
      ],
    })
    return { findings, suppressed, extraction }
  }

  // repo declares noindex — this finding
  if (target.noindexCascadeSource) {
    findings.push({
      kind: 'canonical/points-to-noindexed',
      verdict: 'report-layout-cascade-source',
      severity: 'high',
      pageUrl: options.pageUrl,
      canonicalUrl: decl.normalized,
      detail: `Canonical points at repo-noindex target; noindex cascades from ${target.noindexCascadeSource}`,
      autoFixable: false,
      cascadeSource: target.noindexCascadeSource,
      proposals: [
        'remove-noindex-from-target',
        'repoint-or-self-canonical',
      ],
    })
    return { findings, suppressed, extraction }
  }

  findings.push({
    kind: 'canonical/points-to-noindexed',
    verdict: 'human-review-repo-noindex-contradiction',
    severity: 'high',
    pageUrl: options.pageUrl,
    canonicalUrl: decl.normalized,
    detail:
      'Canonical points at a repo-declared noindex URL — contradictory configuration. Human must choose: make target indexable, or repoint/self-canonical.',
    autoFixable: false,
    cascadeSource: null,
    proposals: [
      'remove-noindex-from-target',
      'repoint-or-self-canonical',
    ],
  })

  return { findings, suppressed, extraction }
}
