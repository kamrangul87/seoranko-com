import {
  fetchWithEvidence,
  type FetchDeps,
} from '@/lib/fix-strategies/fetch'
import {
  checkRepoDeclaredNoindex,
  hasNoindexDirective,
} from '@/lib/fix-strategies/shared'
import {
  detectRouteRoots,
  primaryAppRouterDir,
  resolvePath,
  type RouteKind,
  type RouteRoot,
  type ResolvePathResult,
} from '@/lib/fix-strategies/site-model'
import {
  extractAnchors,
  extractInternalFetchableAnchors,
  isInternalHref,
  isSkippableHref,
} from './extract-anchors'
import {
  findDeletedRouteEvidence,
  gitEvidenceUnavailable,
  type GitRunner,
} from './git-route-history'
import { scoreSuccessors, type LivePage } from './successor-similarity'
import { decide404Branch, type Decision404 } from './decide-404'
import type { SuccessorSimilarityConfig } from './config'

export type Finding410 = {
  kind: 'broken-internal-link/410'
  sourceUrl: string
  targetUrl: string
  href: string
  action: 'remove-anchor'
  verdict: 'auto-fixable'
}

export type Finding404 = {
  kind: 'broken-internal-link/404'
  sourceUrl: string
  targetUrl: string
  href: string
} & Decision404

/**
 * 200 + noindex where repo does not declare it → streamed soft 404 (R32).
 * Treated as the 404 branch (git × successors).
 */
export type FindingSoft404 = {
  kind: 'broken-internal-link/soft-404'
  sourceUrl: string
  targetUrl: string
  href: string
  /** Why this is not a deliberate noindex page. */
  cause: 'injected-noindex'
} & Decision404

/**
 * 200 + noindex where generateMetadata robots is runtime-dependent.
 */
export type FindingIndeterminateNoindex = {
  kind: 'broken-internal-link/200-noindex'
  sourceUrl: string
  targetUrl: string
  href: string
  cause: 'indeterminate-repo-noindex'
  verdict: 'human-review'
  action: 'indeterminate-noindex'
  reason: string
}

export type Topic1Finding =
  | Finding410
  | Finding404
  | FindingSoft404
  | FindingIndeterminateNoindex

export type DetectTopic1Result = {
  findings: Topic1Finding[]
  suppressed: Array<{ href: string; reason: string }>
}

export type DetectTopic1Options = {
  deps: FetchDeps
  /** Repo root for git deletion evidence + site-model route roots. */
  repoRoot?: string
  runGit?: GitRunner
  /**
   * Override site-model route roots. When omitted and `repoRoot` is set,
   * roots are detected via `detectRouteRoots(repoRoot)`.
   */
  routeRoots?: RouteRoot[]
  /** Live 200 pages available for successor scoring. */
  livePages?: LivePage[]
  /** Optional historical HTML for the missing URL (content similarity). */
  historicalHtmlByPath?: Record<string, string>
  similarityConfig?: Partial<SuccessorSimilarityConfig>
  gscImpressionsByPath?: Record<string, number>
}

function appDirFor(
  repoRoot: string | undefined,
  routeRoots: RouteRoot[],
): string | null {
  if (!repoRoot) return null
  return (
    routeRoots.find((r) => r.kind === 'app-router')?.absDir ??
    primaryAppRouterDir(repoRoot)
  )
}

function resolveRouteKind(
  repoRoot: string | undefined,
  routeRoots: RouteRoot[],
  urlPath: string,
): RouteKind | null {
  const appDir = appDirFor(repoRoot, routeRoots)
  if (!appDir) {
    return routeRoots.length === 0 ? null : 'no-route'
  }
  return resolvePath(appDir, urlPath).kind
}

function resolveRoute(
  repoRoot: string | undefined,
  routeRoots: RouteRoot[],
  urlPath: string,
): ResolvePathResult | null {
  const appDir = appDirFor(repoRoot, routeRoots)
  if (!appDir) return null
  return resolvePath(appDir, urlPath)
}

async function decideSoftOr404(
  targetUrl: string,
  href: string,
  options: DetectTopic1Options,
  routeRoots: RouteRoot[],
): Promise<Decision404> {
  const path = new URL(targetUrl).pathname
  const routeKind = resolveRouteKind(options.repoRoot, routeRoots, path)

  const git =
    options.repoRoot && options.runGit
      ? await findDeletedRouteEvidence(
          options.repoRoot,
          path,
          options.runGit,
          { routeRoots, requireRouteRoots: true },
        )
      : gitEvidenceUnavailable(
          'history-unavailable: repoRoot/runGit not provided',
        )

  const historical =
    options.historicalHtmlByPath?.[path] ??
    options.historicalHtmlByPath?.[href] ??
    null

  const successors = scoreSuccessors(
    path,
    historical,
    options.livePages ?? [],
    options.similarityConfig,
  )

  return decide404Branch({
    git,
    successors,
    routeKind,
    gscImpressions: options.gscImpressionsByPath?.[path] ?? null,
  })
}

