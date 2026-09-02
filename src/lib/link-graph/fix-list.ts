/**
 * Fix list export — CSV / JSON for actionable edges.
 * Spec §6.3 — only rules with computable suggested_target.
 */

import type { FixListRow, LinkEdge, LinkFinding } from './types'

const FIX_LIST_RULES = new Set(['L04', 'L05', 'L06', 'L17', 'L18', 'L19', 'L27', 'L29'])

const REASONS: Record<string, string> = {
  L04: 'Multi-hop redirect — link to final URL',
  L05: 'Single redirect — link to final URL',
  L06: 'Non-canonical target — link to canonical',
  L17: 'HTTP link on HTTPS site',
  L18: 'Trailing-slash differs from site convention',
  L19: 'Host www/case differs from canonical host',
  L27: 'Sitemap URL redirects — list final URL',
  L29: 'Sitemap URL not self-canonical',
}

export function buildFixList(
  findings: LinkFinding[],
  edges: LinkEdge[],
): FixListRow[] {
  const rows: FixListRow[] = []
  const edgeLookup = (source: string | null, target: string | null): LinkEdge | undefined => {
    if (!source || !target) return undefined
    return edges.find((e) => e.sourceUrl === source && e.hrefResolved === target)
  }

  for (const f of findings) {
    if (!FIX_LIST_RULES.has(f.ruleId)) continue
    if (!f.suggestedTarget) continue
    const edge = edgeLookup(f.sourceUrl, f.targetUrl)
    rows.push({
      source_url: f.sourceUrl || '',
      current_href: edge?.hrefRaw || f.targetUrl || '',
      suggested_href: f.suggestedTarget,
      rule_id: f.ruleId,
      reason: REASONS[f.ruleId] || f.ruleId,
      dom_region: edge?.domRegion || 'unknown',
    })
  }
  return rows
}

export function fixListToCsv(rows: FixListRow[]): string {
  const header = 'source_url,current_href,suggested_href,rule_id,reason,dom_region'
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = rows.map((r) =>
    [r.source_url, r.current_href, r.suggested_href, r.rule_id, r.reason, r.dom_region]
      .map(escape)
      .join(','),
  )
  return [header, ...lines].join('\n')
}
