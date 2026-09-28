/**
 * Change Monitoring 3.4 — what-changed digest between two crawl finishes.
 *
 * Compares finding lifecycle on the same scope (site or detect-origin):
 * new / resolved / regressed since the previous terminal run.
 * Does not invent rankings or traffic claims.
 */

import type { PersistedFindingRow } from './constants'
import { buildRegressionReport } from './regression-report'

export type WhatChangedFindingRef = {
  id: string
  topicId: string
  verdict: string
  pageUrl: string | null
  status: PersistedFindingRow['status']
  detail: string
  /** Present for regressions — names PR when SEORANKO fixed it. */
  regressionDetail?: string | null
  fixPrUrl?: string | null
  fixPrNumber?: number | null
}

export type WhatChangedDigest = {
  runId: string
  previousRunId: string | null
  generatedAt: string
  newFindings: WhatChangedFindingRef[]
  resolvedFindings: WhatChangedFindingRef[]
  regressedFindings: WhatChangedFindingRef[]
  stillOpenCount: number
  summaryLine: string
}

function ref(
  f: PersistedFindingRow,
  opts?: { fixFlow?: { prUrl: string | null; prNumber: number | null } | null },
): WhatChangedFindingRef {
  const base: WhatChangedFindingRef = {
    id: f.id,
    topicId: f.topicId,
    verdict: f.verdict,
    pageUrl: f.pageUrl,
    status: f.status,
    detail: f.detail,
  }
  if (f.status === 'regressed') {
    const report = buildRegressionReport(f, { fixFlow: opts?.fixFlow })
    base.regressionDetail = report.detail
    base.fixPrUrl = report.fixPr?.prUrl ?? null
    base.fixPrNumber = report.fixPr?.prNumber ?? null
  }
  return base
}

/**
 * Build a what-changed digest for `currentRunId` given the scope's findings
 * and the previous terminal run id (if any).
 */
export function buildWhatChangedDigest(input: {
  currentRunId: string
  previousRunId: string | null
  findings: PersistedFindingRow[]
  /** Optional fix-flow PR lookup keyed by finding id. */
  fixFlowByFindingId?: Map<
    string,
    { prUrl: string | null; prNumber: number | null }
  >
  nowIso?: string
}): WhatChangedDigest {
  const generatedAt = input.nowIso ?? new Date().toISOString()
  const listable = input.findings.filter((f) => f.bucket !== 'internal')

  const newFindings = listable
    .filter((f) => f.firstSeenRunId === input.currentRunId)
    .map((f) =>
      ref(f, { fixFlow: input.fixFlowByFindingId?.get(f.id) }),
    )

  const resolvedFindings = listable
    .filter(
      (f) =>
        f.status === 'resolved' &&
        f.lastSeenRunId !== input.currentRunId &&
        f.resolvedAt != null,
    )
    .map((f) => ref(f))

  const regressedFindings = listable
    .filter(
      (f) =>
        f.status === 'regressed' && f.lastSeenRunId === input.currentRunId,
    )
    .map((f) =>
      ref(f, { fixFlow: input.fixFlowByFindingId?.get(f.id) }),
    )

  const stillOpenCount = listable.filter(
    (f) => f.status === 'open' || f.status === 'regressed',
  ).length

  const parts: string[] = []
  if (newFindings.length)
    parts.push(
      `${newFindings.length} new finding${newFindings.length === 1 ? '' : 's'}`,
    )
  if (resolvedFindings.length)
    parts.push(
      `${resolvedFindings.length} resolved`,
    )
  if (regressedFindings.length)
    parts.push(
      `${regressedFindings.length} regression${regressedFindings.length === 1 ? '' : 's'}`,
    )
  if (parts.length === 0) {
    parts.push(
      stillOpenCount > 0
        ? `No changes — ${stillOpenCount} still open`
        : 'No changes — no open findings',
    )
  }

  return {
    runId: input.currentRunId,
    previousRunId: input.previousRunId,
    generatedAt,
    newFindings,
    resolvedFindings,
    regressedFindings,
    stillOpenCount,
    summaryLine: parts.join(' · '),
  }
}

/** Previous terminal scheduled (preferred) or any terminal run, excluding current. */
export function pickPreviousTerminalRunId(
  runs: Array<{ id: string; status: string; trigger?: string; createdAt: string }>,
  currentRunId: string,
): string | null {
  const terminals = runs.filter(
    (r) =>
      r.id !== currentRunId &&
      (r.status === 'complete' || r.status === 'partial'),
  )
  const scheduled = terminals.filter((r) => r.trigger === 'scheduled')
  const pool = scheduled.length > 0 ? scheduled : terminals
  return pool[0]?.id ?? null
}
