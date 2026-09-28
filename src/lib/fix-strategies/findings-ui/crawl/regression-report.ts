/**
 * Change Monitoring 3.2 — how a regressed finding is reported to owners.
 *
 * Cross-references FIX_VERIFY_OUTCOME_RECORD.md for the PR that fixed a
 * finding when the live fix-flow row is missing. Never duplicates ledger
 * rows into the findings table.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PersistedFindingRow } from './constants'

export type FixPrRef = {
  prUrl: string
  prNumber: number | null
  /** Where the PR identity came from. */
  source: 'fix_flow' | 'outcome_ledger'
}

export type RegressionReport = {
  /** Always true when status === 'regressed'. */
  isRegression: boolean
  /** Distinct from a brand-new open finding of the same kind. */
  sameFindingId: string
  headline: string
  detail: string
  fixPr: FixPrRef | null
}

export function lookupOutcomeLedgerPr(input: {
  topicId: string
  verdict: string
  pageUrl: string | null
  markdown?: string
  repoRoot?: string
}): FixPrRef | null {
  const md =
    input.markdown ??
    (() => {
      const path = resolve(
        input.repoRoot ?? process.cwd(),
        'docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md',
      )
      if (!existsSync(path)) return ''
      return readFileSync(path, 'utf8')
    })()
  if (!md || !input.pageUrl) return null

  // Split on "## N." sections; match topic + verdict + page.
  const sections = md.split(/^## \d+\./m).slice(1)
  for (const section of sections) {
    const topic = section.match(/\|\s*Topic\s*\|\s*([^|]+)\|/i)?.[1]?.trim()
    const verdict = section
      .match(/\|\s*Verdict\s*\|\s*`?([^`|]+)`?\s*\|/i)?.[1]
      ?.trim()
    const page = section
      .match(/\|\s*Page\s*\|\s*`?([^`|]+)`?\s*\|/i)?.[1]
      ?.trim()
    if (topic !== input.topicId) continue
    if (verdict !== input.verdict) continue
    if (page !== input.pageUrl) continue

    const prLine = section.match(/\|\s*PR\s*\|\s*(.+?)\s*\|/i)?.[1]
    if (!prLine) return null
    const urlMatch = prLine.match(/\((https:\/\/github\.com\/[^)]+)\)/)
    const numMatch =
      prLine.match(/#(\d+)/) ||
      prLine.match(/pull\/(\d+)/) ||
      prLine.match(/\(#(\d+)\)/)
    if (!urlMatch) return null
    return {
      prUrl: urlMatch[1]!,
      prNumber: numMatch ? Number(numMatch[1]) : null,
      source: 'outcome_ledger',
    }
  }
  return null
}

export function resolveFixPrReference(input: {
  topicId: string
  verdict: string
  pageUrl: string | null
  fixFlow?: { prUrl: string | null; prNumber: number | null } | null
  outcomeMarkdown?: string
  repoRoot?: string
}): FixPrRef | null {
  if (input.fixFlow?.prUrl) {
    return {
      prUrl: input.fixFlow.prUrl,
      prNumber: input.fixFlow.prNumber ?? null,
      source: 'fix_flow',
    }
  }
  return lookupOutcomeLedgerPr({
    topicId: input.topicId,
    verdict: input.verdict,
    pageUrl: input.pageUrl,
    markdown: input.outcomeMarkdown,
    repoRoot: input.repoRoot,
  })
}

/**
 * Build the owner-facing regression report for a finding row.
 * Call only when status === 'regressed' (or assert isRegression false otherwise).
 */
export function buildRegressionReport(
  finding: Pick<
    PersistedFindingRow,
    | 'id'
    | 'status'
    | 'topicId'
    | 'verdict'
    | 'pageUrl'
    | 'resolvedAt'
    | 'fixedAt'
    | 'postFixStatus'
    | 'regressionObservedAt'
  >,
  opts?: {
    fixFlow?: { prUrl: string | null; prNumber: number | null } | null
    outcomeMarkdown?: string
    repoRoot?: string
  },
): RegressionReport {
  if (finding.status !== 'regressed') {
    return {
      isRegression: false,
      sameFindingId: finding.id,
      headline: 'Not a regression',
      detail: 'Finding is not in regressed status.',
      fixPr: null,
    }
  }

  const fixPr = resolveFixPrReference({
    topicId: finding.topicId,
    verdict: finding.verdict,
    pageUrl: finding.pageUrl,
    fixFlow: opts?.fixFlow,
    outcomeMarkdown: opts?.outcomeMarkdown,
    repoRoot: opts?.repoRoot,
  })

  const seorankoFixed = Boolean(finding.fixedAt) || Boolean(fixPr)

  if (seorankoFixed && fixPr) {
    const prLabel =
      fixPr.prNumber != null
        ? `PR #${fixPr.prNumber}`
        : fixPr.prUrl
    return {
      isRegression: true,
      sameFindingId: finding.id,
      headline: 'REGRESSION',
      detail:
        `This is the same finding (not a new one). SEORANKO previously fixed it in ${prLabel} (${fixPr.prUrl}); ` +
        `that fix appears to have been reverted or undone` +
        (finding.regressionObservedAt
          ? ` (observed ${finding.regressionObservedAt})`
          : '') +
        `. See docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md for the closed-loop ledger entry.`,
      fixPr,
    }
  }

  return {
    isRegression: true,
    sameFindingId: finding.id,
    headline: 'REGRESSION',
    detail:
      `This is the same finding (not a new one). It was previously resolved` +
      (finding.resolvedAt ? ` at ${finding.resolvedAt}` : '') +
      ` and the condition has reappeared` +
      (finding.regressionObservedAt
        ? ` (observed ${finding.regressionObservedAt})`
        : '') +
      `.`,
    fixPr: null,
  }
}
