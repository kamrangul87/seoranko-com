/**
 * Topic 55 — Google-chosen canonical differs from declared canonical.
 * Report-only / not mechanically fixable for the mismatch itself.
 */

import { normalizeCanonicalForGscMatch } from '@/lib/fix-strategies/shared/canonical-normalize'
import {
  isAlternatePageWithProperCanonical,
  type GscDetectContext,
  type GscInspectionRow,
} from '@/lib/fix-strategies/shared/gsc-detect-context'

export type Topic55Verdict = 'google-chose-different-canonical'

export type Topic55Finding = {
  verdict: Topic55Verdict
  pageUrl: string
  detail: string
  severity: 'moderate'
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

export type DetectTopic55Result = {
  findings: Topic55Finding[]
  suppressed: Array<{ pageUrl: string; reason: string }>
  ok: Array<{ pageUrl: string; verdict: string }>
}

export type DetectTopic55Options = {
  /** Null / absent → silent (no findings). */
  gsc: GscDetectContext | null
  /** Optional live declared canonicals from the crawl (url → canonical href). */
  declaredCanonicalByUrl?: Map<string, string | null>
}

function mismatchAfterNormalize(row: GscInspectionRow): boolean {
  const user = row.userCanonical
    ? normalizeCanonicalForGscMatch(row.userCanonical)
    : null
  const google = row.googleCanonical
    ? normalizeCanonicalForGscMatch(row.googleCanonical)
    : null
  if (!user || !google) return false
  return user !== google
}

export function detectGoogleChosenCanonicalMismatch(
  opts: DetectTopic55Options,
): DetectTopic55Result {
  const findings: Topic55Finding[] = []
  const suppressed: Array<{ pageUrl: string; reason: string }> = []
  const ok: Array<{ pageUrl: string; verdict: string }> = []

  if (!opts.gsc) {
    return { findings, suppressed, ok }
  }

  for (const row of opts.gsc.inspections) {
    if (isAlternatePageWithProperCanonical(row.coverageState)) {
      suppressed.push({
        pageUrl: row.url,
        reason: 'alternate_page_with_proper_canonical',
      })
      continue
    }

    // Prefer live crawl declaration when present; else Inspection userCanonical.
    const live = opts.declaredCanonicalByUrl?.get(row.urlNormalized)
    const userCanon =
      live && live.trim()
        ? live.trim()
        : row.userCanonical
    const googleCanon = row.googleCanonical
    if (!userCanon || !googleCanon) {
      ok.push({ pageUrl: row.url, verdict: 'insufficient_canonical_data' })
      continue
    }

    const userN = normalizeCanonicalForGscMatch(userCanon)
    const googleN = normalizeCanonicalForGscMatch(googleCanon)
    if (userN === googleN) {
      ok.push({ pageUrl: row.url, verdict: 'canonicals_agree' })
      continue
    }

    // Guard: do not collapse slash/case — normalizeCanonicalForGscMatch preserves them.
    if (!mismatchAfterNormalize({ ...row, userCanonical: userCanon, googleCanonical: googleCanon })) {
      ok.push({ pageUrl: row.url, verdict: 'canonicals_agree' })
      continue
    }

    findings.push({
      verdict: 'google-chose-different-canonical',
      pageUrl: row.url,
      severity: 'moderate',
      autoFixable: false,
      detail:
        `Google selected a different canonical than the site declared (historical Inspection). ` +
        `Declared: ${userCanon}. Google: ${googleCanon}. ` +
        `Last crawl: ${row.lastCrawlTime || 'unknown'}. ` +
        `This is not proof of a current fault — Inspect coverage may be partial.`,
      evidenceValues: {
        userCanonical: userCanon,
        googleCanonical: googleCanon,
        lastCrawlTime: row.lastCrawlTime,
        inspectedAt: row.inspectedAt,
        coverageState: row.coverageState,
        historical: true,
        inspectionCoveragePartial: opts.gsc.inspectionCoveragePartial,
      },
    })
  }

  return { findings, suppressed, ok }
}
