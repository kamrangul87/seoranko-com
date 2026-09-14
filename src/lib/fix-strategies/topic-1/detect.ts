import {
  fetchWithEvidence,
  type FetchDeps,
} from '@/lib/fix-strategies/fetch'
import {
  extractAnchors,
  extractInternalFetchableAnchors,
  isInternalHref,
  isSkippableHref,
} from './extract-anchors'
import {
  findDeletedRouteEvidence,
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

export type Topic1Finding = Finding410 | Finding404

export type DetectTopic1Result = {
  findings: Topic1Finding[]
  suppressed: Array<{ href: string; reason: string }>
}

export type DetectTopic1Options = {
  deps: FetchDeps
  /** Repo root for git deletion evidence. Required for 404 branching. */
  repoRoot?: string
  runGit?: GitRunner
  /** Live 200 pages available for successor scoring. */
  livePages?: LivePage[]
  /** Optional historical HTML for the missing URL (content similarity). */
  historicalHtmlByPath?: Record<string, string>
  similarityConfig?: Partial<SuccessorSimilarityConfig>
  gscImpressionsByPath?: Record<string, number>
}

/**
 * Topic 1 detector — 410 and 404 branches.
 * Soft-404 (200+noindex) discriminator is not in this slice.
 */
export async function detectBrokenInternalLinks(
  sourceHtml: string,
  sourceUrl: string,
  options: DetectTopic1Options,
): Promise<DetectTopic1Result> {
  const findings: Topic1Finding[] = []
  const suppressed: DetectTopic1Result['suppressed'] = []
  const seen = new Set<string>()

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
      const path = new URL(targetUrl).pathname
      const git =
        options.repoRoot && options.runGit
          ? await findDeletedRouteEvidence(
              options.repoRoot,
              path,
              options.runGit,
            )
          : {
              deleted: false,
              deletedPaths: [],
              detail: 'git evidence unavailable',
            }

      const historical =
        options.historicalHtmlByPath?.[path] ??
        options.historicalHtmlByPath?.[anchor.href] ??
        null

      const successors = scoreSuccessors(
        path,
        historical,
        options.livePages ?? [],
        options.similarityConfig,
      )

      const decision = decide404Branch({
        git,
        successors,
        gscImpressions: options.gscImpressionsByPath?.[path] ?? null,
      })

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
      suppressed.push({ href: anchor.href, reason: 'healthy-200' })
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
