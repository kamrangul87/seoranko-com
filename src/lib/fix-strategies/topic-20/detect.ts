/**
 * Topic 20 — meta robots vs X-Robots-Tag disagreement.
 *
 * Conflict is not breakage (R6 → more restrictive wins). High surprise:
 * HTML says index, header says noindex. robots vs googlebot = different
 * scopes, not a conflict. Expand none; case-insensitive.
 */

import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'
import {
  extractPageRobotsDirectives,
  tokenSetsEqual,
  type PageRobotsDirectives,
} from '@/lib/fix-strategies/shared/robots-directives'
import {
  resolveHeaderCanonicalScope,
  type HeaderCanonicalScope,
} from '@/lib/fix-strategies/shared/header-canonical-scope'

export type Topic20Severity = 'high' | 'moderate' | 'low' | null

export type Topic20Verdict =
  | 'ok'
  | 'informational-redundant'
  | 'finding-header-noindex-surprise'
  | 'finding-meta-stricter'
  | 'finding-nofollow-conflict'
  | 'suppress-robots-vs-googlebot-scopes'
  | 'indeterminate-header-scope'
  | 'suppress-non-html'

export type Topic20Finding = {
  kind: 'indexability/meta-header-disagree'
  pageUrl: string
  verdict: Topic20Verdict
  severity: Topic20Severity
  detail: string
  effectiveTokens: string[]
  headerScope: HeaderCanonicalScope | null
  autoFixable: boolean
  fixTarget: FixTargetResult
}

export type DetectTopic20Result = {
  findings: Topic20Finding[]
  informational: Array<{ pageUrl: string; detail: string }>
  suppressed: Array<{ pageUrl: string; verdict: Topic20Verdict; detail: string }>
}

