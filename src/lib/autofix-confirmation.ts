/**
 * Phase 9 — safe auto-fix confirmation.
 *
 * Never report "Fixed automatically" until:
 * 1) original issue identified
 * 2) fix applied
 * 3) final article revalidated
 * 4) original issue confirmed resolved
 * 5) no new severe regression introduced
 */

import type { IssueSeverity } from '@/lib/article-quality-gate'

export type AutoFixIssueSnapshot = {
  id: string
  category: string
  severity: IssueSeverity
  title: string
}

export type AutoFixConfirmation = {
  /** Issues present before autofix that are gone after revalidation. */
  confirmedResolved: AutoFixIssueSnapshot[]
  /** Issues that remain after revalidation (not resolved). */
  stillOpen: AutoFixIssueSnapshot[]
  /** New critical/warning issues that appeared only after autofix. */
  regressions: AutoFixIssueSnapshot[]
  /** Raw mutation attempts (regex applies) — NOT the same as confirmedResolved. */
  mutationAttempts: number
  scoreBefore: number
  scoreAfter: number
  /** Honest user-facing summary. */
  summary: string
  /** True when UI may say issues were fixed (all attempts confirmed, no severe regressions). */
  mayReportAsFixed: boolean
  /** True when autofix changed content but revalidation found new problems. */
  revalidationFoundAdditionalIssues: boolean
}

function key(i: AutoFixIssueSnapshot): string {
  return `${i.category}::${i.id}`
}

function isSevere(i: AutoFixIssueSnapshot): boolean {
  return i.severity === 'critical' || i.severity === 'warning'
}

export function confirmAutoFixOutcomes(input: {
  beforeIssues: AutoFixIssueSnapshot[]
  afterIssues: AutoFixIssueSnapshot[]
  mutationAttempts: number
  scoreBefore: number
  scoreAfter: number
}): AutoFixConfirmation {
  const beforeSevere = input.beforeIssues.filter(isSevere)
  const afterSevere = input.afterIssues.filter(isSevere)
  const afterKeys = new Set(afterSevere.map(key))
  const beforeKeys = new Set(beforeSevere.map(key))

  const confirmedResolved = beforeSevere.filter((i) => !afterKeys.has(key(i)))
  const stillOpen = afterSevere.filter((i) => beforeKeys.has(key(i)))
  const regressions = afterSevere.filter((i) => !beforeKeys.has(key(i)))

  const revalidationFoundAdditionalIssues = regressions.length > 0
  const mayReportAsFixed =
    confirmedResolved.length > 0 &&
    !revalidationFoundAdditionalIssues &&
    input.scoreAfter >= input.scoreBefore - 1

  let summary: string
  if (input.mutationAttempts === 0 && confirmedResolved.length === 0) {
    summary = 'No auto-fixes were applied.'
  } else if (revalidationFoundAdditionalIssues) {
    summary = `Auto-fix changed the article and revalidation found additional issues (${regressions.length} new). Score ${input.scoreBefore} → ${input.scoreAfter}.`
  } else if (confirmedResolved.length > 0 && stillOpen.length > 0) {
    summary = `Confirmed ${confirmedResolved.length} auto-fix(es) after revalidation. ${stillOpen.length} issue(s) remain. Score ${input.scoreBefore} → ${input.scoreAfter}.`
  } else if (confirmedResolved.length > 0) {
    summary = `Confirmed ${confirmedResolved.length} auto-fix(es) after revalidation. Score ${input.scoreBefore} → ${input.scoreAfter}.`
  } else {
    summary = `Auto-fix ran (${input.mutationAttempts} mutation(s)) but revalidation did not confirm the original issues as resolved. Score ${input.scoreBefore} → ${input.scoreAfter}.`
  }

  return {
    confirmedResolved,
    stillOpen,
    regressions,
    mutationAttempts: input.mutationAttempts,
    scoreBefore: input.scoreBefore,
    scoreAfter: input.scoreAfter,
    summary,
    mayReportAsFixed,
    revalidationFoundAdditionalIssues,
  }
}

export function scoreFromIssues(issues: Array<{ severity: IssueSeverity }>): number {
  const criticalCount = issues.filter((i) => i.severity === 'critical').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  return Math.max(0, 100 - criticalCount * 20 - warningCount * 5)
}
