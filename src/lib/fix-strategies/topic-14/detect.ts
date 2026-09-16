/**
 * Topic 14 — detect canonical pointing at non-200 / chain / soft-404.
 *
 * Uses shared `extractCanonicalDeclarations` only.
 */

import {
  extractCanonicalDeclarations,
  hasNoindexDirective,
  normalizeFixStrategyUrl,
  recordRedirectHops,
  resolveFixTarget,
  type CanonicalDeclaration,
  type CanonicalExtraction,
  type FixTargetResult,
  type HopRecordingDeps,
} from '@/lib/fix-strategies/shared'
import {
  classifyCanonicalTarget,
  type Topic14Verdict,
} from './classify'

export type Topic14Finding = {
  kind:
    | 'canonical/target-not-200'
    | 'canonical/chain'
    | 'canonical/soft-404-target'
  pageUrl: string
  canonicalUrl: string
  verdict: Topic14Verdict
  detail: string
  targetStatus: number | null
  extraction: CanonicalExtraction
  fixTarget: FixTargetResult
}

export type DetectTopic14Result = {
  findings: Topic14Finding[]
  ok: Array<{ pageUrl: string; detail: string }>
  routed: Array<{ pageUrl: string; verdict: Topic14Verdict; detail: string }>
}

export type DetectTopic14Page = {
  url: string
  body: string
  headers?: Headers
  contentType?: string | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /** Page's own URL returns 200. */
  pageReturns200?: boolean
  repoSiteKind?:
    | 'page'
    | 'layout'
    | 'generateMetadata-indeterminate'
    | 'none'
    | 'unknown'
  /**
   * Soft-404 provable (topic 2a) when target is 200+noindex.
   * null = assume provable when noindex seen; false = 2b.
   */
  soft404Provable?: boolean | null
}

export type DetectTopic14Options = {
  deps: HopRecordingDeps
  /**
   * Same-origin host for cross-domain guard. Defaults to page URL host.
   */
  siteOrigin?: string
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase()
  } catch {
    return false
  }
}

function pickDeclaredCanonical(
  extraction: CanonicalExtraction,
): { decl: CanonicalDeclaration | null; multipleHead: boolean } {
  if (extraction.head.length > 1) {
    return { decl: null, multipleHead: true }
  }
  if (extraction.head.length === 1) {
    return { decl: extraction.head[0]!, multipleHead: false }
  }
  // Header-only still a declared canonical for topic 14
  if (extraction.header.length === 1) {
    return { decl: extraction.header[0]!, multipleHead: false }
  }
  if (extraction.header.length > 1) {
    // Multiple header decls — treat as multiple for routing safety
    return { decl: extraction.header[0]!, multipleHead: false }
  }
  return { decl: null, multipleHead: false }
}

