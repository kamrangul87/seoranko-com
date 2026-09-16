/**
 * Topic 26 — detect sitemap locs that are not indexable.
 *
 * Auto-fixable (Stage 2):
 * - confirmed 4xx → remove
 * - repo-declared noindex → remove
 * - single-hop 301/308 → replace with final 200 target
 *
 * Routed / review:
 * - transient 5xx → topic 3
 * - 5xx stableAcrossRefetch → human-review (not topic 3's windowed persistent-5xx)
 * - injected noindex → topic 2a (still remove, different cause)
 * - canonicalises-elsewhere → human-review
 * - multi-hop redirect → topic 4
 */

import {
  fetchWithEvidence,
  type FetchDeps,
} from '@/lib/fix-strategies/fetch'
import {
  checkRepoDeclaredNoindex,
  hasNoindexDirective,
  normalizeFixStrategyUrl,
  recordRedirectHops,
  resolveFixTarget,
} from '@/lib/fix-strategies/shared'
import { resolvePath } from '@/lib/fix-strategies/site-model'
import {
  extractHtmlCanonical,
  isNonHtmlIndexableResource,
  isSelfCanonical,
} from './classify-signals'
import { extractSitemapLocs } from './parse-sitemap'

export type Topic26Verdict =
  | 'auto-remove-confirmed-4xx'
  | 'auto-remove-repo-noindex'
  | 'auto-remove-injected-noindex' // topic 2a cause; still remove
  | 'auto-replace-single-hop-redirect'
  | 'route-topic-3-transient-5xx'
  | 'human-review-5xx-stableAcrossRefetch'
  | 'human-review-canonical-elsewhere'
  | 'human-review-indeterminate-noindex'
  | 'route-topic-4-redirect-chain'
  | 'ok'
  | 'skip-unstable'

export type Topic26Finding = {
  loc: string
  verdict: Topic26Verdict
  /** Replacement URL when verdict is auto-replace-single-hop-redirect. */
  replaceWith?: string
  detail: string
}

export type SitemapArtefactContext = {
  /** Path of the sitemap artefact (file or URL path label). */
  artefactPath: string
  /** True when the sitemap is produced at build time. */
  isGenerated: boolean
  /** Path to sitemap.ts / generator script when known. */
  generatorPath: string | null
  /** App directory for repo-declared noindex resolution. */
  appDir: string
  /** Site origin used to resolve relative paths and site-model paths. */
  siteOrigin: string
}

export type DetectTopic26Result = {
  findings: Topic26Finding[]
  /** Locs with no finding (healthy 200 / PDF / ok). */
  ok: string[]
  fixTarget: ReturnType<typeof resolveFixTarget>
}

function urlPathForSiteModel(loc: string, siteOrigin: string): string {
  try {
    const u = new URL(loc, siteOrigin)
    return u.pathname || '/'
  } catch {
    return '/'
  }
}

function isStableRedirect(status: number): boolean {
  return status === 301 || status === 308
}

/**
 * Classify every sitemap loc. Does not mutate the sitemap.
 */
export async function detectSitemapNotIndexable(
  sitemapXml: string,
  ctx: SitemapArtefactContext,
  deps: FetchDeps,
): Promise<DetectTopic26Result> {
  const fixTarget = resolveFixTarget({
    artefactPath: ctx.artefactPath,
    generatorPath: ctx.generatorPath,
    isGenerated: ctx.isGenerated,
  })

  const locs = extractSitemapLocs(sitemapXml)
  const findings: Topic26Finding[] = []
  const ok: string[] = []

  for (const loc of locs) {
    const normalized = normalizeFixStrategyUrl(loc, ctx.siteOrigin) ?? loc
    const finding = await classifyLoc(normalized, ctx, deps)
    if (finding.verdict === 'ok') ok.push(normalized)
    else findings.push(finding)
  }

  return { findings, ok, fixTarget }
}

