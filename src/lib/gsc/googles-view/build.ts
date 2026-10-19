import { classifyPageWithRedirect } from './classify-redirect'
import {
  classifyAlternateCanonical,
  classifyGoogleChoice,
  classifyNotFound404,
} from './classify-other'
import { GOOGLES_VIEW_FRAMING, reasonRowWhatToDo } from './copy'
import {
  coverageStateToReasonKind,
  isExplainedNotIndexedReason,
} from './reason-kind'
import type {
  GooglesViewRow,
  GooglesViewTable,
  IndexDiagnosisCauseSnippet,
  RedirectChainEvidence,
  UrlVerdictDetail,
} from './types'

export type GooglesViewInspectionInput = {
  url: string
  coverageState: string | null
  googleCanonical?: string | null
  userCanonical?: string | null
  gscValidationPassed?: boolean
}

export type LiveUrlEvidence = {
  /** For redirects: full recorded chain. */
  redirectChain?: RedirectChainEvidence
  /** For 404 / alternate: live final status of the page or target. */
  liveStatus?: number | null
  /** For alternate: whether the canonical target is self-canonical. */
  targetSelfCanonical?: boolean
  canonicalTargetUrl?: string | null
}

export type BuildGooglesViewInput = {
  siteId: string
  inspections: GooglesViewInspectionInput[]
  /** url → live evidence (redirect chain / status). */
  liveByUrl: Map<string, LiveUrlEvidence>
  /** Normalized or raw URLs present in sitemap. */
  sitemapUrls: Set<string>
  /** Normalized or raw URLs with inbound internal links. */
  linkedInternallyUrls: Set<string>
  /** Optional Index Diagnosis causes keyed by URL. */
  diagnosisCausesByUrl?: Map<string, IndexDiagnosisCauseSnippet>
}

function urlInSet(url: string, set: Set<string>): boolean {
  if (set.has(url)) return true
  try {
    const u = new URL(url)
    const trim = u.href.replace(/\/$/, '')
    if (set.has(trim) || set.has(`${trim}/`)) return true
    // also try without www
    const host = u.hostname.replace(/^www\./i, '')
    const variants = [
      `${u.protocol}//${host}${u.pathname}`,
      `${u.protocol}//www.${host}${u.pathname}`,
    ]
    for (const v of variants) {
      if (set.has(v) || set.has(v.replace(/\/$/, ''))) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function groupKey(coverageState: string): string {
  return coverageState.trim()
}

/**
 * Build the Google's view table from GSC inspection coverage states + live evidence.
 */
export function buildGooglesView(input: BuildGooglesViewInput): GooglesViewTable {
  const byReason = new Map<string, GooglesViewInspectionInput[]>()
  for (const row of input.inspections) {
    if (!row.coverageState || !isExplainedNotIndexedReason(row.coverageState)) {
      continue
    }
    const key = groupKey(row.coverageState)
    const list = byReason.get(key) || []
    list.push(row)
    byReason.set(key, list)
  }

  const rows: GooglesViewRow[] = []

  for (const [reason, items] of byReason) {
    const kind = coverageStateToReasonKind(reason)
    const urlDetails: UrlVerdictDetail[] = []

    for (const item of items) {
      const live = input.liveByUrl.get(item.url) || {}
      const inSitemap = urlInSet(item.url, input.sitemapUrls)
      const linked = urlInSet(item.url, input.linkedInternallyUrls)
      const diagnosis = input.diagnosisCausesByUrl?.get(item.url)

      if (kind === 'page_with_redirect') {
        const chain = live.redirectChain
        if (!chain) {
          urlDetails.push({
            url: item.url,
            destinationOrStatus: 'chain not fetched',
            verdict: 'PROBLEM',
            problem: true,
            detail: 'Could not record a live redirect chain for this URL.',
            problemReasons: ['chain_not_fetched'],
            relatedTopics: ['4'],
          })
          continue
        }
        const classified = classifyPageWithRedirect({
          pageUrl: item.url,
          chain,
          inSitemap,
          linkedInternally: linked,
        })
        const hopSummary = chain.hops
          .map((h) => `${h.status}${h.location ? `→${h.location}` : ''}`)
          .join(' · ')
        urlDetails.push({
          url: item.url,
          destinationOrStatus: `${hopSummary} · final ${chain.finalStatus} ${chain.finalUrl}`,
          verdict: classified.verdict,
          problem: classified.problem,
          detail: classified.summary,
          problemReasons: classified.problemReasons,
          relatedTopics: classified.problem
            ? Array.from(
                new Set([
                  ...(classified.problemReasons.includes('still_in_sitemap')
                    ? ['26']
                    : []),
                  ...(classified.problemReasons.includes('still_linked_internally')
                    ? ['42']
                    : []),
                  ...(classified.problemReasons.includes('final_4xx_5xx') ||
                  classified.problemReasons.includes('soft_404_to_homepage')
                    ? ['1']
                    : []),
                  ...(classified.problemReasons.includes(
                    'multi_hop_non_canonicalisation',
                  )
                    ? ['4']
                    : []),
                ]),
              )
            : [],
        })
        continue
      }

      if (kind === 'alternate_canonical') {
        const target =
          live.canonicalTargetUrl ||
          item.googleCanonical ||
          item.userCanonical ||
          null
        const classified = classifyAlternateCanonical({
          pageUrl: item.url,
          canonicalTargetUrl: target,
          targetStatus: live.liveStatus ?? null,
          targetSelfCanonical: live.targetSelfCanonical ?? false,
        })
        urlDetails.push({
          url: item.url,
          destinationOrStatus: target
            ? `${target} · HTTP ${live.liveStatus ?? '?'}`
            : 'no target',
          verdict: classified.verdict,
          problem: classified.problem,
          detail: classified.detail,
          relatedTopics: classified.relatedTopics,
        })
        continue
      }

      if (kind === 'not_found_404') {
        const classified = classifyNotFound404({
          pageUrl: item.url,
          liveStatus: live.liveStatus ?? null,
          inSitemap,
          linkedInternally: linked,
          gscValidationPassed: item.gscValidationPassed,
        })
        urlDetails.push({
          url: item.url,
          destinationOrStatus: `live HTTP ${live.liveStatus ?? 'unknown'}`,
          verdict: classified.verdict,
          problem: classified.problem,
          detail: classified.detail,
          relatedTopics: classified.relatedTopics,
        })
        continue
      }

      if (kind === 'crawled_not_indexed' || kind === 'discovered_not_indexed') {
        const causes = diagnosis?.causes || []
        const classified = classifyGoogleChoice({
          kind,
          indexDiagnosisCauses: causes,
        })
        urlDetails.push({
          url: item.url,
          destinationOrStatus: reason,
          verdict: classified.verdict,
          problem: classified.problem,
          detail: classified.detail,
          indexDiagnosisCauses: causes,
        })
        continue
      }
    }

    const anyProblem = urlDetails.some((u) => u.problem)
    rows.push({
      reason,
      reasonKind: kind,
      pageCount: urlDetails.length,
      problem: anyProblem,
      whatToDo: reasonRowWhatToDo({
        kind,
        problem: anyProblem,
        coverageState: reason,
      }),
      urls: urlDetails,
    })
  }

  rows.sort((a, b) => {
    if (a.problem !== b.problem) return a.problem ? -1 : 1
    return b.pageCount - a.pageCount
  })

  return {
    siteId: input.siteId,
    rows,
    framing: GOOGLES_VIEW_FRAMING,
  }
}
