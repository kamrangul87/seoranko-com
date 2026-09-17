/**
 * Topic 46 — missing return links (hreflang reciprocity).
 *
 * Report PER PAIR, not per site (G7). Hub clusters where every declared pair
 * is reciprocal are permitted (G8) — never raise for incomplete all-to-all.
 * Annotations from any of the three methods count (G1).
 */

import {
  collectHreflangAnnotations,
  declaresReturnTo,
  hreflangKey,
  localeTargetMap,
  type HreflangInspection,
  type PageHreflangRecord,
  type CollectHreflangOptions,
} from '@/lib/fix-strategies/shared/hreflang-inspect'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

export type Topic46Verdict =
  | 'finding-missing-return'
  | 'finding-missing-self-reference'
  | 'finding-conflicting-return-target'
  | 'finding-method-cluster-divergence'
  | 'human-review-cross-domain'
  | 'human-review-locale-unknown'
  | 'route-topic-29-body-annotation'
  | 'route-topic-48-unhealthy-target'
  | 'finding-hreflang-with-media'
  | 'suppress-reciprocal-via-other-method'
  | 'suppress-hub-pattern-permitted'
  | 'ok'

export type Topic46Finding = {
  kind: 'hreflang/missing-return-links'
  verdict: Topic46Verdict
  severity: 'high' | 'moderate' | null
  /** Source page of the declared edge. */
  sourceUrl: string
  /** Target of the declared edge. */
  targetUrl: string | null
  locale: string | null
  detail: string
  autoFixable: boolean
  fixTarget: FixTargetResult
}

export type DetectTopic46Result = {
  findings: Topic46Finding[]
  suppressed: Array<{ verdict: Topic46Verdict; detail: string }>
  inspection: HreflangInspection
}

