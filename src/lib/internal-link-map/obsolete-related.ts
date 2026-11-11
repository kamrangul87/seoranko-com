/**
 * Pending Related reading / footer-only findings that violate the utility-page
 * rules. Marked dismissed/obsolete on load — never deleted.
 */

import { isUtilityPage } from './utility-page'

export type ObsoleteFindingInput = {
  pageUrl?: string | null
  evidenceValues?: Record<string, unknown> | null
  proposedDiff?: Record<string, unknown> | null
}

function relatedTargetsFrom(row: ObsoleteFindingInput): Array<{ href: string }> {
  const ev = row.evidenceValues || {}
  const fromEv = ev.relatedTargets
  const proposed = row.proposedDiff?.proposed as { relatedTargets?: unknown } | undefined
  const raw = Array.isArray(fromEv)
    ? fromEv
    : Array.isArray(proposed?.relatedTargets)
      ? proposed.relatedTargets
      : []
  const out: Array<{ href: string }> = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const href = (t as { href?: unknown }).href
    if (typeof href === 'string' && href.trim()) out.push({ href })
  }
  return out
}

export function relatedFindingIsObsolete(row: ObsoleteFindingInput): boolean {
  if (isUtilityPage({ url: row.pageUrl })) return true
  const ev = row.evidenceValues || {}
  if (typeof ev.targetUrl === 'string' && isUtilityPage({ url: ev.targetUrl })) {
    return true
  }
  for (const t of relatedTargetsFrom(row)) {
    if (isUtilityPage({ url: t.href, href: t.href })) return true
  }
  return false
}

export function markObsoleteUtilityFinding(
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    ...(existing || {}),
    dismissed: true,
    obsolete: true,
    dismissedReason: 'utility-page',
    dismissedAt: new Date().toISOString(),
    neverAutoMerge: true,
    requiresApproval: true,
  }
}

export function isObsoleteEvidence(
  evidenceValues: Record<string, unknown> | null | undefined,
): boolean {
  const ev = evidenceValues || {}
  return ev.obsolete === true || ev.dismissed === true
}
