/**
 * Topic 42 — detect internal links that point at redirects.
 *
 * Auto-rewrite only when all five Google conditions hold and the link is not
 * in shared navigation. Uses shared hop-recording, url-normalize (with
 * query/fragment preserve), and generated-output-guard.
 */

import {
  fetchWithEvidence,
  type FetchDeps,
} from '@/lib/fix-strategies/fetch'
import {
  normalizeFixStrategyUrl,
  recordRedirectHops,
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'
import {
  extractInternalFetchableAnchors,
  isSkippableHref,
} from '@/lib/fix-strategies/topic-1/extract-anchors'
import {
  classifyRedirectLink,
  type ClassifyRedirectResult,
  type RedirectSeverity,
  type Topic42Verdict,
} from './classify-redirect'
import {
  resolveHrefDeclaration,
  type DeclarationKind,
  type HrefDeclaration,
} from './resolve-declaration'

export type SourcePage = {
  url: string
  html: string
  /**
   * Optional artefact path for this page (for generated-output-guard).
   * Defaults to a synthetic path derived from the URL path.
   */
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export type Topic42Finding = {
  kind: 'internal-link/points-at-redirect'
  /** Representative source page URL. */
  sourceUrl: string
  href: string
  targetUrl: string
  verdict: Topic42Verdict
  severity: RedirectSeverity | null
  hopCount: number
  rewriteHref: string | null
  finalUrl: string | null
  declaration: HrefDeclaration
  /** Pages where this href was observed (deduped for shared-nav). */
  observedOn: string[]
  detail: string
  conditions: ClassifyRedirectResult['conditions']
  fixTarget: FixTargetResult
}

export type DetectTopic42Result = {
  findings: Topic42Finding[]
  suppressed: Array<{ href: string; sourceUrl: string; reason: string }>
}

export type DetectTopic42Options = {
  deps: FetchDeps
  /** Repo root for topic-70 declaration-site resolution. */
  repoRoot?: string
  /**
   * Override declaration lookup (fixtures). Keyed by href path/token.
   */
  declarationByHref?: Record<string, HrefDeclaration>
}

function artefactFor(page: SourcePage): {
  artefactPath: string
  isGenerated: boolean
  generatorPath: string | null
} {
  if (page.artefactPath) {
    return {
      artefactPath: page.artefactPath,
      isGenerated: page.isGenerated ?? false,
      generatorPath: page.generatorPath ?? null,
    }
  }
  try {
    const p = new URL(page.url).pathname.replace(/\/$/, '') || '/index'
    return {
      artefactPath: `app${p === '/index' ? '' : p}/page.tsx`,
      isGenerated: false,
      generatorPath: null,
    }
  } catch {
    return {
      artefactPath: 'app/page.tsx',
      isGenerated: false,
      generatorPath: null,
    }
  }
}

function declarationFor(
  href: string,
  options: DetectTopic42Options,
): HrefDeclaration {
  if (options.declarationByHref) {
    const direct = options.declarationByHref[href]
    if (direct) return direct
    try {
      const pathOnly = new URL(href, 'https://example.invalid').pathname
      if (options.declarationByHref[pathOnly]) {
        return options.declarationByHref[pathOnly]
      }
    } catch {
      // fall through
    }
  }
  if (options.repoRoot) {
    return resolveHrefDeclaration(options.repoRoot, href)
  }
  return {
    kind: 'page',
    file: null,
    detail: 'no repoRoot — treating as page-local',
  }
}

/**
 * Detect redirect-link findings across one or more source pages.
 * Shared-nav hrefs collapse to a single finding naming the component.
 */
export async function detectLinksThroughRedirects(
  pages: SourcePage[],
  options: DetectTopic42Options,
): Promise<DetectTopic42Result> {
  const findings: Topic42Finding[] = []
  const suppressed: DetectTopic42Result['suppressed'] = []

  // Group observations: key = normalized target URL without query ambiguity
  // For shared-nav we key by declaration file + href path.
  type Obs = {
    href: string
    sourceUrl: string
    targetUrl: string
    page: SourcePage
  }
  const observations: Obs[] = []

  for (const page of pages) {
    for (const anchor of extractInternalFetchableAnchors(page.html, page.url)) {
      if (isSkippableHref(anchor.href)) {
        suppressed.push({
          href: anchor.href,
          sourceUrl: page.url,
          reason: 'scheme-filter',
        })
        continue
      }
      const targetUrl = new URL(anchor.href, page.url).toString()
      observations.push({
        href: anchor.href,
        sourceUrl: page.url,
        targetUrl,
        page,
      })
    }
  }

  // Deduplicate work by absolute target (path+search, no hash) + declaration
  const groups = new Map<
    string,
    { obs: Obs[]; declaration: HrefDeclaration }
  >()

  for (const obs of observations) {
    const declaration = declarationFor(obs.href, options)
    const norm =
      normalizeFixStrategyUrl(obs.targetUrl) ?? obs.targetUrl.split('#')[0]!
    const key =
      declaration.kind === 'shared-nav' && declaration.file
        ? `nav:${declaration.file}:${norm}`
        : `page:${obs.sourceUrl}:${norm}`
    const existing = groups.get(key)
    if (existing) existing.obs.push(obs)
    else groups.set(key, { obs: [obs], declaration })
  }

  for (const group of groups.values()) {
    const primary = group.obs[0]!
    const { href, targetUrl, page, sourceUrl } = primary

    // Topic 68: confirm the first response is a stable redirect (or flip).
    const evidence = await fetchWithEvidence(targetUrl, options.deps)
    if (!evidence.stable) {
      // Still record the chain for classification when first attempt was 3xx
      const first = evidence.attempts[0]
      if (
        !first ||
        first.kind !== 'http' ||
        first.status < 300 ||
        first.status >= 400
      ) {
        suppressed.push({
          href,
          sourceUrl,
          reason: evidence.reason,
        })
        continue
      }
    }

    const outcome = evidence.stable
      ? evidence.outcome
      : evidence.attempts[0]!

    if (outcome.kind !== 'http') {
      suppressed.push({ href, sourceUrl, reason: outcome.kind })
      continue
    }

    if (outcome.status < 300 || outcome.status >= 400) {
      suppressed.push({
        href,
        sourceUrl,
        reason: `status-${outcome.status}`,
      })
      continue
    }

    const redirectStable =
      evidence.stable &&
      evidence.outcome.kind === 'http' &&
      evidence.outcome.status >= 300 &&
      evidence.outcome.status < 400

    const chain = await recordRedirectHops(targetUrl, {
      fetch: options.deps.fetch,
    })

    const classified = classifyRedirectLink({
      sourcePageUrl: sourceUrl,
      href,
      chain,
      declarationKind: group.declaration.kind as DeclarationKind,
      redirectStable,
    })

    if (
      classified.verdict === 'skip-not-redirect' ||
      classified.verdict === 'skip-external-destination'
    ) {
      suppressed.push({
        href,
        sourceUrl,
        reason: classified.verdict,
      })
      continue
    }

    const art = artefactFor(page)
    const fixTarget =
      group.declaration.kind === 'shared-nav' && group.declaration.file
        ? resolveFixTarget({
            artefactPath: group.declaration.file,
            generatorPath: null,
            isGenerated: false,
          })
        : resolveFixTarget(art)

    findings.push({
      kind: 'internal-link/points-at-redirect',
      sourceUrl,
      href,
      targetUrl,
      verdict: classified.verdict,
      severity: classified.severity,
      hopCount: classified.hopCount,
      rewriteHref: classified.rewriteHref,
      finalUrl: classified.finalUrl,
      declaration: group.declaration,
      observedOn: Array.from(new Set(group.obs.map((o) => o.sourceUrl))),
      detail: classified.detail,
      conditions: classified.conditions,
      fixTarget,
    })
  }

  return { findings, suppressed }
}
