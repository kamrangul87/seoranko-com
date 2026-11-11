/**
 * Related reading / footer-only findings that are no longer actionable.
 * Marked dismissed/obsolete on load — never deleted. Never auto-merges.
 */

import {
  RELATED_TRANSFORM_VERSION,
  relatedAnchorLooksTruncated,
} from '@/lib/fix-strategies/related-articles/anchors'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared'
import { classifyCustomerPr, type CustomerPrState } from './customer-pr'
import { isUtilityPage } from './utility-page'

export type ObsoleteFindingInput = {
  pageUrl?: string | null
  evidenceValues?: Record<string, unknown> | null
  proposedDiff?: Record<string, unknown> | null
}

export type ObsoleteFindingContext = {
  status?: string | null
  hasCustomerPr?: boolean
  customerPr?: CustomerPrState | null
  inContentInlinkKeys?: Set<string>
}

function relatedTargetsFrom(row: ObsoleteFindingInput): Array<{ href: string; anchorText: string }> {
  const ev = row.evidenceValues || {}
  const fromEv = ev.relatedTargets
  const proposed = row.proposedDiff?.proposed as { relatedTargets?: unknown } | undefined
  const raw = Array.isArray(fromEv)
    ? fromEv
    : Array.isArray(proposed?.relatedTargets)
      ? proposed.relatedTargets
      : []
  const out: Array<{ href: string; anchorText: string }> = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const href = (t as { href?: unknown }).href
    const anchorText = (t as { anchorText?: unknown }).anchorText
    if (typeof href === 'string' && href.trim()) {
      out.push({
        href,
        anchorText: typeof anchorText === 'string' ? anchorText : '',
      })
    }
  }
  return out
}

function originOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export function hrefMatchKeys(href: string, pageUrl?: string | null): string[] {
  const keys = new Set<string>()
  const origin = originOf(pageUrl)
  const add = (raw: string) => {
    if (!raw) return
    keys.add(raw)
    const n = normalizeFixStrategyUrl(raw, origin) ?? normalizeFixStrategyUrl(raw, origin || 'https://example.invalid')
    if (n) keys.add(n)
    try {
      const u = new URL(n || raw, origin || 'https://example.invalid')
      const path = u.pathname.replace(/\/+$/, '') || '/'
      keys.add(path)
      keys.add(path.replace(/\.html?$/i, '') || '/')
    } catch {
      const path = raw.split(/[?#]/)[0] || raw
      keys.add(path.replace(/\/+$/, '') || path)
    }
  }
  add(href)
  return [...keys]
}

function hrefHitsInContent(
  href: string,
  keys: Set<string>,
  pageUrl?: string | null,
): boolean {
  return hrefMatchKeys(href, pageUrl).some((k) => keys.has(k))
}

function footerOnlyTargetNowHasInContent(
  row: ObsoleteFindingInput,
  keys: Set<string>,
): boolean {
  const ev = row.evidenceValues || {}
  if (typeof ev.targetUrl === 'string' && hrefHitsInContent(ev.targetUrl, keys, row.pageUrl)) {
    return true
  }
  for (const t of relatedTargetsFrom(row)) {
    if (hrefHitsInContent(t.href, keys, row.pageUrl)) return true
  }
  return false
}

export function obsoleteReasonForRelatedFinding(
  row: ObsoleteFindingInput,
  ctx: ObsoleteFindingContext = {},
): string | null {
  if (ctx.status === 'merged') return null
  if (classifyCustomerPr(ctx.customerPr) === 'closed_unmerged') {
    return 'pr-closed-unmerged'
  }
  if (isUtilityPage({ url: row.pageUrl })) return 'utility-page'
  const ev = row.evidenceValues || {}
  if (typeof ev.targetUrl === 'string' && isUtilityPage({ url: ev.targetUrl })) {
    return 'utility-page'
  }
  const targets = relatedTargetsFrom(row)
  for (const t of targets) {
    if (isUtilityPage({ url: t.href, href: t.href })) return 'utility-page'
  }
  const version = ev.relatedTransformVersion
  if (typeof version === 'number' && version < RELATED_TRANSFORM_VERSION) {
    return 'old-transform'
  }
  if (ctx.hasCustomerPr && typeof version !== 'number') return 'old-transform'
  for (const t of targets) {
    if (relatedAnchorLooksTruncated(t.anchorText, t.href)) return 'truncated-anchor'
  }
  if (
    ev.linkHealthKind === 'orphan-footer-only' &&
    ctx.inContentInlinkKeys &&
    ctx.inContentInlinkKeys.size > 0 &&
    footerOnlyTargetNowHasInContent(row, ctx.inContentInlinkKeys)
  ) {
    return 'in-content-inlinks'
  }
  return null
}

export function relatedFindingIsObsolete(
  row: ObsoleteFindingInput,
  ctx: ObsoleteFindingContext = {},
): boolean {
  return obsoleteReasonForRelatedFinding(row, ctx) != null
}

export function markObsoleteFinding(
  existing: Record<string, unknown> | null | undefined,
  reason: string,
): Record<string, unknown> {
  return {
    ...(existing || {}),
    dismissed: true,
    obsolete: true,
    dismissedReason: reason,
    dismissedAt: new Date().toISOString(),
    neverAutoMerge: true,
    requiresApproval: true,
  }
}

export function markObsoleteUtilityFinding(
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return markObsoleteFinding(existing, 'utility-page')
}

export function isObsoleteEvidence(
  evidenceValues: Record<string, unknown> | null | undefined,
): boolean {
  const ev = evidenceValues || {}
  return ev.obsolete === true || ev.dismissed === true
}
