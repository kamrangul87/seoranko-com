/**
 * Topic 17 — detect multiple rel=canonical declarations.
 *
 * Counts ALL declarations (head + body), normalised. Never first-by-order.
 * Uses shared `extractCanonicalDeclarations` only.
 */

import {
  extractCanonicalDeclarations,
  resolveFixTarget,
  type CanonicalExtraction,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'
import {
  classifyMultipleCanonicals,
  type Topic17Verdict,
} from './classify'

export type Topic17Finding = {
  kind: 'canonical/multiple-tags'
  pageUrl: string
  verdict: Topic17Verdict
  detail: string
  scopedOutcomeNote: string | null
  distinctTargets: string[]
  collapseTo: string | null
  repoSites: string[]
  extraction: CanonicalExtraction
  fixTarget: FixTargetResult
}

export type DetectTopic17Result = {
  findings: Topic17Finding[]
  ok: Array<{ pageUrl: string; detail: string }>
  routed: Array<{ pageUrl: string; verdict: Topic17Verdict; detail: string }>
}

export type DetectTopic17Page = {
  url: string
  body: string
  headers?: Headers
  contentType?: string | null
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
  /** Repo declaration sites (page + layout) from topic 70. */
  repoSites?: string[]
}

export function detectMultipleCanonicals(
  pages: DetectTopic17Page[],
): DetectTopic17Result {
  const findings: Topic17Finding[] = []
  const ok: DetectTopic17Result['ok'] = []
  const routed: DetectTopic17Result['routed'] = []

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

    const documentDecls = [...extraction.head, ...extraction.body]
    const repoSites = page.repoSites ?? []
    const multiRepoSites = repoSites.length >= 2

    const classified = classifyMultipleCanonicals({
      documentDecls,
      headerCount: extraction.header.length,
      multiRepoSites,
      repoSites,
    })

    const fixTarget = resolveFixTarget({
      artefactPath: page.artefactPath ?? 'app/page.tsx',
      isGenerated: page.isGenerated ?? false,
      generatorPath: page.generatorPath ?? null,
    })

    if (classified.verdict === 'ok') {
      ok.push({ pageUrl: page.url, detail: classified.detail })
      continue
    }

    if (classified.verdict === 'route-topic-16') {
      routed.push({
        pageUrl: page.url,
        verdict: classified.verdict,
        detail: classified.detail,
      })
      continue
    }

    findings.push({
      kind: 'canonical/multiple-tags',
      pageUrl: page.url,
      verdict: classified.verdict,
      detail: classified.detail,
      scopedOutcomeNote: classified.scopedOutcomeNote,
      distinctTargets: classified.distinctTargets,
      collapseTo: classified.collapseTo,
      repoSites,
      extraction,
      fixTarget,
    })
  }

  return { findings, ok, routed }
}