async function classifyLoc(
  loc: string,
  ctx: SitemapArtefactContext,
  deps: FetchDeps,
): Promise<Topic26Finding> {
  const hops = await recordRedirectHops(loc, { fetch: deps.fetch })

  // Redirect chain
  if (hops.hops.length >= 1 && hops.hops[0]!.status >= 300 && hops.hops[0]!.status < 400) {
    const redirectHops = hops.hops.filter((h) => h.status >= 300 && h.status < 400)
    const first = hops.hops[0]!

    if (
      redirectHops.length === 1 &&
      isStableRedirect(first.status) &&
      hops.stoppedReason === 'non-3xx' &&
      hops.finalStatus === 200 &&
      hops.finalUrl
    ) {
      const target = normalizeFixStrategyUrl(hops.finalUrl) ?? hops.finalUrl
      return {
        loc,
        verdict: 'auto-replace-single-hop-redirect',
        replaceWith: target,
        detail: `Single-hop ${first.status} → ${target}`,
      }
    }

    if (redirectHops.length > 1 || hops.stoppedReason === 'max-hops') {
      return {
        loc,
        verdict: 'route-topic-4-redirect-chain',
        detail: `Redirect chain length ${redirectHops.length} (${hops.stoppedReason})`,
      }
    }

    // 302/307 or redirect to non-200 — not Stage 2 auto-fix
    return {
      loc,
      verdict: 'route-topic-4-redirect-chain',
      detail: `Non-auto-fixable redirect status ${first.status} → final ${hops.finalStatus}`,
    }
  }

  const status = hops.finalStatus

  // 5xx — re-fetch to separate transient vs stableAcrossRefetch
  // (topic 3's windowed persistent-5xx is a separate, longer classification)
  if (status >= 500 && status < 600) {
    const evidence = await fetchWithEvidence(loc, deps)
    const httpAttempts = evidence.attempts.filter((a) => a.kind === 'http')
    const stableAcrossRefetch =
      httpAttempts.length >= 2 &&
      httpAttempts.every((a) => a.kind === 'http' && a.status >= 500 && a.status < 600)

    if (stableAcrossRefetch) {
      return {
        loc,
        verdict: 'human-review-5xx-stableAcrossRefetch',
        detail: `5xx stableAcrossRefetch across ${httpAttempts.length} attempts (not topic-3 persistent window)`,
      }
    }

    return {
      loc,
      verdict: 'route-topic-3-transient-5xx',
      detail: evidence.stable
        ? '5xx cleared on re-fetch'
        : `5xx not stable (${evidence.reason})`,
    }
  }

  // 4xx — confirm via topic 68
  if (status >= 400 && status < 500 && status !== 429) {
    const evidence = await fetchWithEvidence(loc, deps)
    if (!evidence.stable) {
      return {
        loc,
        verdict: 'skip-unstable',
        detail: `4xx unstable (${evidence.reason})`,
      }
    }
    if (
      evidence.outcome.kind === 'http' &&
      evidence.outcome.status >= 400 &&
      evidence.outcome.status < 500 &&
      evidence.outcome.status !== 429
    ) {
      return {
        loc,
        verdict: 'auto-remove-confirmed-4xx',
        detail: `Confirmed ${evidence.outcome.status}`,
      }
    }
    return {
      loc,
      verdict: 'skip-unstable',
      detail: '4xx not confirmed on re-fetch',
    }
  }

  if (status === 429) {
    return {
      loc,
      verdict: 'route-topic-3-transient-5xx',
      detail: '429 treated as availability, not a sitemap removal',
    }
  }

  if (status < 200 || status >= 300) {
    return {
      loc,
      verdict: 'skip-unstable',
      detail: `Unhandled status ${status}`,
    }
  }

  // 2xx
  const contentType = hops.finalHeaders.get('content-type')
  if (isNonHtmlIndexableResource(contentType, loc)) {
    return { loc, verdict: 'ok', detail: 'Non-HTML 200 resource (e.g. PDF)' }
  }

  const noindex = hasNoindexDirective(
    hops.finalHeaders,
    hops.finalBody,
    contentType,
  )

  if (noindex) {
    const path = urlPathForSiteModel(loc, ctx.siteOrigin)
    const resolved = resolvePath(ctx.appDir, path)
    if (resolved.routeFile) {
      const declared = checkRepoDeclaredNoindex(resolved.routeFile, ctx.appDir)
      if (declared === 'true') {
        return {
          loc,
          verdict: 'auto-remove-repo-noindex',
          detail: 'Repo-declared noindex (topic 70)',
        }
      }
      if (declared === 'indeterminate') {
        return {
          loc,
          verdict: 'human-review-indeterminate-noindex',
          detail:
            'noindex present but generateMetadata robots is indeterminate',
        }
      }
    }
    // Not declared in repo → injected (topic 2a). Still remove; record cause.
    return {
      loc,
      verdict: 'auto-remove-injected-noindex',
      detail: 'Injected noindex — topic 2a (page gone); remove from sitemap',
    }
  }

  const canonical = extractHtmlCanonical(hops.finalBody, loc, contentType)
  if (!isSelfCanonical(loc, canonical) && canonical != null) {
    return {
      loc,
      verdict: 'human-review-canonical-elsewhere',
      detail: `Canonicalises elsewhere → ${canonical}`,
    }
  }

  return { loc, verdict: 'ok', detail: '200 indexable self-canonical' }
}
