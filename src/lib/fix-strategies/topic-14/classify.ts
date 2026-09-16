/**
 * Topic 14 — classify canonical target status (non-200 / chain / soft-404).
 */

export type Topic14Verdict =
  | 'ok'
  | 'finding-dead-4xx'
  | 'finding-soft-404'
  | 'finding-canonical-chain'
  | 'route-topic-3-transient-5xx'
  | 'route-topic-18-cross-domain'
  | 'route-topic-17-multiple-head'
  | 'potential-soft-404-unprovable'
  | 'indeterminate-generateMetadata'
  | 'skip-unstable'
  | 'auto-self-canonical'
  | 'human-review-repoint'

export type ClassifyTopic14Input = {
  /** Multiple head canonicals → topic 17. */
  multipleHead: boolean
  targetStatus: number | null
  /** Target issued a 3xx (redirect: manual saw Location). */
  targetRedirects: boolean
  /** Final URL after chain when redirects followed for chain report. */
  finalUrlAfterRedirects: string | null
  finalStatusAfterRedirects: number | null
  /** Target carries noindex (soft-404 candidate when 200). */
  targetHasNoindex: boolean
  /** Soft-404 is topic 2a (provable) vs 2b (unprovable). */
  soft404Provable: boolean | null
  /** 5xx confirmed persistent across re-fetch? false → topic 3. */
  fiveXxStableAcrossRefetch: boolean | null
  /** Cross-domain and fetch failed / unreachable. */
  crossDomainUnreachable: boolean
  /** Page's own URL returns 200 (for auto self-canonical). */
  pageReturns200: boolean
  /** Repo site kind for the declaring page. */
  repoSiteKind:
    | 'page'
    | 'layout'
    | 'generateMetadata-indeterminate'
    | 'none'
    | 'unknown'
  /** Non-HTML target returning 200 is valid. */
  targetIsNonHtml200: boolean
}

export type ClassifyTopic14Result = {
  verdict: Topic14Verdict
  detail: string
}

export function classifyCanonicalTarget(
  input: ClassifyTopic14Input,
): ClassifyTopic14Result {
  if (input.multipleHead) {
    return {
      verdict: 'route-topic-17-multiple-head',
      detail: 'Multiple head canonicals — topic 17, not topic 14',
    }
  }

  if (input.repoSiteKind === 'generateMetadata-indeterminate') {
    return {
      verdict: 'indeterminate-generateMetadata',
      detail: 'generateMetadata sets canonical conditionally — indeterminate',
    }
  }

  if (input.crossDomainUnreachable) {
    return {
      verdict: 'route-topic-18-cross-domain',
      detail: 'Cross-domain target unreachable — topic 18, not dead (guard 4)',
    }
  }

  if (input.targetStatus == null) {
    return {
      verdict: 'skip-unstable',
      detail: 'Target status unavailable',
    }
  }

  if (input.targetRedirects) {
    return {
      verdict: 'finding-canonical-chain',
      detail: `Canonical target redirects (C17) — final ${input.finalStatusAfterRedirects ?? '?'} at ${input.finalUrlAfterRedirects ?? '?'}`,
    }
  }

  if (input.targetStatus >= 500) {
    if (input.fiveXxStableAcrossRefetch === false) {
      return {
        verdict: 'route-topic-3-transient-5xx',
        detail: 'Transient 5xx on canonical target — topic 3 (guard 2)',
      }
    }
    // Stable 5xx still availability — do not auto-fix as dead here per guard 2
    // framing; dossier routes transient to topic 3. Stable → treat as dead-ish
    // human path via skip / not auto.
    return {
      verdict: 'route-topic-3-transient-5xx',
      detail: '5xx on canonical target — availability problem (topic 3)',
    }
  }

  if (input.targetStatus >= 400 && input.targetStatus < 500) {
    if (input.pageReturns200 && input.repoSiteKind === 'page') {
      return {
        verdict: 'auto-self-canonical',
        detail: `Canonical target ${input.targetStatus} — repoint to self-referential on page file`,
      }
    }
    return {
      verdict: 'finding-dead-4xx',
      detail: `Canonical target returns ${input.targetStatus} (C8)`,
    }
  }

  if (input.targetStatus === 200) {
    if (input.targetIsNonHtml200) {
      return {
        verdict: 'ok',
        detail: 'Non-HTML canonical target returns 200 — valid (guard 5)',
      }
    }
    if (input.targetHasNoindex) {
      if (input.soft404Provable === false) {
        return {
          verdict: 'potential-soft-404-unprovable',
          detail: 'Soft-404 unprovable (2b) — potential only, never auto-fix (guard 3)',
        }
      }
      return {
        verdict: 'finding-soft-404',
        detail: 'Canonical target is soft-404 (200 + noindex) — topic 2a',
      }
    }
    return {
      verdict: 'ok',
      detail: 'Canonical target returns 200',
    }
  }

  return {
    verdict: 'human-review-repoint',
    detail: `Unexpected target status ${input.targetStatus}`,
  }
}
