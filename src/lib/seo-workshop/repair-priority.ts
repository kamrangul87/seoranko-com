// Deterministic, explainable "Repair Priority" scoring — spec §2 is explicit
// that this must never be presented as a ranking prediction, so every
// contributing weight is exported and named, not hidden inside one function.

import { classifyAuditIssue } from '@/lib/fix-agent-classification'
import type {
  SeoIssueActionability,
  SeoIssueConfidence,
  SeoIssueEffort,
  SeoIssueSeverity,
} from './types'

export const SEVERITY_WEIGHT: Record<SeoIssueSeverity, number> = {
  critical: 40,
  warning: 20,
  notice: 8,
}

export const CONFIDENCE_WEIGHT: Record<SeoIssueConfidence, number> = {
  high: 15,
  medium: 8,
  low: 3,
}

export const EFFORT_WEIGHT: Record<SeoIssueEffort, number> = {
  '2min': 10,
  '30min': 6,
  '1hour': 2,
}

export const AUTO_FIXABLE_BONUS = 10

/** Saturating bucket, not a linear multiplier — one issue on 1,000 URLs
 * shouldn't automatically outrank everything else by 1,000x; it should
 * read as "this affects a lot of the site" and stop there. */
export function scaleWeight(affectedUrlCount: number): number {
  const n = Math.max(1, affectedUrlCount)
  if (n <= 1) return 5
  if (n <= 5) return 12
  if (n <= 20) return 18
  if (n <= 100) return 22
  return 25
}

export interface RepairPriorityInput {
  severity: SeoIssueSeverity
  affectedUrlCount: number
  confidence?: SeoIssueConfidence | null
  effort?: SeoIssueEffort | null
  autoFixable?: boolean
}

/** 0–100. Reasoning is `severity + affected-URL scale + confidence +
 * effort + an auto-fixable bonus`, clamped. This is "Repair Priority", not
 * a ranking prediction — see spec §2 / §26. */
export function computeRepairPriority(input: RepairPriorityInput): number {
  const severity = SEVERITY_WEIGHT[input.severity] ?? 0
  const scale = scaleWeight(input.affectedUrlCount)
  const confidence = input.confidence ? CONFIDENCE_WEIGHT[input.confidence] : 0
  // An issue with unknown effort isn't assumed easy — fall between 30min and 1hour.
  const effort = input.effort ? EFFORT_WEIGHT[input.effort] : 4
  const bonus = input.autoFixable ? AUTO_FIXABLE_BONUS : 0
  return Math.max(0, Math.min(100, Math.round(severity + scale + confidence + effort + bonus)))
}

export interface ActionabilityInput {
  issueKey: string
  category: string
  severity: SeoIssueSeverity
  message: string
}

/**
 * Defers to the real, actively-maintained Fix Agent classifier
 * (fix-agent-classification.ts) rather than guessing independently — an
 * earlier version of this function hand-maintained its own 3-key list,
 * which went stale the moment a real, much richer classifier shipped
 * covering meta/schema/lang/alt/llms.txt/security-headers/html-structure.
 * `connectionType` is intentionally omitted here (this runs at crawl-time,
 * before any specific site connection is known) — the classifier's own
 * "no connection context" branch already answers conservatively (keeps
 * structural DOM fixes as auto, demotes header/file fixes to human) rather
 * than overpromising what an unknown connector can do.
 */
export function classifyActionability(input: ActionabilityInput): SeoIssueActionability {
  const classified = classifyAuditIssue({
    id: input.issueKey,
    severity: input.severity === 'notice' ? 'info' : input.severity,
    category: input.category,
    title: input.message,
    description: input.message,
  })
  if (classified.fixability === 'auto') return 'AUTO_FIXABLE'
  if (classified.fixability === 'human') return 'HUMAN_GUIDED'
  return 'NOT_ACTIONABLE_AUTOMATICALLY' // 'skip' — informational, no action either way
}

/** Reuses RANKO's existing critical/high/medium/low impact vocabulary
 * (ranko-diagnosis.ts) rather than inventing a fourth severity-like scale.
 * Impact answers "how much does this matter", severity answers "how bad is
 * this instance" — they usually agree but affected-URL count can push a
 * warning-severity issue up to high impact. */
export function classifyImpact(input: RepairPriorityInput): 'critical' | 'high' | 'medium' | 'low' {
  if (input.severity === 'critical') return input.affectedUrlCount >= 5 ? 'critical' : 'high'
  if (input.severity === 'warning') return input.affectedUrlCount >= 20 ? 'high' : 'medium'
  return input.affectedUrlCount >= 50 ? 'medium' : 'low'
}
