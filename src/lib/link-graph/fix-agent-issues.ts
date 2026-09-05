/**
 * Bridge Link Graph findings → Fix Agent PageAuditIssue entries.
 * L04/L05/L06 (and other suggested-target rules): rewrite href to suggestedTarget.
 * L01 (4xx): remove dead link from source page(s) — same as Index Diagnosis.
 */

import type { PageAuditIssue, PageAuditFixMetadata } from '@/lib/page-audit-engine'
import type { LinkFinding, LinkGraphResult } from '@/lib/link-graph/types'

/** Rules whose suggestedTarget is a mechanical href rewrite. */
export const LINK_HREF_REWRITE_RULES = new Set([
  'L04',
  'L05',
  'L06',
  'L17',
  'L18',
  'L19',
])

/** Single-hop + multi-hop redirect rules — bulk “fix all redirect-hop links”. */
export const LINK_REDIRECT_HOP_RULES = new Set(['L04', 'L05'])

export interface LinkHrefFixEntry {
  sourceUrl: string
  fromHref: string
  toHref: string
  ruleId: string
}

function meta(partial: PageAuditFixMetadata): PageAuditFixMetadata {
  return partial
}

function pathLabel(url: string): string {
  try {
    return new URL(url).pathname || url
  } catch {
    return url
  }
}

function rewriteFindings(findings: LinkFinding[]): LinkFinding[] {
  return findings.filter(
    (f) =>
      LINK_HREF_REWRITE_RULES.has(f.ruleId) &&
      f.suggestedTarget &&
      f.sourceUrl &&
      f.targetUrl &&
      f.suggestedTarget !== f.targetUrl,
  )
}

function deadLinkFindings(findings: LinkFinding[]): LinkFinding[] {
  return findings.filter((f) => f.ruleId === 'L01' && f.sourceUrl && f.targetUrl)
}

