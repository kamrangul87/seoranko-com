/**
 * Topic 48 — alternate target not indexable / cross-locale canonical (G22).
 *
 * x-default pointing at a redirecting or dynamically localized homepage is
 * EXPLICITLY PERMITTED (G18) — never raise.
 *
 * Locale removal is multi-file/atomic → human-review (partial removal creates
 * topic 46). Auto-fix only absolutise + single-hop redirect repoint.
 */

import {
  collectHreflangAnnotations,
  hreflangKey,
  localeTargetMap,
  type HreflangInspection,
  type CollectHreflangOptions,
} from '@/lib/fix-strategies/shared/hreflang-inspect'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'
import { isAbsoluteHttpLoc, absolutizeLoc } from '@/lib/fix-strategies/shared/sitemap-xml'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'

export type Topic48Verdict =
  | 'auto-fix-absolutize-relative'
  | 'auto-fix-repoint-redirect'
  | 'human-review-atomic-locale-removal'
  | 'human-review-repo-noindex'
  | 'human-review-robots-disallowed'
  | 'human-review-cross-locale-canonical'
  | 'finding-target-4xx'
  | 'finding-target-5xx-route-topic-3'
  | 'suppress-x-default-redirecting-homepage'
  | 'suppress-self-canonical'
  | 'suppress-healthy-sitemap-only'
  | 'suppress-cross-domain-unreachable'
  | 'ok'

export type Topic48Finding = {
  kind: 'hreflang/non-200-or-noindexed'
  verdict: Topic48Verdict
  severity: 'high' | 'moderate' | null
  sourceUrl: string
  targetUrl: string | null
  locale: string | null
  detail: string
  autoFixable: boolean
  /** Locale removal must list every cluster member URL. */
  atomicClusterUrls: string[] | null
  fixTarget: FixTargetResult
}

export type DetectTopic48Result = {
  findings: Topic48Finding[]
  suppressed: Array<{ verdict: Topic48Verdict; detail: string }>
  inspection: HreflangInspection
}