export type DetectTopic46Options = {
  inspection?: HreflangInspection
  collect?: CollectHreflangOptions
  /**
   * Authoritative repo locale for a page URL (route segment / i18n config).
   * Never guess — missing ⇒ human-review for auto-fix.
   */
  repoLocaleByUrl?: Record<string, string>
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

function methodClusterSignature(page: PageHreflangRecord): {
  html: string
  header: string
  sitemap: string
} {
  const sig = (anns: typeof page.htmlAnnotations) => {
    const pairs = anns
      .filter((a) => a.hrefNormalized)
      .map((a) => `${hreflangKey(a.hreflangRaw)}>${a.hrefNormalized}`)
      .sort()
    return pairs.join('|')
  }
  return {
    html: sig(page.htmlAnnotations),
    header: sig(page.headerAnnotations),
    sitemap: sig(page.sitemapAnnotations),
  }
}

export function detectMissingReturnLinks(
  options: DetectTopic46Options,
): DetectTopic46Result {
  const inspection =
    options.inspection ??
    collectHreflangAnnotations(
      options.collect ?? { originUrl: 'https://example.com', pages: [] },
    )
  const findings: Topic46Finding[] = []
  const suppressed: DetectTopic46Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/i18n.ts',
    isGenerated: options.isGenerated ?? true,
    generatorPath: options.generatorPath ?? 'app/i18n.ts',
  })

  const repoLocale = options.repoLocaleByUrl ?? {}

  for (const page of inspection.pages) {
    // G24 — body annotations → topic 29
    if (page.bodyHtmlAnnotations.length > 0) {
      findings.push({
        kind: 'hreflang/missing-return-links',
        verdict: 'route-topic-29-body-annotation',
        severity: 'high',
        sourceUrl: page.urlNormalized,
        targetUrl: null,
        locale: null,
        detail:
          'hreflang annotation outside a well-formed <head> (G24) — topic 29',
        autoFixable: false,
        fixTarget,
      })
    }

    // G23 — media combined with hreflang
    for (const a of page.effectiveAnnotations) {
      if (a.hasMedia) {
        findings.push({
          kind: 'hreflang/missing-return-links',
          verdict: 'finding-hreflang-with-media',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: a.hrefNormalized,
          locale: a.hreflangRaw,
          detail: `hreflang combined with media attribute (G23): ${a.hreflangRaw}`,
          autoFixable: false,
          fixTarget,
        })
      }
    }

    // G4 — method cluster divergence (only when ≥2 methods declare something)
    const sig = methodClusterSignature(page)
    const nonEmpty = [sig.html, sig.header, sig.sitemap].filter(Boolean)
    if (nonEmpty.length >= 2 && new Set(nonEmpty).size > 1) {
      findings.push({
        kind: 'hreflang/missing-return-links',
        verdict: 'finding-method-cluster-divergence',
        severity: 'high',
        sourceUrl: page.urlNormalized,
        targetUrl: null,
        locale: null,
        detail:
          'HTML, HTTP Link, and/or sitemap declare different hreflang clusters (G4)',
        autoFixable: false,
        fixTarget,
      })
    }

    const effective = page.effectiveAnnotations
    if (effective.length === 0) continue

    // G5 — self-reference
    const hasSelf = effective.some(
      (a) => a.hrefNormalized === page.urlNormalized,
    )
    if (!hasSelf) {
      findings.push({
        kind: 'hreflang/missing-return-links',
        verdict: 'finding-missing-self-reference',
        severity: 'high',
        sourceUrl: page.urlNormalized,
        targetUrl: page.urlNormalized,
        locale: null,
        detail: 'Page does not declare a self-referencing hreflang (G5)',
        autoFixable: Boolean(
          repoLocale[page.urlNormalized] || repoLocale[page.url],
        ),
        fixTarget,
      })
    }

    // Per declared edge A→B (G6 / G7) — skip self edges for return check
    const seenEdges = new Set<string>()
    for (const edge of effective) {
      if (!edge.hrefNormalized) continue
      if (edge.hrefNormalized === page.urlNormalized) continue
      const edgeKey = `${page.urlNormalized}>${edge.hrefNormalized}`
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)

      const target = inspection.pageByNormalizedUrl.get(edge.hrefNormalized)

      // Cross-domain — G3 permits, but reciprocity may be out of control
      if (!sameOrigin(page.urlNormalized, edge.hrefNormalized)) {
        findings.push({
          kind: 'hreflang/missing-return-links',
          verdict: 'human-review-cross-domain',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: edge.hrefNormalized,
          locale: edge.hreflangRaw,
          detail: `Cross-domain alternate ${edge.hrefNormalized} — reciprocity may be outside control (G3)`,
          autoFixable: false,
          fixTarget,
        })
        continue
      }

      // Topic 48 prior: unhealthy target
      if (
        target &&
        ((target.status != null && target.status >= 400) ||
          target.repoDeclaredNoindex ||
          target.hasNoindex ||
          target.robotsDisallowedGooglebot)
      ) {
        suppressed.push({
          verdict: 'route-topic-48-unhealthy-target',
          detail: `Target ${edge.hrefNormalized} unhealthy — topic 48 first`,
        })
        continue
      }

      if (!target) {
        // Target page not in inspection — treat as missing return for fixtures
        // that only supplied A; still per-pair.
        findings.push({
          kind: 'hreflang/missing-return-links',
          verdict: 'finding-missing-return',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: edge.hrefNormalized,
          locale: edge.hreflangRaw,
          detail: `A→B declared but B has no annotations in inspection (G6)`,
          autoFixable: false,
          fixTarget,
        })
        continue
      }

      // A's self-locale (annotation that points at A itself)
      const sourceLocales = localeTargetMap(page.effectiveAnnotations)
      let selfLocale: string | null = null
      for (const [loc, url] of sourceLocales) {
        if (url === page.urlNormalized) {
          selfLocale = loc
          break
        }
      }

      // B declares A's locale but at a *different* URL → conflicting cluster (G6)
      if (selfLocale) {
        const targetMap = localeTargetMap(target.effectiveAnnotations)
        const returnUrl = targetMap.get(selfLocale)
        if (
          returnUrl &&
          returnUrl !== page.urlNormalized
        ) {
          findings.push({
            kind: 'hreflang/missing-return-links',
            verdict: 'finding-conflicting-return-target',
            severity: 'high',
            sourceUrl: page.urlNormalized,
            targetUrl: edge.hrefNormalized,
            locale: selfLocale,
            detail: `B points at a different URL for A's locale ${selfLocale}: ${returnUrl} (G6)`,
            autoFixable: false,
            fixTarget,
          })
          continue
        }
      }

      // Does B point back at A at all?
      if (!declaresReturnTo(target, page.urlNormalized)) {
        findings.push({
          kind: 'hreflang/missing-return-links',
          verdict: 'finding-missing-return',
          severity: 'high',
          sourceUrl: page.urlNormalized,
          targetUrl: edge.hrefNormalized,
          locale: edge.hreflangRaw,
          detail: `Non-reciprocal pair: ${page.urlNormalized} → ${edge.hrefNormalized} with no return (G6)`,
          autoFixable: Boolean(
            (repoLocale[page.urlNormalized] || repoLocale[page.url]) &&
              (repoLocale[target.urlNormalized] || repoLocale[target.url]),
          ),
          fixTarget,
        })
      }
    }
  }

  // Hub pattern suppress: if we only raised missing-return for pairs that are
  // actually reciprocal — already not raised. Record suppress when cluster
  // is not all-to-all but every declared edge was reciprocal.
  if (
    findings.every(
      (f) =>
        f.verdict !== 'finding-missing-return' &&
        f.verdict !== 'finding-conflicting-return-target',
    )
  ) {
    const pagesWithAnns = inspection.pages.filter(
      (p) => p.effectiveAnnotations.length > 0,
    )
    if (pagesWithAnns.length >= 3) {
      const urls = pagesWithAnns.map((p) => p.urlNormalized)
      let allToAll = true
      for (const p of pagesWithAnns) {
        const targets = new Set(
          p.effectiveAnnotations
            .map((a) => a.hrefNormalized)
            .filter(Boolean),
        )
        for (const u of urls) {
          if (!targets.has(u)) {
            allToAll = false
            break
          }
        }
        if (!allToAll) break
      }
      if (!allToAll) {
        suppressed.push({
          verdict: 'suppress-hub-pattern-permitted',
          detail:
            'Cluster is not all-to-all but every declared pair is reciprocal (G8)',
        })
      }
    }
  }

  // Suppress note when reciprocity only via non-HTML method was checked —
  // covered by using effectiveAnnotations; expose for fixtures.
  for (const page of inspection.pages) {
    for (const edge of page.htmlAnnotations) {
      if (!edge.hrefNormalized || edge.hrefNormalized === page.urlNormalized) {
        continue
      }
      const target = inspection.pageByNormalizedUrl.get(edge.hrefNormalized)
      if (!target) continue
      const htmlReturn = target.htmlAnnotations.some(
        (a) => a.hrefNormalized === page.urlNormalized,
      )
      const otherReturn =
        !htmlReturn && declaresReturnTo(target, page.urlNormalized)
      if (otherReturn) {
        suppressed.push({
          verdict: 'suppress-reciprocal-via-other-method',
          detail: `Return for ${page.urlNormalized}↔${edge.hrefNormalized} present via header/sitemap (G1)`,
        })
      }
    }
  }

  return { findings, suppressed, inspection }
}

/** Never guess a page locale to complete a cluster. */
export function rejectedGuessLocaleToCompleteCluster(): never {
  throw new Error(
    'topic 46: never guess a page locale to complete a cluster — human-review',
  )
}

/** Never report one broken pair as a site-wide hreflang failure. */
export function rejectedSiteWideFromOnePair(): never {
  throw new Error(
    'topic 46: report per pair (G7) — one broken pair does not invalidate the cluster',
  )
}
