/**
 * Topic 28 — sitemap not referenced in robots.txt.
 *
 * NOT a defect. Informational discoverability gap only. Never create a
 * robots.txt just to add the record — a 404 robots.txt is normal.
 * Classifies from SitemapInspection.
 */

import {
  type SitemapInspection,
} from '@/lib/fix-strategies/shared/sitemap-inspect'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic28Verdict =
  | 'ok'
  | 'informational-unreferenced'
  | 'informational-robots-404-with-sitemap'
  | 'suppress-no-sitemap'
  | 'suppress-index-declares-children'
  | 'suppress-record-present'
  | 'suppress-multiple-records-ok'
  | 'route-topic-22-robots-unreachable'
  | 'route-topic-24-relative-or-broken'

export type Topic28Finding = {
  kind: 'sitemap/not-referenced-in-robots'
  verdict: Topic28Verdict
  severity: 'informational' | 'low' | null
  sitemapUrl: string | null
  detail: string
  /** Auto-fixable only when robots.txt already exists and is editable. */
  autoFixable: boolean
  /** Never propose creating robots.txt solely for this. */
  proposeCreateRobotsTxt: false
  searchConsoleUncertainty: true
  fixTarget: FixTargetResult
}

export type DetectTopic28Result = {
  findings: Topic28Finding[]
  informational: Topic28Finding[]
  suppressed: Array<{ verdict: Topic28Verdict; detail: string }>
}

export type DetectTopic28Options = {
  inspection: SitemapInspection
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export function detectSitemapNotReferencedInRobots(
  options: DetectTopic28Options,
): DetectTopic28Result {
  const { inspection } = options
  const findings: Topic28Finding[] = []
  const informational: Topic28Finding[] = []
  const suppressed: DetectTopic28Result['suppressed'] = []

  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/robots.ts',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })

  const base = (
    verdict: Topic28Verdict,
    severity: Topic28Finding['severity'],
    detail: string,
    sitemapUrl: string | null,
    autoFixable: boolean,
  ): Topic28Finding => ({
    kind: 'sitemap/not-referenced-in-robots',
    verdict,
    severity,
    sitemapUrl,
    detail,
    autoFixable,
    proposeCreateRobotsTxt: false,
    searchConsoleUncertainty: true,
    fixTarget,
  })

  if (
    inspection.robots.fetchStatus === 'server-error' ||
    inspection.robots.fetchStatus === 'transient-5xx'
  ) {
    findings.push(
      base(
        'route-topic-22-robots-unreachable',
        null,
        'robots.txt unreachable — topic 22 first',
        null,
        false,
      ),
    )
    return { findings, informational, suppressed }
  }

  // Relative / broken declarations belong to topic 24
  for (const decl of inspection.declarations) {
    if (decl.kind === 'relative') {
      findings.push(
        base(
          'route-topic-24-relative-or-broken',
          null,
          'Relative Sitemap: URL — topic 24',
          decl.record.value,
          false,
        ),
      )
    }
  }

  const robots404 = inspection.robots.fetchStatus === 'not-found'
  const hasRecords = inspection.declarations.length > 0

  // Reachable sitemaps (declared OK or discovered)
  const reachable = inspection.documents.filter(
    (d) => d.fetchOutcome === 'ok' && d.parsed != null,
  )

  if (reachable.length === 0 && inspection.discoveredUnreferenced.length === 0) {
    suppressed.push({
      verdict: 'suppress-no-sitemap',
      detail: 'No sitemap exists — nothing to declare',
    })
    return { findings, informational, suppressed }
  }

  if (hasRecords) {
    // Index-only declaration is sufficient (S21)
    const declaresIndex = inspection.documents.some(
      (d) =>
        d.origin === 'robots-declaration' &&
        d.parsed?.kind === 'sitemapindex' &&
        d.fetchOutcome === 'ok',
    )
    if (declaresIndex) {
      suppressed.push({
        verdict: 'suppress-index-declares-children',
        detail:
          'Sitemap index declared — children need not be listed (S21)',
      })
    }

    if (inspection.declarations.length > 1) {
      suppressed.push({
        verdict: 'suppress-multiple-records-ok',
        detail: 'Multiple Sitemap: records permitted (S20)',
      })
    }

    // Record inside UA group is still valid (S19) — already collected
    suppressed.push({
      verdict: 'suppress-record-present',
      detail: 'Sitemap: record present (group-independent per S19)',
    })
    return { findings, informational, suppressed }
  }

  // No Sitemap: record
  const unreferenced =
    inspection.discoveredUnreferenced.length > 0
      ? inspection.discoveredUnreferenced
      : reachable
          .filter((d) => d.origin === 'discovered')
          .map((d) => d.url)

  // Also: conventional path present in documents as discovered
  const targets =
    unreferenced.length > 0
      ? unreferenced
      : reachable.map((d) => d.url)

  if (targets.length === 0) {
    suppressed.push({
      verdict: 'suppress-no-sitemap',
      detail: 'No unreferenced reachable sitemap',
    })
    return { findings, informational, suppressed }
  }

  for (const url of targets) {
    const row = base(
      robots404
        ? 'informational-robots-404-with-sitemap'
        : 'informational-unreferenced',
      'informational',
      robots404
        ? `Reachable sitemap ${url} with robots.txt 404 — informational only. Search Console submission is invisible. Never create robots.txt solely to add Sitemap:.`
        : `Reachable sitemap ${url} has no Sitemap: record — discoverability gap only (S23). Search Console submission may exist (invisible to crawl).`,
      url,
      // Auto-fix only when robots.txt already exists (not 404)
      !robots404,
    )
    informational.push(row)
  }

  return { findings, informational, suppressed }
}

export {
  proposeAddSitemapRecord,
  applyAddSitemapRecord,
  rejectedCreateRobotsTxtForSitemap,
} from './fix-add-sitemap-record'