export type DetectTopic20Page = {
  url: string
  body: string
  headers?: Headers
  contentType?: string | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

export type DetectTopic20Options = {
  repoRoot?: string
  headerScopeOverride?: HeaderCanonicalScope
}

function isNonHtml(ct: string | null, body: string): boolean {
  if (ct && /text\/html|application\/xhtml\+xml/i.test(ct)) return false
  if (ct) return true
  const head = body.slice(0, 256).toLowerCase()
  return !(head.includes('<html') || head.includes('<!doctype'))
}

export function classifyMetaHeaderDisagree(
  dirs: PageRobotsDirectives,
  opts: {
    isNonHtml: boolean
    headerScope: HeaderCanonicalScope | null
  },
): {
  verdict: Topic20Verdict
  severity: Topic20Severity
  detail: string
  autoFixable: boolean
} {
  if (opts.isNonHtml) {
    return {
      verdict: 'suppress-non-html',
      severity: null,
      detail: 'Non-HTML — header is the only mechanism (R4)',
      autoFixable: false,
    }
  }

  const meta = dirs.metaRobots
  const headers = dirs.xRobotsTags

  // robots vs googlebot only (no X-Robots) — not a conflict (R2)
  if (
    meta &&
    dirs.metaGooglebot &&
    headers.length === 0 &&
    !tokenSetsEqual(meta.tokens, dirs.metaGooglebot.tokens)
  ) {
    return {
      verdict: 'suppress-robots-vs-googlebot-scopes',
      severity: null,
      detail:
        'robots vs googlebot are different scopes (R2) — deliberate targeting, not a conflict',
      autoFixable: false,
    }
  }

  if (!meta || headers.length === 0) {
    return {
      verdict: 'ok',
      severity: null,
      detail: 'Only one declaration mechanism present',
      autoFixable: false,
    }
  }

  // Compare meta-robots with combined X-Robots-Tag tokens
  const headerTokens = new Set<string>()
  for (const h of headers) {
    for (const t of h.tokens) headerTokens.add(t)
  }

  if (tokenSetsEqual(meta.tokens, headerTokens)) {
    return {
      verdict: 'informational-redundant',
      severity: null,
      detail:
        'Meta and header identical after expansion — redundant, not conflicting',
      autoFixable: true,
    }
  }

  const metaNoindex = meta.tokens.has('noindex')
  const headerNoindex = headerTokens.has('noindex')
  const metaNofollow = meta.tokens.has('nofollow')
  const headerNofollow = headerTokens.has('nofollow')

  // Scope indeterminate for conflict findings that might remove header
  if (
    opts.headerScope &&
    (opts.headerScope.kind === 'indeterminate' ||
      opts.headerScope.kind === 'multi-route' ||
      opts.headerScope.kind === 'not-found')
  ) {
    // Still raise the surprise finding but mark indeterminate for fix
    if (!metaNoindex && headerNoindex) {
      return {
        verdict: 'indeterminate-header-scope',
        severity: 'high',
        detail:
          'HTML says index, header says noindex (high surprise) — header scope not statically resolvable (topic 70)',
        autoFixable: false,
      }
    }
  }

  if (!metaNoindex && headerNoindex) {
    return {
      verdict: 'finding-header-noindex-surprise',
      severity: 'high',
      detail:
        'Meta allows index but X-Robots-Tag says noindex — effective noindex (R6). Likely surprise.',
      autoFixable: false,
    }
  }

  if (metaNoindex && !headerNoindex) {
    return {
      verdict: 'finding-meta-stricter',
      severity: 'low',
      detail:
        'Meta says noindex, header allows index — effective noindex (R6). Low surprise.',
      autoFixable: false,
    }
  }

  if (!metaNofollow && headerNofollow) {
    return {
      verdict: 'finding-nofollow-conflict',
      severity: 'moderate',
      detail: 'follow vs nofollow conflict — effective nofollow (R6)',
      autoFixable: false,
    }
  }

  return {
    verdict: 'finding-meta-stricter',
    severity: 'low',
    detail: 'Directive sets differ after expansion — restrictive wins (R6)',
    autoFixable: false,
  }
}

export function detectMetaHeaderDisagree(
  pages: DetectTopic20Page[],
  options: DetectTopic20Options = {},
): DetectTopic20Result {
  const findings: Topic20Finding[] = []
  const informational: DetectTopic20Result['informational'] = []
  const suppressed: DetectTopic20Result['suppressed'] = []

  const headerScope: HeaderCanonicalScope | null =
    options.headerScopeOverride ??
    (options.repoRoot
      ? resolveXRobotsHeaderScope(options.repoRoot)
      : null)

  for (const page of pages) {
    const headers = page.headers ?? new Headers()
    const ct = page.contentType ?? headers.get('content-type') ?? 'text/html'
    const dirs = extractPageRobotsDirectives(headers, page.body, ct)
    const classified = classifyMetaHeaderDisagree(dirs, {
      isNonHtml: isNonHtml(ct, page.body),
      headerScope,
    })

    const fixTarget = resolveFixTarget({
      artefactPath: page.artefactPath ?? 'app/page.tsx',
      isGenerated: page.isGenerated ?? false,
      generatorPath: page.generatorPath ?? null,
    })

    if (
      classified.verdict === 'ok' ||
      classified.verdict.startsWith('suppress-')
    ) {
      suppressed.push({
        pageUrl: page.url,
        verdict: classified.verdict,
        detail: classified.detail,
      })
      continue
    }

    if (classified.verdict === 'informational-redundant') {
      informational.push({ pageUrl: page.url, detail: classified.detail })
      continue
    }

    findings.push({
      kind: 'indexability/meta-header-disagree',
      pageUrl: page.url,
      verdict: classified.verdict,
      severity: classified.severity,
      detail: classified.detail,
      effectiveTokens: Array.from(dirs.effectiveAllCrawlers),
      headerScope,
      autoFixable: classified.autoFixable,
      fixTarget,
    })
  }

  return { findings, informational, suppressed }
}

/** Resolve X-Robots-Tag header scope (same trap as topic 16 Link header). */
function resolveXRobotsHeaderScope(repoRoot: string): HeaderCanonicalScope {
  // Reuse next.config/middleware walker; look for x-robots-tag
  const scope = resolveHeaderCanonicalScope(repoRoot)
  // If we only found canonical Link, still return indeterminate for X-Robots
  // unless we scan — lightweight: if middleware/multi-route, same blast radius.
  return scope
}
