/**
 * Apply live canonical verification to crawl results before surfacing findings.
 * Corrects stale or mis-attributed canonical steps and drops unconfirmed tasks.
 */

import { verifyCanonicalMisconfigurationLive } from './canonical-live-verify'
import {
  isIndexHtmlCanonicalMisconfiguration,
  parseCanonicalMismatchEvidence,
} from './canonical-equivalence'
import type { IndexDiagnosisResult, PageIndexability, SiteFollowUpTask } from './types'

function recalculateVerdict(page: PageIndexability): PageIndexability {
  const blockingSteps = ['http_status', 'robots_txt', 'meta_robots', 'x_robots'] as const
  let verdict: PageIndexability['verdict'] = 'INDEXABLE'
  let decisiveStep = null as PageIndexability['decisiveStep']
  let decisiveEvidence = 'All indexability checks passed'

  for (const step of page.steps) {
    if (blockingSteps.includes(step.step as (typeof blockingSteps)[number]) && !step.passed) {
      verdict = 'BLOCKED'
      decisiveStep = step.step
      decisiveEvidence = step.evidence
      break
    }
  }

  if (verdict === 'INDEXABLE') {
    const riskSteps = page.steps.filter(
      (s) =>
        !s.passed &&
        (s.step === 'canonical' ||
          s.step === 'internal_links_in' ||
          s.step === 'duplicate_cluster' ||
          s.step === 'crawl_depth'),
    )
    if (riskSteps.length > 0) {
      verdict = 'AT_RISK'
      decisiveStep = riskSteps[0]!.step
      decisiveEvidence = riskSteps[0]!.evidence
    }
  }

  return { ...page, verdict, decisiveStep, decisiveEvidence }
}

function candidateMisconfigurationPages(pages: PageIndexability[]): PageIndexability[] {
  return pages.filter((p) => {
    const canonStep = p.steps.find((s) => s.step === 'canonical')
    if (!canonStep || canonStep.passed) return false
    if (!canonStep.evidence.includes('different same-host URL')) return false
    const parsed = parseCanonicalMismatchEvidence(canonStep.evidence)
    if (!parsed) return false
    return isIndexHtmlCanonicalMisconfiguration(p.url, parsed.canonicalUrl)
  })
}

/**
 * Re-fetch each candidate index.html canonical misconfiguration live.
 * Updates page canonical steps when live HTML does not confirm the finding.
 */
export async function applyCanonicalLiveVerification(
  pages: PageIndexability[],
): Promise<{ pages: PageIndexability[]; liveVerifiedTaskIds: Set<string> }> {
  const candidates = candidateMisconfigurationPages(pages)
  const liveVerifiedTaskIds = new Set<string>()
  if (candidates.length === 0) {
    return { pages, liveVerifiedTaskIds }
  }

  const verifyResults = await Promise.all(
    candidates.map(async (p) => ({
      pageUrl: p.url,
      live: await verifyCanonicalMisconfigurationLive(p.url),
    })),
  )

  for (const r of verifyResults) {
    if (r.live.confirmedMisconfiguration) {
      liveVerifiedTaskIds.add(`canonical-index-html-${r.pageUrl}`)
    }
  }

  const updatedPages = pages.map((page) => {
    const match = verifyResults.find((r) => r.pageUrl === page.url)
    if (!match || match.live.confirmedMisconfiguration) return page

    const steps = page.steps.map((s) => {
      if (s.step !== 'canonical') return s
      return {
        ...s,
        passed: true,
        evidence: match.live.evidence,
      }
    })
    return recalculateVerdict({ ...page, steps })
  })

  return { pages: updatedPages, liveVerifiedTaskIds }
}

/** Drop canonical follow-up tasks that failed live verification. */
export function filterCanonicalTasksAfterLiveVerify(
  tasks: SiteFollowUpTask[],
  liveVerifiedTaskIds: Set<string>,
): SiteFollowUpTask[] {
  return tasks.filter((t) => {
    if (t.kind !== 'canonical') return true
    return liveVerifiedTaskIds.has(t.id)
  })
}

export async function finalizeIndexDiagnosisCanonicalFindings(
  partial: IndexDiagnosisResult,
): Promise<Pick<IndexDiagnosisResult, 'pages' | 'followUpTasks'>> {
  const { pages, liveVerifiedTaskIds } = await applyCanonicalLiveVerification(partial.pages)
  const followUpTasks = filterCanonicalTasksAfterLiveVerify(partial.followUpTasks, liveVerifiedTaskIds)
  return { pages, followUpTasks }
}