function entriesFromFindings(findings: LinkFinding[]): LinkHrefFixEntry[] {
  const out: LinkHrefFixEntry[] = []
  const seen = new Set<string>()
  for (const f of rewriteFindings(findings)) {
    const raw =
      typeof f.evidence?.hrefRaw === 'string' ? f.evidence.hrefRaw : f.targetUrl!
    const key = `${f.sourceUrl}|${f.targetUrl}|${f.suggestedTarget}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      sourceUrl: f.sourceUrl!,
      fromHref: raw || f.targetUrl!,
      toHref: f.suggestedTarget!,
      ruleId: f.ruleId,
    })
  }
  return out
}

function bulkIssue(
  id: string,
  title: string,
  description: string,
  entries: LinkHrefFixEntry[],
  evidence: string,
): PageAuditIssue {
  return {
    id,
    severity: 'warning',
    category: 'link-graph',
    title,
    description,
    remediation:
      'Auto-fixable on GitHub-connected sites: Fix Agent updates each source page <a href> to the suggested destination, then re-fetches to verify. Fully revertible.',
    fixMetadata: meta({
      kind: 'rewrite-link-href',
      hrefFixes: entries.map((e) => ({
        sourceUrl: e.sourceUrl,
        fromHref: e.fromHref,
        toHref: e.toHref,
        ruleId: e.ruleId,
      })),
      sourceUrls: Array.from(new Set(entries.map((e) => e.sourceUrl))),
      evidence,
    }),
  }
}

/**
 * Build Fix Agent issues from a Link Graph result.
 * Includes per-finding issues, category bulk issues, and L01 dead-link removals.
 */
export function buildLinkGraphFixAgentIssues(result: LinkGraphResult): PageAuditIssue[] {
  const issues: PageAuditIssue[] = []
  const findings = result.findings || []

  const allRewrite = entriesFromFindings(findings)
  const redirectEntries = allRewrite.filter((e) => LINK_REDIRECT_HOP_RULES.has(e.ruleId))
  const nonCanonicalEntries = allRewrite.filter((e) => e.ruleId === 'L06')

  if (redirectEntries.length > 0) {
    issues.push(
      bulkIssue(
        'link-bulk-redirect-hops',
        `Fix all redirect-hop links (${redirectEntries.length})`,
        `${redirectEntries.length} internal link(s) point at URLs that redirect. Each has a computed final destination.`,
        redirectEntries,
        `bulk L04/L05 × ${redirectEntries.length}`,
      ),
    )
  }

  if (nonCanonicalEntries.length > 0) {
    issues.push(
      bulkIssue(
        'link-bulk-non-canonical',
        `Fix all non-canonical link targets (${nonCanonicalEntries.length})`,
        `${nonCanonicalEntries.length} internal link(s) point at non-canonical URL variants.`,
        nonCanonicalEntries,
        `bulk L06 × ${nonCanonicalEntries.length}`,
      ),
    )
  }

  for (const entry of allRewrite) {
    issues.push({
      id: `link-href-${entry.ruleId}-${encodeURIComponent(entry.sourceUrl)}-${encodeURIComponent(entry.fromHref)}`,
      severity: entry.ruleId === 'L04' ? 'critical' : 'warning',
      category: 'link-graph',
      title: `Update link href (${entry.ruleId}): ${pathLabel(entry.fromHref)} → ${pathLabel(entry.toHref)}`,
      description: `On ${entry.sourceUrl}, href ${entry.fromHref} should point to ${entry.toHref}.`,
      remediation:
        'Auto-fixable: Fix Agent rewrites the <a href> on the source page to the suggested destination.',
      fixMetadata: meta({
        kind: 'rewrite-link-href',
        hrefFixes: [
          {
            sourceUrl: entry.sourceUrl,
            fromHref: entry.fromHref,
            toHref: entry.toHref,
            ruleId: entry.ruleId,
          },
        ],
        fromUrl: entry.fromHref,
        toUrl: entry.toHref,
        sourceUrls: [entry.sourceUrl],
        evidence: entry.ruleId,
      }),
    })
  }

  const byDead = new Map<string, string[]>()
  for (const f of deadLinkFindings(findings)) {
    const dead = f.targetUrl!
    const list = byDead.get(dead) || []
    if (f.sourceUrl && !list.includes(f.sourceUrl)) list.push(f.sourceUrl)
    byDead.set(dead, list)
  }
  for (const [deadUrl, sources] of Array.from(byDead.entries())) {
    if (sources.length === 0) continue
    issues.push({
      id: `link-dead-link-remove-${encodeURIComponent(deadUrl)}`,
      severity: 'critical',
      category: 'link-graph',
      title: `Remove dead internal link to ${pathLabel(deadUrl)}`,
      description: `Link Graph L01: target returns 4xx. Linked from ${sources.length} page(s).`,
      remediation:
        'Auto-fixable: Fix Agent removes the dead <a href> from source page(s). Does not recreate the missing destination.',
      fixMetadata: meta({
        kind: 'remove-dead-link',
        deadUrl,
        sourceUrls: sources,
        evidence: 'L01',
      }),
    })
  }

  return issues
}

/** Bulk redirect-hop issue only (for the “Fix all redirect-hop links” button). */
export function buildRedirectHopBulkIssue(result: LinkGraphResult): PageAuditIssue | null {
  const entries = entriesFromFindings(result.findings || []).filter((e) =>
    LINK_REDIRECT_HOP_RULES.has(e.ruleId),
  )
  if (entries.length === 0) return null
  return bulkIssue(
    'link-bulk-redirect-hops',
    `Fix all redirect-hop links (${entries.length})`,
    `${entries.length} internal link(s) point at URLs that redirect.`,
    entries,
    `bulk L04/L05 × ${entries.length}`,
  )
}

/** One paste-ready rewrite issue for a single finding row (Manual Fix). */
export function buildSingleHrefRewriteIssue(finding: {
  ruleId: string
  sourceUrl: string | null
  targetUrl: string | null
  suggestedTarget: string | null
  evidence?: Record<string, unknown>
}): PageAuditIssue | null {
  if (
    !finding.sourceUrl ||
    !finding.targetUrl ||
    !finding.suggestedTarget ||
    !LINK_HREF_REWRITE_RULES.has(finding.ruleId)
  ) {
    return null
  }
  const fromHref =
    typeof finding.evidence?.hrefRaw === 'string'
      ? finding.evidence.hrefRaw
      : finding.targetUrl
  return {
    id: `link-href-manual-${finding.ruleId}-${encodeURIComponent(finding.sourceUrl)}`,
    severity: 'warning',
    category: 'link-graph',
    title: `Update link href: ${pathLabel(fromHref)} → ${pathLabel(finding.suggestedTarget)}`,
    description: `On ${finding.sourceUrl}, replace href with ${finding.suggestedTarget}.`,
    remediation: 'Paste the source page HTML to apply this href rewrite locally.',
    fixMetadata: meta({
      kind: 'rewrite-link-href',
      hrefFixes: [
        {
          sourceUrl: finding.sourceUrl,
          fromHref,
          toHref: finding.suggestedTarget,
          ruleId: finding.ruleId,
        },
      ],
      fromUrl: fromHref,
      toUrl: finding.suggestedTarget,
      sourceUrls: [finding.sourceUrl],
      evidence: finding.ruleId,
    }),
  }
}
