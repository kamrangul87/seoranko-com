/**
 * Topic 19 — noindex on a page that "should" index.
 *
 * Finding is a CONTRADICTION only: repo-declared noindex + sitemap membership
 * and/or being a canonical target. Never auto-remove noindex.
 * Injected noindex → topic 2a, not this.
 */

import {
  checkRepoDeclaredNoindex,
  extractHtmlCanonical,
  isSelfCanonical,
  resolveFixTarget,
  type FixTargetResult,
  type NoindexDeclaration,
} from '@/lib/fix-strategies/shared'
import {
  extractPageRobotsDirectives,
} from '@/lib/fix-strategies/shared/robots-directives'

export type Topic19Verdict =
  | 'report-contradiction-sitemap'
  | 'report-contradiction-self-canonical'
  | 'report-contradiction-canonical-target'
  | 'report-layout-cascade'
  | 'route-topic-2a-injected'
  | 'suppress-deliberate-exclusion'
  | 'indeterminate-generateMetadata'
  | 'ok'

export type Topic19Finding = {
  kind: 'indexability/noindex-should-index'
  pageUrl: string
  verdict: Topic19Verdict
  detail: string
  /** Never auto-fix. */
  autoFixable: false
  cascadeSource: string | null
  fixTarget: FixTargetResult
}

export type DetectTopic19Result = {
  findings: Topic19Finding[]
  suppressed: Array<{ pageUrl: string; verdict: Topic19Verdict; detail: string }>
}

export type DetectTopic19Page = {
  url: string
  body: string
  headers?: Headers
  contentType?: string | null
  /** Listed in the site's XML sitemap. */
  inSitemap: boolean
  /** Other pages' canonicals that point here. */
  canonicalTargetOf?: string[]
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /**
   * Repo declaration from topic 70.
   * Prefer explicit override in fixtures; else resolve via routeFile/appDir.
   */
  repoNoindex?: NoindexDeclaration
  /** Layout file that declares noindex (cascade). */
  cascadeSource?: string | null
  routeFile?: string
  appDir?: string
  /** Staging/preview/auth — deliberate. */
  deliberateExclusion?: boolean
}

export function detectNoindexShouldIndex(
  pages: DetectTopic19Page[],
): DetectTopic19Result {
  const findings: Topic19Finding[] = []
  const suppressed: DetectTopic19Result['suppressed'] = []

  for (const page of pages) {
    const headers = page.headers ?? new Headers()
    const ct = page.contentType ?? headers.get('content-type') ?? 'text/html'
    const dirs = extractPageRobotsDirectives(headers, page.body, ct)

    const fixTarget = resolveFixTarget({
      artefactPath: page.artefactPath ?? 'app/page.tsx',
      isGenerated: page.isGenerated ?? false,
      generatorPath: page.generatorPath ?? null,
    })

    if (!dirs.hasNoindex) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'ok',
        detail: 'No noindex directive',
      })
      continue
    }

    if (page.deliberateExclusion) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-deliberate-exclusion',
        detail: 'Staging/preview/auth-gated — deliberate exclusion',
      })
      continue
    }

    const repoDecl: NoindexDeclaration =
      page.repoNoindex ??
      (page.routeFile && page.appDir
        ? checkRepoDeclaredNoindex(page.routeFile, page.appDir)
        : 'false')

    if (repoDecl === 'indeterminate') {
      findings.push({
        kind: 'indexability/noindex-should-index',
        pageUrl: page.url,
        verdict: 'indeterminate-generateMetadata',
        detail: 'generateMetadata sets robots conditionally — indeterminate',
        autoFixable: false,
        cascadeSource: page.cascadeSource ?? null,
        fixTarget,
      })
      continue
    }

    if (repoDecl === 'false') {
      // Live noindex but not repo-declared → injected (topic 2a)
      findings.push({
        kind: 'indexability/noindex-should-index',
        pageUrl: page.url,
        verdict: 'route-topic-2a-injected',
        detail: 'noindex is injected, not repo-declared — topic 2a, not topic 19',
        autoFixable: false,
        cascadeSource: null,
        fixTarget,
      })
      continue
    }

    // repo-declared noindex
    const canonical = extractHtmlCanonical(page.body, page.url, ct)
    const selfCanon = isSelfCanonical(page.url, canonical)
    const targetedBy = (page.canonicalTargetOf ?? []).filter(Boolean)
    const isCanonicalTarget = targetedBy.length > 0

    const contradictions: Topic19Verdict[] = []
    if (page.inSitemap) contradictions.push('report-contradiction-sitemap')
    if (selfCanon && canonical != null) {
      contradictions.push('report-contradiction-self-canonical')
    }
    if (isCanonicalTarget) {
      contradictions.push('report-contradiction-canonical-target')
    }

    if (contradictions.length === 0) {
      suppressed.push({
        pageUrl: page.url,
        verdict: 'suppress-deliberate-exclusion',
        detail:
          'Repo-declared noindex, absent from sitemap, not a canonical target — deliberate exclusion working correctly',
      })
      continue
    }

    if (page.cascadeSource) {
      findings.push({
        kind: 'indexability/noindex-should-index',
        pageUrl: page.url,
        verdict: 'report-layout-cascade',
        detail: `Contradiction via layout cascade (${page.cascadeSource}): ${contradictions.join(', ')}. Report cascade source once. Never auto-remove noindex.`,
        autoFixable: false,
        cascadeSource: page.cascadeSource,
        fixTarget,
      })
      continue
    }

    const primary = contradictions[0]!
    findings.push({
      kind: 'indexability/noindex-should-index',
      pageUrl: page.url,
      verdict: primary,
      detail: `Signal contradiction (${contradictions.join('; ')}). Resolutions: remove noindex OR remove from sitemap/fix inbound canonicals. Never auto-remove noindex.`,
      autoFixable: false,
      cascadeSource: null,
      fixTarget,
    })
  }

  return { findings, suppressed }
}
