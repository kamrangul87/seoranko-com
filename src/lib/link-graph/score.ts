/**
 * Impact ranking + verdict phrasing helpers.
 * Spec §6 — model only phrases from computed findings (optional); deterministic fallback always.
 */

import type { LinkFinding, LinkGraphResult } from './types'

const SEVERITY_WEIGHT: Record<string, number> = {
  CRITICAL: 10,
  FAIL: 4,
  WARN: 1,
}

export function impactScore(
  finding: LinkFinding,
  inlinkByTarget: Map<string, number>,
  affectedCount: number,
): number {
  const sev = SEVERITY_WEIGHT[finding.severity] || 1
  const inlinks = finding.targetUrl ? inlinkByTarget.get(finding.targetUrl) || 1 : 1
  const inlinkWeight = Math.log2(2 + inlinks)
  return sev * affectedCount * inlinkWeight
}

export function rankFindings(findings: LinkFinding[]): LinkFinding[] {
  const byRule = new Map<string, LinkFinding[]>()
  for (const f of findings) {
    const list = byRule.get(f.ruleId) || []
    list.push(f)
    byRule.set(f.ruleId, list)
  }

  const inlinkByTarget = new Map<string, number>()
  for (const f of findings) {
    if (!f.targetUrl) continue
    inlinkByTarget.set(f.targetUrl, (inlinkByTarget.get(f.targetUrl) || 0) + 1)
  }

  return findings.slice().sort((a, b) => {
    const aCount = byRule.get(a.ruleId)?.length || 1
    const bCount = byRule.get(b.ruleId)?.length || 1
    return (
      impactScore(b, inlinkByTarget, bCount) - impactScore(a, inlinkByTarget, aCount)
    )
  })
}

const RULE_TITLES: Record<string, { title: string; why: string; change: string }> = {
  L01: {
    title: 'Internal links point to 4xx URLs',
    why: 'Broken links waste crawl budget and send users to dead pages.',
    change: 'Update or remove the href on each source page listed in the findings.',
  },
  L02: {
    title: 'Internal links point to 5xx URLs',
    why: 'Server errors on linked URLs block crawlers and users.',
    change: 'Fix the destination server error or remove the link.',
  },
  L03: {
    title: 'Internal redirect loops',
    why: 'Loops prevent crawlers from reaching a final document.',
    change: 'Break the loop — pick one final URL and redirect (or link) directly to it.',
  },
  L04: {
    title: 'Internal redirect chains longer than one hop',
    why: 'Multi-hop chains dilute link equity and slow crawling.',
    change: 'Point the href at the final URL in the chain.',
  },
  L05: {
    title: 'Internal links that redirect once',
    why: 'Each redirect burns crawl budget; link to the final URL instead.',
    change: 'Replace the href with the final destination URL.',
  },
  L06: {
    title: 'Links to non-canonical URL variants',
    why: 'Pointing at a URL that canonicalizes elsewhere sends contradictory signals.',
    change: 'Update hrefs to the canonical target.',
  },
  L21: {
    title: 'Orphan pages with no internal inlinks',
    why: 'Pages Google cannot reach through your own links are hard to discover and rank.',
    change: 'Add contextual internal links from related indexable pages.',
  },
  L26: {
    title: 'Sitemap URLs return non-200',
    why: 'A sitemap claims a URL should be indexed — non-200 contradicts that.',
    change: 'Remove the URL from the sitemap or restore the page.',
  },
  L27: {
    title: 'Sitemap URLs redirect',
    why: 'Sitemaps should list final, indexable URLs only.',
    change: 'Replace the sitemap entry with the final URL.',
  },
  L28: {
    title: 'Sitemap URLs are noindex or robots-disallowed',
    why: 'Asking crawlers to index a URL you also block is a direct contradiction.',
    change: 'Remove from sitemap or remove the noindex / robots block.',
  },
  L29: {
    title: 'Sitemap URLs are not self-canonical',
    why: 'Sitemap entries should be the preferred canonical URL.',
    change: 'List the canonical URL in the sitemap instead.',
  },
  L00_JS_SUSPECTED: {
    title: 'JavaScript-rendered links suspected',
    why: 'Link coverage may be incomplete on SPA-style pages.',
    change: 'Verify important links exist in served HTML, or accept incomplete coverage for v1.',
  },
}

export function buildTopCauses(findings: LinkFinding[]): LinkGraphResult['topCauses'] {
  const byRule = new Map<string, number>()
  for (const f of findings) {
    byRule.set(f.ruleId, (byRule.get(f.ruleId) || 0) + 1)
  }
  const ranked = Array.from(byRule.entries()).sort((a, b) => {
    const aSev = Math.max(
      ...findings.filter((f) => f.ruleId === a[0]).map((f) => SEVERITY_WEIGHT[f.severity] || 0),
    )
    const bSev = Math.max(
      ...findings.filter((f) => f.ruleId === b[0]).map((f) => SEVERITY_WEIGHT[f.severity] || 0),
    )
    return bSev * b[1] - aSev * a[1]
  })

  return ranked.slice(0, 3).map(([ruleId, count]) => {
    const meta = RULE_TITLES[ruleId] || {
      title: `Rule ${ruleId}`,
      why: 'See findings evidence.',
      change: 'Review the listed URLs.',
    }
    return {
      ruleId,
      title: meta.title,
      affectedCount: count,
      whyItMatters: meta.why,
      whatToChange: meta.change,
    }
  })
}

/**
 * Deterministic one-line verdict from computed findings.
 * Never invents a rule_id not present in findings (acceptance test 10).
 */
export function buildVerdictHeadline(findings: LinkFinding[]): string {
  if (findings.length === 0) {
    return 'No link-graph issues detected from crawl data.'
  }
  const causes = buildTopCauses(findings)
  if (causes.length === 0) {
    return `${findings.length} link finding(s) detected.`
  }
  const parts = causes.map((c) => {
    if (c.ruleId === 'L05') return `${c.affectedCount} internal link(s) point at URLs that redirect`
    if (c.ruleId === 'L21') return `${c.affectedCount} page(s) have no internal links at all`
    if (c.ruleId === 'L01') return `${c.affectedCount} internal link(s) resolve to 4xx`
    if (c.ruleId === 'L06') return `${c.affectedCount} link(s) point at non-canonical URLs`
    return `${c.affectedCount} ${c.title.toLowerCase()}`
  })
  if (parts.length === 1) return parts[0]!.replace(/^\w/, (c) => c.toUpperCase()) + '.'
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}.`
  return `${parts[0]}, ${parts[1]}, and ${parts[2]}.`
}

/**
 * Assert report claims only reference rule_ids present in findings.
 */
export function assertReportOnlyUsesComputedRules(
  findings: LinkFinding[],
  reportRuleIds: string[],
): boolean {
  const allowed = new Set(findings.map((f) => f.ruleId))
  return reportRuleIds.every((id) => allowed.has(id))
}