/**
 * Topic 1 detector — 410, 404, and 200+noindex (soft-404) branches.
 *
 * Soft-404 discriminator (topic 70 `checkRepoDeclaredNoindex`):
 * - repo declares noindex → suppress (deliberate valid page)
 * - generateMetadata robots conditional → human-review indeterminate
 * - repo does not declare, live carries noindex → raise (streamed notFound / R32)
 */
export async function detectBrokenInternalLinks(
  sourceHtml: string,
  sourceUrl: string,
  options: DetectTopic1Options,
): Promise<DetectTopic1Result> {
  const findings: Topic1Finding[] = []
  const suppressed: DetectTopic1Result['suppressed'] = []
  const seen = new Set<string>()

  const routeRoots: RouteRoot[] =
    options.routeRoots ??
    (options.repoRoot ? detectRouteRoots(options.repoRoot) : [])

  for (const anchor of extractAnchors(sourceHtml)) {
    if (isSkippableHref(anchor.href)) {
      suppressed.push({ href: anchor.href, reason: 'scheme-filter' })
      continue
    }
    if (!isInternalHref(anchor.href, sourceUrl)) {
      suppressed.push({ href: anchor.href, reason: 'external' })
    }
  }

  const candidates = extractInternalFetchableAnchors(sourceHtml, sourceUrl)

  for (const anchor of candidates) {
    const targetUrl = new URL(anchor.href, sourceUrl).toString()
    if (seen.has(targetUrl)) continue
    seen.add(targetUrl)

    const evidence = await fetchWithEvidence(targetUrl, options.deps)
    if (!evidence.stable) {
      suppressed.push({ href: anchor.href, reason: evidence.reason })
      continue
    }

    const { outcome } = evidence

    if (outcome.kind === 'http' && outcome.status === 410) {
      findings.push({
        kind: 'broken-internal-link/410',
        sourceUrl,
        targetUrl,
        href: anchor.href,
        action: 'remove-anchor',
        verdict: 'auto-fixable',
      })
      continue
    }

    if (outcome.kind === 'http' && outcome.status === 404) {
      const decision = await decideSoftOr404(
        targetUrl,
        anchor.href,
        options,
        routeRoots,
      )
      findings.push({
        kind: 'broken-internal-link/404',
        sourceUrl,
        targetUrl,
        href: anchor.href,
        ...decision,
      })
      continue
    }

    if (outcome.kind === 'http' && outcome.status === 200) {
      const contentType = outcome.headers.get('content-type')
      const noindex = hasNoindexDirective(
        outcome.headers,
        outcome.body,
        contentType,
      )

      if (!noindex) {
        suppressed.push({ href: anchor.href, reason: 'healthy-200' })
        continue
      }

      // 200 + noindex — topic 70 discriminator (guard 7 / soft-404 ambiguity)
      const path = new URL(targetUrl).pathname
      const resolved = resolveRoute(options.repoRoot, routeRoots, path)
      const appDir = appDirFor(options.repoRoot, routeRoots)

      if (!resolved?.routeFile || !appDir) {
        // No route file to inspect → repo does not declare noindex → injected.
        // Same treatment as declared === 'false' (streamed soft 404 / destination gone).
        const decision = await decideSoftOr404(
          targetUrl,
          anchor.href,
          options,
          routeRoots,
        )
        findings.push({
          kind: 'broken-internal-link/soft-404',
          sourceUrl,
          targetUrl,
          href: anchor.href,
          cause: 'injected-noindex',
          ...decision,
        })
        continue
      }

      const declared = checkRepoDeclaredNoindex(resolved.routeFile, appDir)

      if (declared === 'true') {
        suppressed.push({ href: anchor.href, reason: 'deliberate-noindex' })
        continue
      }

      if (declared === 'indeterminate') {
        findings.push({
          kind: 'broken-internal-link/200-noindex',
          sourceUrl,
          targetUrl,
          href: anchor.href,
          cause: 'indeterminate-repo-noindex',
          verdict: 'human-review',
          action: 'indeterminate-noindex',
          reason:
            'noindex present but generateMetadata robots is indeterminate',
        })
        continue
      }

      // declared === 'false' — live noindex with no repo declaration → injected
      // (streamed notFound / R32). Destination gone; treat as 404 branch.
      const decision = await decideSoftOr404(
        targetUrl,
        anchor.href,
        options,
        routeRoots,
      )
      findings.push({
        kind: 'broken-internal-link/soft-404',
        sourceUrl,
        targetUrl,
        href: anchor.href,
        cause: 'injected-noindex',
        ...decision,
      })
      continue
    }

    suppressed.push({
      href: anchor.href,
      reason:
        outcome.kind === 'http' ? `status-${outcome.status}` : outcome.kind,
    })
  }

  return { findings, suppressed }
}

/** @deprecated Use detectBrokenInternalLinks — kept for Stage 3 call sites. */
export async function detectGoneAnchors(
  sourceHtml: string,
  sourceUrl: string,
  deps: FetchDeps,
) {
  const result = await detectBrokenInternalLinks(sourceHtml, sourceUrl, {
    deps,
  })
  return {
    findings: result.findings.filter(
      (f): f is Finding410 => f.kind === 'broken-internal-link/410',
    ),
    suppressed: result.suppressed,
  }
}
