/**
 * Cross-topic root-cause linking.
 *
 * When findings from different topics share one decision (e.g. which URL form
 * is preferred), keep ONE primary finding actionable and attach the others as
 * related evidence — do not list them as separate actionable rows.
 *
 * Topic 8 preferred-form conflict is primary when topic 26
 * human-review-canonical-elsewhere only points at a trailing-slash or
 * index.html variant of the sitemap loc (canonical/sitemap disagreement is a
 * symptom of the unresolved preferred form).
 */

import {
  generateVariant,
  normalizeFixStrategyUrl,
} from '@/lib/fix-strategies/shared'
import type { DuplicateUrlStrategy } from '@/lib/fix-strategies/shared/duplicate-url-variants'

const PREFERRED_FORM_STRATEGIES: DuplicateUrlStrategy[] = [
  'trailing-slash',
  'index-html',
]

/** Minimal finding shape — avoids circular import with run-detectors. */
export type LinkableFinding = {
  topicId: string
  verdict: string
  detail: string
  pageUrl: string | null
  bucket: 'actionable' | 'informational' | 'internal'
  reportOnly: boolean
  surfaceClass: string
  evidenceValues: Record<string, unknown> | null
}

export type RelatedFindingEvidence = {
  topicId: string
  verdict: string
  detail: string
  pageUrl: string | null
  relationship: 'symptom'
  rootCause: 'preferred-url-form'
}

/** True when a and b differ only by trailing slash and/or directory index.html. */
export function arePreferredUrlFormVariants(a: string, b: string): boolean {
  const na = normalizeFixStrategyUrl(a) ?? a
  const nb = normalizeFixStrategyUrl(b) ?? b
  if (na === nb) return true

  for (const strategy of PREFERRED_FORM_STRATEGIES) {
    const fromA = generateVariant(na, strategy)
    if (fromA) {
      const pb = normalizeFixStrategyUrl(fromA.b) ?? fromA.b
      if (pb === nb) return true
    }
    const fromB = generateVariant(nb, strategy)
    if (fromB) {
      const pa = normalizeFixStrategyUrl(fromB.b) ?? fromB.b
      if (pa === na) return true
    }
  }

  // Transitive: /blog/ ↔ /blog/index.html via /blog
  const formsA = preferredFormClosure(na)
  const formsB = preferredFormClosure(nb)
  for (const fa of formsA) {
    if (formsB.has(fa)) return true
  }
  return false
}

function preferredFormClosure(url: string): Set<string> {
  const out = new Set<string>([url])
  let grew = true
  while (grew) {
    grew = false
    for (const u of Array.from(out)) {
      for (const strategy of PREFERRED_FORM_STRATEGIES) {
        const pair = generateVariant(u, strategy)
        if (!pair) continue
        const nb = normalizeFixStrategyUrl(pair.b) ?? pair.b
        if (!out.has(nb)) {
          out.add(nb)
          grew = true
        }
      }
    }
  }
  return out
}

/** Parse canonical target from topic 26 human-review-canonical-elsewhere detail. */
export function parseCanonicalElsewhereTarget(detail: string): string | null {
  const arrow = detail.match(
    /Canonicalises elsewhere\s*→\s*(\S+)/i,
  )
  if (arrow?.[1]) return arrow[1].replace(/[.,;)]+$/, '')
  const url = detail.match(/→\s*(https?:\/\/\S+)/i)
  if (url?.[1]) return url[1].replace(/[.,;)]+$/, '')
  return null
}

function candidateUrls(f: LinkableFinding): string[] {
  const urls = new Set<string>()
  if (f.pageUrl) urls.add(f.pageUrl)
  const members = f.evidenceValues?.memberUrls
  if (Array.isArray(members)) {
    for (const u of members) {
      if (typeof u === 'string' && u) urls.add(u)
    }
  }
  return Array.from(urls)
}

function overlapsPreferredFormFamily(
  primary: LinkableFinding,
  loc: string,
  canonical: string,
): boolean {
  const urls = candidateUrls(primary)
  if (urls.length === 0) return false
  return urls.some(
    (u) =>
      arePreferredUrlFormVariants(u, loc) ||
      arePreferredUrlFormVariants(u, canonical),
  )
}

function attachRelated(
  primary: LinkableFinding,
  related: RelatedFindingEvidence,
): void {
  const base =
    primary.evidenceValues && typeof primary.evidenceValues === 'object'
      ? { ...primary.evidenceValues }
      : {}
  const existing = Array.isArray(base.relatedFindings)
    ? (base.relatedFindings as RelatedFindingEvidence[])
    : []
  // Dedupe by topic+verdict+pageUrl
  const key = `${related.topicId}|${related.verdict}|${related.pageUrl ?? ''}`
  if (
    existing.some(
      (r) => `${r.topicId}|${r.verdict}|${r.pageUrl ?? ''}` === key,
    )
  ) {
    primary.evidenceValues = {
      ...base,
      rootCause: 'preferred-url-form',
      relatedFindings: existing,
    }
    return
  }
  primary.evidenceValues = {
    ...base,
    rootCause: 'preferred-url-form',
    relatedFindings: [...existing, related],
  }
  if (!primary.detail.includes('Related: topic 26')) {
    primary.detail = `${primary.detail} Related: topic 26 canonical-elsewhere is a symptom of this preferred-form decision.`
  }
}

/**
 * Mutates the findings list: demotes linked non-primaries to bucket internal
 * and attaches them on the primary via evidenceValues.relatedFindings.
 */
export function linkCrossTopicRootCauses<T extends LinkableFinding>(
  findings: T[],
): T[] {
  const primaries = findings.filter(
    (f) =>
      f.topicId === '8' &&
      f.verdict === 'human-review-preferred-conflict' &&
      f.bucket === 'actionable',
  )
  if (primaries.length === 0) return findings

  for (const f of findings) {
    if (f.topicId !== '26') continue
    if (f.verdict !== 'human-review-canonical-elsewhere') continue
    if (f.bucket !== 'actionable') continue

    const loc = f.pageUrl
    if (!loc) continue
    const canonical = parseCanonicalElsewhereTarget(f.detail)
    if (!canonical) continue

    // Only link when canonical is a preferred-form variant of the loc —
    // a truly different page is a distinct decision.
    if (!arePreferredUrlFormVariants(loc, canonical)) continue

    const primary = primaries.find((p) =>
      overlapsPreferredFormFamily(p, loc, canonical),
    )
    if (!primary) continue

    attachRelated(primary, {
      topicId: '26',
      verdict: f.verdict,
      detail: f.detail,
      pageUrl: f.pageUrl,
      relationship: 'symptom',
      rootCause: 'preferred-url-form',
    })

    // Demote — not listed separately as actionable
    f.bucket = 'internal'
    f.reportOnly = true
    f.surfaceClass = 'internal'
    f.evidenceValues = {
      ...(f.evidenceValues ?? {}),
      linkedToPrimary: {
        topicId: primary.topicId,
        verdict: primary.verdict,
        pageUrl: primary.pageUrl,
        rootCause: 'preferred-url-form',
      },
    }
  }

  return findings
}
