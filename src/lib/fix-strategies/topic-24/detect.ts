/**
 * Topic 24 — sitemap missing or unreachable.
 *
 * An ABSENT sitemap is not a defect. Finding requires a DECLARED sitemap
 * that fails (relative URL, 4xx, persistent 5xx, non-XML). Never generate
 * a sitemap where none exists.
 *
 * Classifies from a shared SitemapInspection — do not re-fetch.
 */

import {
  type SitemapInspection,
  type SitemapDocument,
  type SitemapDeclaration,
} from '@/lib/fix-strategies/shared/sitemap-inspect'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic24Verdict =
  | 'ok'
  | 'suppress-no-declaration'
  | 'auto-absolutize-relative'
  | 'auto-repoint-redirect'
  | 'human-review-declared-4xx'
  | 'not-mechanically-fixable-5xx'
  | 'route-topic-3-transient-5xx'
  | 'human-review-non-xml'
  | 'route-topic-22-robots-unreachable'

export type Topic24Finding = {
  kind: 'sitemap/missing-or-unreachable'
  verdict: Topic24Verdict
  severity: 'high' | 'moderate' | null
  sitemapUrl: string | null
  detail: string
  autoFixable: boolean
  /** Absolute rewrite when verdict is auto-absolutize-relative. */
  proposedAbsoluteUrl?: string
  /** Final URL when auto-repoint-redirect. */
  proposedRepointUrl?: string
  fixTarget: FixTargetResult
}

export type DetectTopic24Result = {
  findings: Topic24Finding[]
  suppressed: Array<{ verdict: Topic24Verdict; detail: string }>
}

export type DetectTopic24Options = {
  inspection: SitemapInspection
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /** Origin used to absolutize relative Sitemap: values. */
  siteOrigin?: string
}

export function detectSitemapMissingOrUnreachable(
  options: DetectTopic24Options,
): DetectTopic24Result {
  const { inspection } = options
  const findings: Topic24Finding[] = []
  const suppressed: DetectTopic24Result['suppressed'] = []

  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/robots.ts',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })

  if (
    inspection.robots.fetchStatus === 'server-error' ||
    inspection.robots.fetchStatus === 'transient-5xx'
  ) {
    findings.push({
      kind: 'sitemap/missing-or-unreachable',
      verdict: 'route-topic-22-robots-unreachable',
      severity: null,
      sitemapUrl: null,
      detail: 'robots.txt unreachable — topic 22 first; Sitemap: cannot be read',
      autoFixable: false,
      fixTarget,
    })
    return { findings, suppressed }
  }

  if (inspection.declarations.length === 0) {
    suppressed.push({
      verdict: 'suppress-no-declaration',
      detail:
        'No Sitemap: declaration — absence is not a defect. Never generate a sitemap.',
    })
    return { findings, suppressed }
  }

  const origin =
    options.siteOrigin ??
    (() => {
      try {
        return new URL(inspection.originUrl).origin
      } catch {
        return inspection.originUrl
      }
    })()

  for (const decl of inspection.declarations) {
    classifyDeclaration(decl, inspection, origin, fixTarget, findings, suppressed)
  }

  return { findings, suppressed }
}

function classifyDeclaration(
  decl: SitemapDeclaration,
  inspection: SitemapInspection,
  origin: string,
  fixTarget: FixTargetResult,
  findings: Topic24Finding[],
  suppressed: DetectTopic24Result['suppressed'],
): void {
  if (decl.kind === 'relative') {
    let proposed: string | undefined
    try {
      proposed = new URL(decl.record.value, origin).href
    } catch {
      proposed = undefined
    }
    findings.push({
      kind: 'sitemap/missing-or-unreachable',
      verdict: 'auto-absolutize-relative',
      severity: 'high',
      sitemapUrl: decl.record.value,
      detail: 'Relative Sitemap: URL is invalid (S18) — rewrite as absolute',
      autoFixable: true,
      proposedAbsoluteUrl: proposed,
      fixTarget,
    })
    return
  }

  if (decl.kind === 'empty') {
    findings.push({
      kind: 'sitemap/missing-or-unreachable',
      verdict: 'human-review-declared-4xx',
      severity: 'high',
      sitemapUrl: null,
      detail: 'Empty Sitemap: value',
      autoFixable: false,
      fixTarget,
    })
    return
  }

  const url = decl.absoluteUrl!
  const doc = inspection.documents.find(
    (d) => d.url === url && d.origin === 'robots-declaration',
  )

  if (!doc) {
    suppressed.push({
      verdict: 'ok',
      detail: `No document for ${url}`,
    })
    return
  }

  classifyDocument(doc, fixTarget, findings, suppressed)
}

function classifyDocument(
  doc: SitemapDocument,
  fixTarget: FixTargetResult,
  findings: Topic24Finding[],
  suppressed: DetectTopic24Result['suppressed'],
): void {
  switch (doc.fetchOutcome) {
    case 'ok': {
      if (doc.redirectHops > 0 && doc.finalUrl && doc.finalUrl !== doc.url) {
        findings.push({
          kind: 'sitemap/missing-or-unreachable',
          verdict: 'auto-repoint-redirect',
          severity: 'moderate',
          sitemapUrl: doc.url,
          detail: `Declared sitemap redirects (${doc.redirectHops} hop(s)) — repoint at final URL`,
          autoFixable: true,
          proposedRepointUrl: doc.finalUrl,
          fixTarget,
        })
        return
      }
      // Healthy absolute 200 XML (or index) — nothing for topic 24
      suppressed.push({
        verdict: 'ok',
        detail: `Declared sitemap OK: ${doc.url}`,
      })
      return
    }
    case 'not-found':
      findings.push({
        kind: 'sitemap/missing-or-unreachable',
        verdict: 'human-review-declared-4xx',
        severity: 'high',
        sitemapUrl: doc.url,
        detail: doc.detail,
        autoFixable: false,
        fixTarget,
      })
      return
    case 'server-error':
    case 'unreachable':
      findings.push({
        kind: 'sitemap/missing-or-unreachable',
        verdict: 'not-mechanically-fixable-5xx',
        severity: 'high',
        sitemapUrl: doc.url,
        detail: doc.detail,
        autoFixable: false,
        fixTarget,
      })
      return
    case 'transient-5xx':
      findings.push({
        kind: 'sitemap/missing-or-unreachable',
        verdict: 'route-topic-3-transient-5xx',
        severity: null,
        sitemapUrl: doc.url,
        detail: doc.detail,
        autoFixable: false,
        fixTarget,
      })
      return
    case 'non-xml':
      findings.push({
        kind: 'sitemap/missing-or-unreachable',
        verdict: 'human-review-non-xml',
        severity: 'high',
        sitemapUrl: doc.url,
        detail: `${doc.detail} — topic 25 once a real XML body is available`,
        autoFixable: false,
        fixTarget,
      })
      return
    default:
      return
  }
}

/** REJECTED — never generate a sitemap where none exists. */
export function rejectedGenerateSitemap(): never {
  throw new Error(
    'REJECTED: never generate a sitemap where none exists — absence is not a defect',
  )
}