export type DetectTopic48Options = {
  inspection?: HreflangInspection
  collect?: CollectHreflangOptions
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function clusterMemberUrls(inspection: HreflangInspection): string[] {
  const set = new Set<string>()
  for (const p of inspection.pages) {
    if (p.effectiveAnnotations.length === 0) continue
    set.add(p.urlNormalized)
    for (const a of p.effectiveAnnotations) {
      if (a.hrefNormalized) set.add(a.hrefNormalized)
    }
  }
  return Array.from(set).sort()
}

function isRelativeHref(href: string): boolean {
  if (!href.trim()) return true
  try {
    // Absolute http(s)
    const u = new URL(href)
    return !(u.protocol === 'http:' || u.protocol === 'https:')
  } catch {
    return true
  }
}

function localeOfUrlInCluster(
  inspection: HreflangInspection,
  urlNorm: string,
): string | null {
  for (const page of inspection.pages) {
    const map = localeTargetMap(page.effectiveAnnotations)
    for (const [loc, target] of map) {
      if (target === urlNorm && loc !== 'x-default') return loc
    }
  }
  // Self: page's own self-annotation locale
  const page = inspection.pageByNormalizedUrl.get(urlNorm)
  if (page) {
    for (const a of page.effectiveAnnotations) {
      if (a.hrefNormalized === urlNorm && hreflangKey(a.hreflangRaw) !== 'x-default') {
        return hreflangKey(a.hreflangRaw)
      }
    }
  }
  return null
}

export function detectAlternateTargetNotIndexable(
  options: DetectTopic48Options,
): DetectTopic48Result {
  const inspection =
    options.inspection ??
    collectHreflangAnnotations(
      options.collect ?? { originUrl: 'https://example.com', pages: [] },
    )
  const findings: Topic48Finding[] = []
  const suppressed: DetectTopic48Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/i18n.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/i18n.ts',
  })
  const cluster = clusterMemberUrls(inspection)
  const seen = new Set<string>()

  for (const page of inspection.pages) {
    for (const a of page.effectiveAnnotations) {
      const dedupe = `${page.urlNormalized}|${a.hreflangRaw}|${a.hrefRaw}|${a.method}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)

      const locale = a.hreflangRaw
      const isXDefault = hreflangKey(locale) === 'x-default'

      // Relative URL (G3)
      if (isRelativeHref(a.hrefRaw) || !isAbsoluteHttpLoc(a.hrefRaw)) {
        // Still try absolutize for auto-fix
        const abs =
          a.hrefNormalized ??
          absolutizeLoc(a.hrefRaw, page.url) ??
          normalizeFixStrategyUrl(a.hrefRaw, page.url)
        findings.push({
          kind: 'hreflang/non-200-or-noindexed',
          verdict: 'auto-fix-absolutize-relative',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: abs,
          locale,
          detail: `Relative alternate URL must be fully qualified (G3): ${a.hrefRaw}`,
          autoFixable: abs != null && isAbsoluteHttpLoc(abs),
          atomicClusterUrls: null,
          fixTarget,
        })
        continue
      }

      if (!a.hrefNormalized) {
        continue
      }

      const target = inspection.pageByNormalizedUrl.get(a.hrefNormalized)

      // Cross-domain unreachable
      if (
        !sameOrigin(page.urlNormalized, a.hrefNormalized) &&
        (!target || target.status == null)
      ) {
        suppressed.push({
          verdict: 'suppress-cross-domain-unreachable',
          detail: `Cross-domain alternate ${a.hrefNormalized} unreachable from crawler — unknown, not broken (G3)`,
        })
        continue
      }

      // x-default → redirecting homepage (G18) — NEVER raise
      if (
        isXDefault &&
        target &&
        (target.redirectHopCount > 0 ||
          (target.finalUrlNormalized != null &&
            target.finalUrlNormalized !== target.urlNormalized))
      ) {
        suppressed.push({
          verdict: 'suppress-x-default-redirecting-homepage',
          detail: `x-default may point at a redirecting/dynamic homepage (G18): ${a.hrefNormalized}`,
        })
        continue
      }

      if (!target) {
        // Sitemap-only healthy annotation without fetch data — suppress if
        // we only know it from sitemap and have no negative signals.
        if (a.method === 'sitemap') {
          suppressed.push({
            verdict: 'suppress-healthy-sitemap-only',
            detail: `Alternate declared only in sitemap with no negative signals: ${a.hrefNormalized}`,
          })
        }
        continue
      }

      // Healthy sitemap-only declaration on a known healthy page
      if (
        a.method === 'sitemap' &&
        page.htmlAnnotations.length === 0 &&
        page.headerAnnotations.length === 0 &&
        (target.status === 200 || target.status == null) &&
        target.redirectHopCount === 0 &&
        !target.hasNoindex &&
        !target.repoDeclaredNoindex &&
        !target.robotsDisallowedGooglebot
      ) {
        // Still evaluate G22 / etc. below; mark suppress for "declared only in sitemap and healthy"
        suppressed.push({
          verdict: 'suppress-healthy-sitemap-only',
          detail: `Sitemap-only healthy alternate ${a.hrefNormalized} (G1)`,
        })
      }

      // Redirect (non-x-default): single hop → auto repoint
      if (!isXDefault && target.redirectHopCount > 0) {
        if (
          target.redirectHopCount === 1 &&
          (target.status === 200 || target.status == null) &&
          target.finalUrlNormalized
        ) {
          findings.push({
            kind: 'hreflang/non-200-or-noindexed',
            verdict: 'auto-fix-repoint-redirect',
            severity: 'moderate',
            sourceUrl: page.urlNormalized,
            targetUrl: target.finalUrlNormalized,
            locale,
            detail: `Alternate redirects; repoint to final URL ${target.finalUrlNormalized}`,
            autoFixable: true,
            atomicClusterUrls: null,
            fixTarget,
          })
        } else {
          findings.push({
            kind: 'hreflang/non-200-or-noindexed',
            verdict: 'auto-fix-repoint-redirect',
            severity: 'moderate',
            sourceUrl: page.urlNormalized,
            targetUrl: target.finalUrlNormalized,
            locale,
            detail: `Alternate redirects (${target.redirectHopCount} hops)`,
            autoFixable: target.redirectHopCount === 1,
            atomicClusterUrls: null,
            fixTarget,
          })
        }
        continue
      }

      // 5xx → topic 3
      if (target.status != null && target.status >= 500) {
        findings.push({
          kind: 'hreflang/non-200-or-noindexed',
          verdict: 'finding-target-5xx-route-topic-3',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: a.hrefNormalized,
          locale,
          detail: `Alternate returns ${target.status} — topic 3 owns transient 5xx`,
          autoFixable: false,
          atomicClusterUrls: null,
          fixTarget,
        })
        continue
      }

      // 4xx → atomic locale removal (human-review)
      if (target.status != null && target.status >= 400 && target.status < 500) {
        findings.push({
          kind: 'hreflang/non-200-or-noindexed',
          verdict: 'human-review-atomic-locale-removal',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: a.hrefNormalized,
          locale,
          detail: `Alternate returns ${target.status}; remove locale atomically across cluster (else topic 46)`,
          autoFixable: false,
          atomicClusterUrls: cluster,
          fixTarget,
        })
        continue
      }

      // repo-declared noindex
      if (target.repoDeclaredNoindex) {
        findings.push({
          kind: 'hreflang/non-200-or-noindexed',
          verdict: 'human-review-repo-noindex',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: a.hrefNormalized,
          locale,
          detail: `Alternate is repo-declared noindex — indexability vs cluster is intent`,
          autoFixable: false,
          atomicClusterUrls: null,
          fixTarget,
        })
        continue
      }

      // robots disallowed for Googlebot
      if (target.robotsDisallowedGooglebot) {
        findings.push({
          kind: 'hreflang/non-200-or-noindexed',
          verdict: 'human-review-robots-disallowed',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: a.hrefNormalized,
          locale,
          detail: `Alternate disallowed for Googlebot in robots.txt`,
          autoFixable: false,
          atomicClusterUrls: null,
          fixTarget,
        })
        continue
      }

      // G22 — cross-locale canonical
      if (target.canonicalNormalized) {
        const self =
          target.canonicalNormalized === target.urlNormalized ||
          target.canonicalNormalized === a.hrefNormalized
        if (self) {
          suppressed.push({
            verdict: 'suppress-self-canonical',
            detail: `Alternate ${a.hrefNormalized} is self-canonical — correct`,
          })
        } else {
          const targetLocale = localeOfUrlInCluster(
            inspection,
            target.urlNormalized,
          )
          const canonicalLocale = localeOfUrlInCluster(
            inspection,
            target.canonicalNormalized,
          )
          if (
            targetLocale &&
            canonicalLocale &&
            targetLocale !== canonicalLocale
          ) {
            findings.push({
              kind: 'hreflang/non-200-or-noindexed',
              verdict: 'human-review-cross-locale-canonical',
              severity: 'high',
              sourceUrl: page.urlNormalized,
              targetUrl: a.hrefNormalized,
              locale,
              detail: `Alternate ${a.hrefNormalized} (${targetLocale}) canonicalises to ${target.canonicalNormalized} (${canonicalLocale}) — defeats cluster (G22)`,
              autoFixable: false,
              atomicClusterUrls: null,
              fixTarget,
            })
          } else if (
            // Canonical points at another cluster member that isn't self
            cluster.includes(target.canonicalNormalized) &&
            target.canonicalNormalized !== target.urlNormalized
          ) {
            findings.push({
              kind: 'hreflang/non-200-or-noindexed',
              verdict: 'human-review-cross-locale-canonical',
              severity: 'high',
              sourceUrl: page.urlNormalized,
              targetUrl: a.hrefNormalized,
              locale,
              detail: `Alternate ${a.hrefNormalized} canonicalises to another locale URL ${target.canonicalNormalized} (G22)`,
              autoFixable: false,
              atomicClusterUrls: null,
              fixTarget,
            })
          }
        }
      }
    }
  }

  return { findings, suppressed, inspection }
}

/** Never flag x-default → redirecting homepage. */
export function rejectedRaiseOnXDefaultRedirect(): never {
  throw new Error(
    'topic 48: x-default may point at a redirecting homepage (G18) — never raise',
  )
}

/** Never remove only one side of a cluster edge. */
export function rejectedPartialLocaleRemoval(): never {
  throw new Error(
    'topic 48: locale removal must be atomic across the cluster — partial creates topic 46',
  )
}

/** Propose absolute URL for a relative alternate (deterministic). */
export function absolutizeAlternateHref(
  href: string,
  pageUrl: string,
): string | null {
  return normalizeFixStrategyUrl(href, pageUrl)
}

/** Ensure atomic cluster list is complete before any removal edit. */
export function assertAtomicLocaleRemoval(urls: string[]): void {
  if (urls.length < 2) {
    throw new Error(
      'topic 48: atomic locale removal requires the full cluster member list',
    )
  }
}
