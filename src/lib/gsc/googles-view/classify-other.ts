import type { GooglesViewVerdict } from './types'

export type AlternateCanonicalInput = {
  pageUrl: string
  /** Live-fetched canonical target (google or declared). */
  canonicalTargetUrl: string | null
  targetStatus: number | null
  targetSelfCanonical: boolean
}

export type AlternateCanonicalResult = {
  verdict: GooglesViewVerdict
  problem: boolean
  detail: string
  relatedTopics: string[]
}

export function classifyAlternateCanonical(
  input: AlternateCanonicalInput,
): AlternateCanonicalResult {
  if (!input.canonicalTargetUrl) {
    return {
      verdict: 'PROBLEM',
      problem: true,
      detail: 'Google marked an alternate canonical, but no target URL was available to verify.',
      relatedTopics: ['55'],
    }
  }
  if (input.targetStatus === 200 && input.targetSelfCanonical) {
    return {
      verdict: 'EXPECTED',
      problem: false,
      detail:
        'This URL correctly points to another page via the canonical tag. Google indexes the canonical URL.',
      relatedTopics: [],
    }
  }
  const bits: string[] = []
  if (input.targetStatus != null && input.targetStatus !== 200) {
    bits.push(`canonical target returned HTTP ${input.targetStatus}`)
  }
  if (!input.targetSelfCanonical) {
    bits.push('canonical target is not self-canonical')
  }
  return {
    verdict: 'PROBLEM',
    problem: true,
    detail: bits.join('; ') || 'Canonical target failed verification.',
    relatedTopics: ['55', '14'],
  }
}

export type NotFound404Input = {
  pageUrl: string
  liveStatus: number | null
  inSitemap: boolean
  linkedInternally: boolean
  /** When GSC validation workflow reports passed. */
  gscValidationPassed?: boolean
}

export type NotFound404Result = {
  verdict: GooglesViewVerdict
  problem: boolean
  detail: string
  relatedTopics: string[]
}

export function classifyNotFound404(input: NotFound404Input): NotFound404Result {
  // Live already recovered — Google's 404 row is historical.
  if (input.liveStatus === 200) {
    const validation = input.gscValidationPassed ? ' Validation passed.' : ''
    return {
      verdict: 'EXPECTED',
      problem: false,
      detail:
        `Live now returns HTTP 200. Google's Page Indexing still shows Not found (404) until it re-crawls.${validation}`,
      relatedTopics: [],
    }
  }

  const live404 =
    input.liveStatus === 404 ||
    input.liveStatus === 410 ||
    input.liveStatus == null

  if (live404 && !input.inSitemap && !input.linkedInternally) {
    const validation = input.gscValidationPassed ? ' Validation passed.' : ''
    return {
      verdict: 'EXPECTED',
      problem: false,
      detail:
        `This URL is gone and is not in your sitemap or internal links — healthy.${validation}`,
      relatedTopics: [],
    }
  }

  const topics: string[] = []
  if (input.inSitemap) topics.push('26')
  if (input.linkedInternally) topics.push('1')
  return {
    verdict: 'PROBLEM',
    problem: true,
    detail: [
      input.inSitemap ? 'URL is still listed in the sitemap' : null,
      input.linkedInternally ? 'URL is still linked internally' : null,
      input.liveStatus != null && input.liveStatus !== 404
        ? `live HTTP ${input.liveStatus}`
        : null,
    ]
      .filter(Boolean)
      .join('; '),
    relatedTopics: topics,
  }
}

export type GoogleChoiceInput = {
  kind: 'crawled_not_indexed' | 'discovered_not_indexed'
  indexDiagnosisCauses: string[]
}

export function classifyGoogleChoice(input: GoogleChoiceInput): {
  verdict: GooglesViewVerdict
  problem: boolean
  detail: string
} {
  const base =
    input.kind === 'crawled_not_indexed'
      ? "Google's choice, not a technical error — SEORANKO can't force indexing. Google crawled this URL and has not indexed it."
      : "Google's choice, not a technical error — SEORANKO can't force indexing. Google discovered this URL but has not crawled it yet."
  const causes =
    input.indexDiagnosisCauses.length > 0
      ? ` Index Diagnosis signals for these URLs: ${input.indexDiagnosisCauses.join('; ')}.`
      : ''
  return {
    verdict: 'INFO',
    problem: false,
    detail: base + causes,
  }
}