export async function detectCanonicalTargetNot200(
  pages: DetectTopic14Page[],
  options: DetectTopic14Options,
): Promise<DetectTopic14Result> {
  const findings: Topic14Finding[] = []
  const ok: DetectTopic14Result['ok'] = []
  const routed: DetectTopic14Result['routed'] = []

  for (const page of pages) {
    const headers = page.headers ?? new Headers()
    const contentType =
      page.contentType ?? headers.get('content-type') ?? 'text/html'
    const extraction = extractCanonicalDeclarations(
      page.body,
      headers,
      page.url,
      contentType,
    )

    const { decl, multipleHead } = pickDeclaredCanonical(extraction)
    const fixTarget = resolveFixTarget({
      artefactPath: page.artefactPath ?? 'app/page.tsx',
      isGenerated: page.isGenerated ?? false,
      generatorPath: page.generatorPath ?? null,
    })

    if (!decl && !multipleHead) {
      ok.push({ pageUrl: page.url, detail: 'No canonical declared — not topic 14' })
      continue
    }

    if (multipleHead) {
      routed.push({
        pageUrl: page.url,
        verdict: 'route-topic-17-multiple-head',
        detail: 'Multiple head canonicals — topic 17',
      })
      continue
    }

    const targetUrl = decl!.normalized
    if (!targetUrl) {
      findings.push({
        kind: 'canonical/target-not-200',
        pageUrl: page.url,
        canonicalUrl: decl!.raw,
        verdict: 'human-review-repoint',
        detail: 'Canonical href unparseable',
        targetStatus: null,
        extraction,
        fixTarget,
      })
      continue
    }

    const origin = options.siteOrigin ?? page.url
    const crossDomain = !sameHost(targetUrl, origin)

    // First hop without following
    const first = await options.deps.fetch(targetUrl, {
      method: 'GET',
      redirect: 'manual',
    })
    const status = first.status
    const redirects = status >= 300 && status < 400

    let finalUrlAfterRedirects: string | null = null
    let finalStatusAfterRedirects: number | null = null
    let fiveXxStable: boolean | null = null
    let targetHasNoindex = false
    let targetIsNonHtml200 = false
    let crossDomainUnreachable = false

    if (redirects) {
      const chain = await recordRedirectHops(targetUrl, options.deps)
      finalUrlAfterRedirects = chain.finalUrl
      finalStatusAfterRedirects = chain.finalStatus
    } else if (status >= 500) {
      // Re-fetch once (topic 68 lite)
      const second = await options.deps.fetch(targetUrl, {
        method: 'GET',
        redirect: 'manual',
      })
      fiveXxStable = second.status >= 500
    } else if (status === 200) {
      const ct = first.headers.get('content-type')
      const bodyText = await first.text()
      targetHasNoindex = hasNoindexDirective(first.headers, bodyText, ct)
      targetIsNonHtml200 = !!(
        ct &&
        !/text\/html|application\/xhtml\+xml/i.test(ct)
      )
    } else if (crossDomain && (status === 0 || status >= 500)) {
      crossDomainUnreachable = true
    } else if (crossDomain && status >= 400) {
      // Reachable but dead — still topic 14; cross-domain guard is unreachable
    }

    // Network failure simulation: status 0 not from fetch API — use catch
    // (handled by try below for TypeError)

    const classified = classifyCanonicalTarget({
      multipleHead: false,
      targetStatus: status,
      targetRedirects: redirects,
      finalUrlAfterRedirects,
      finalStatusAfterRedirects,
      targetHasNoindex,
      soft404Provable: page.soft404Provable ?? (targetHasNoindex ? true : null),
      fiveXxStableAcrossRefetch: fiveXxStable,
      crossDomainUnreachable,
      pageReturns200: page.pageReturns200 ?? true,
      repoSiteKind: page.repoSiteKind ?? 'page',
      targetIsNonHtml200,
    })

    if (classified.verdict === 'ok') {
      ok.push({ pageUrl: page.url, detail: classified.detail })
      continue
    }

    if (
      classified.verdict.startsWith('route-') ||
      classified.verdict === 'indeterminate-generateMetadata' ||
      classified.verdict === 'skip-unstable' ||
      classified.verdict === 'potential-soft-404-unprovable'
    ) {
      routed.push({
        pageUrl: page.url,
        verdict: classified.verdict,
        detail: classified.detail,
      })
      continue
    }

    const kind =
      classified.verdict === 'finding-canonical-chain'
        ? 'canonical/chain'
        : classified.verdict === 'finding-soft-404'
          ? 'canonical/soft-404-target'
          : 'canonical/target-not-200'

    findings.push({
      kind,
      pageUrl: page.url,
      canonicalUrl: targetUrl,
      verdict: classified.verdict,
      detail: classified.detail,
      targetStatus: status,
      extraction,
      fixTarget,
    })
  }

  return { findings, ok, routed }
}

/** Self-canonical absolute URL for the page (normalized). */
export function selfCanonicalUrl(pageUrl: string): string | null {
  return normalizeFixStrategyUrl(pageUrl)
}
