import type { CohortMetrics, PageIndexability } from './types'

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function buildCohort(
  cohortId: string,
  label: string,
  kind: CohortMetrics['kind'],
  members: PageIndexability[],
  siteMedianDepth: number,
  siteMedianDupDensity: number,
): CohortMetrics {
  const depths = members.map((m) => m.crawlDepth)
  const links = members.map((m) => m.internalLinksIn)
  const dupDensity =
    members.length === 0
      ? 0
      : members.filter((m) => m.duplicateClusterSize >= 2).length / members.length
  const atRiskShare =
    members.length === 0 ? 0 : members.filter((m) => m.verdict === 'AT_RISK').length / members.length

  const medDepth = median(depths)
  const medLinks = median(links)

  let flagged = false
  let flagReason: string | null = null
  let flagEvidence: string | null = null

  if (members.length >= 3) {
    if (siteMedianDupDensity > 0 && dupDensity >= siteMedianDupDensity * 1.5 && dupDensity >= 0.25) {
      flagged = true
      flagReason = 'high_duplicate_density'
      flagEvidence = `Cohort duplicate density ${(dupDensity * 100).toFixed(0)}% vs site median ${(siteMedianDupDensity * 100).toFixed(0)}%`
    }
    if (siteMedianDepth > 0 && medDepth >= siteMedianDepth * 1.5 && medDepth >= 2) {
      flagged = true
      flagReason = flagReason ? `${flagReason}+deep` : 'deep_cohort'
      flagEvidence = flagEvidence
        ? `${flagEvidence}; median depth ${medDepth} vs site ${siteMedianDepth}`
        : `Median depth ${medDepth} vs site median ${siteMedianDepth}`
    }
    if (atRiskShare >= 0.5 && members.length >= 5) {
      flagged = true
      flagReason = flagReason ? `${flagReason}+at_risk` : 'high_at_risk_share'
      flagEvidence = flagEvidence
        ? `${flagEvidence}; ${(atRiskShare * 100).toFixed(0)}% AT_RISK`
        : `${(atRiskShare * 100).toFixed(0)}% of cohort URLs are AT_RISK`
    }
  }

  return {
    cohortId,
    label,
    kind,
    size: members.length,
    medianInternalLinksIn: medLinks,
    medianDepth: medDepth,
    duplicateClusterDensity: dupDensity,
    atRiskShare,
    flagged,
    flagReason,
    flagEvidence,
  }
}

export function buildCohortComparison(pages: PageIndexability[]): CohortMetrics[] {
  if (pages.length === 0) return []

  const siteDupDensity =
    pages.filter((p) => p.duplicateClusterSize >= 2).length / pages.length
  const siteMedianDepth = median(pages.map((p) => p.crawlDepth))

  const cohorts: CohortMetrics[] = []

  // Path pattern cohorts
  const byPattern = new Map<string, PageIndexability[]>()
  for (const p of pages) {
    const list = byPattern.get(p.pathPattern) || []
    list.push(p)
    byPattern.set(p.pathPattern, list)
  }
  for (const [pattern, members] of byPattern) {
    cohorts.push(
      buildCohort(`path:${pattern}`, `Path ${pattern}`, 'path_pattern', members, siteMedianDepth, siteDupDensity),
    )
  }

  // Depth band cohorts
  const byDepth = new Map<string, PageIndexability[]>()
  for (const p of pages) {
    const list = byDepth.get(p.depthBand) || []
    list.push(p)
    byDepth.set(p.depthBand, list)
  }
  for (const [band, members] of byDepth) {
    cohorts.push(
      buildCohort(`depth:${band}`, `Depth band ${band}`, 'depth_band', members, siteMedianDepth, siteDupDensity),
    )
  }

  // Duplicate cluster cohorts (size >= 2)
  const byCluster = new Map<string, PageIndexability[]>()
  for (const p of pages) {
    if (!p.duplicateClusterId || p.duplicateClusterSize < 2) continue
    const list = byCluster.get(p.duplicateClusterId) || []
    list.push(p)
    byCluster.set(p.duplicateClusterId, list)
  }
  for (const [clusterId, members] of byCluster) {
    cohorts.push(
      buildCohort(
        `dup:${clusterId}`,
        `Duplicate cluster ${clusterId} (${members.length} URLs)`,
        'duplicate_cluster',
        members,
        siteMedianDepth,
        siteDupDensity,
      ),
    )
  }

  return cohorts.sort((a, b) => b.size - a.size)
}
