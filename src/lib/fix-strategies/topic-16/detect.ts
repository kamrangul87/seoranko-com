/**
 * Topic 16 — detect HTML vs HTTP Link header canonical disagreement.
 *
 * Uses shared `extractCanonicalDeclarations` + `resolveHeaderCanonicalScope`.
 */

import {
  distinctNormalizedTargets,
  extractCanonicalDeclarations,
  resolveFixTarget,
  resolveHeaderCanonicalScope,
  type CanonicalExtraction,
  type FixTargetResult,
  type HeaderCanonicalScope,
} from '@/lib/fix-strategies/shared'
import {
  classifyHtmlHeaderCanonicalDisagree,
  type Topic16Verdict,
} from './classify'

export type Topic16Finding = {
  kind: 'canonical/html-header-disagree'
  pageUrl: string
  verdict: Topic16Verdict
  detail: string
  scopedOutcomeNote: string | null
  headTarget: string | null
  headerTarget: string | null
  headerScope: HeaderCanonicalScope
  extraction: CanonicalExtraction
  fixTarget: FixTargetResult
}

export type DetectTopic16Result = {
  findings: Topic16Finding[]
  informational: Array<{ pageUrl: string; detail: string }>
  suppressed: Array<{ pageUrl: string; reason: string; verdict: Topic16Verdict }>
  routed: Array<{ pageUrl: string; verdict: Topic16Verdict; detail: string }>
}

export type DetectTopic16Page = {
  url: string
  body: string
  headers?: Headers
  contentType?: string | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /** Preferred form from topics 8–12 when known. */
  preferredForm?: string | null
  /** Either target already known unhealthy (fixtures). */
  eitherTargetUnhealthy?: boolean
}

export type DetectTopic16Options = {
  repoRoot?: string
  /** Override header scope (fixtures). */
  headerScopeOverride?: HeaderCanonicalScope
}

function isNonHtml(contentType: string | null, body: string): boolean {
  if (contentType) {
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) return false
    return true
  }
  const head = body.slice(0, 256).toLowerCase()
  return !(head.includes('<html') || head.includes('<!doctype html'))
}

export function detectHtmlHeaderCanonicalDisagree(
  pages: DetectTopic16Page[],
  options: DetectTopic16Options = {},
): DetectTopic16Result {
  const findings: Topic16Finding[] = []
  const informational: DetectTopic16Result['informational'] = []
  const suppressed: DetectTopic16Result['suppressed'] = []
  const routed: DetectTopic16Result['routed'] = []

  const headerScope: HeaderCanonicalScope =
    options.headerScopeOverride ??
    (options.repoRoot
      ? resolveHeaderCanonicalScope(options.repoRoot)
      : {
          kind: 'indeterminate',
          file: null,
          detail: 'No repoRoot — header scope indeterminate',
        })

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

    const fixTarget = resolveFixTarget({
      artefactPath: page.artefactPath ?? 'app/page.tsx',
      isGenerated: page.isGenerated ?? false,
      generatorPath: page.generatorPath ?? null,
    })

    const headTargets = distinctNormalizedTargets(extraction.head)
    const headerTargets = distinctNormalizedTargets(extraction.header)
    const headTarget = headTargets[0] ?? null
    const headerTarget = headerTargets[0] ?? null
    const targetsEqual =
      headTarget != null &&
      headerTarget != null &&
      headTarget === headerTarget

    const htmlMatchesPreferred =
      page.preferredForm != null && headTarget != null
        ? headTarget === page.preferredForm
        : null

    const classified = classifyHtmlHeaderCanonicalDisagree({
      hasHead: extraction.head.length > 0,
      hasHeader: extraction.header.length > 0,
      multipleHead: extraction.head.length > 1,
      headTarget,
      headerTarget,
      targetsEqual,
      isNonHtml: isNonHtml(contentType, page.body),
      eitherTargetUnhealthy: page.eitherTargetUnhealthy ?? false,
      headerScope: headerScope.kind,
      htmlMatchesPreferred,
    })

    if (
      classified.verdict === 'ok' ||
      classified.verdict.startsWith('suppress-')
    ) {
      suppressed.push({
        pageUrl: page.url,
        reason: classified.detail,
        verdict: classified.verdict,
      })
      continue
    }

    if (classified.verdict === 'informational-redundant') {
      informational.push({ pageUrl: page.url, detail: classified.detail })
      continue
    }

    if (
      classified.verdict.startsWith('route-') ||
      classified.verdict === 'indeterminate-header-scope'
    ) {
      if (classified.verdict === 'indeterminate-header-scope') {
        findings.push({
          kind: 'canonical/html-header-disagree',
          pageUrl: page.url,
          verdict: classified.verdict,
          detail: classified.detail,
          scopedOutcomeNote: classified.scopedOutcomeNote,
          headTarget,
          headerTarget,
          headerScope,
          extraction,
          fixTarget,
        })
      } else {
        routed.push({
          pageUrl: page.url,
          verdict: classified.verdict,
          detail: classified.detail,
        })
      }
      continue
    }

    findings.push({
      kind: 'canonical/html-header-disagree',
      pageUrl: page.url,
      verdict: classified.verdict,
      detail: classified.detail,
      scopedOutcomeNote: classified.scopedOutcomeNote,
      headTarget,
      headerTarget,
      headerScope,
      extraction,
      fixTarget,
    })
  }

  return { findings, informational, suppressed, routed }
}
