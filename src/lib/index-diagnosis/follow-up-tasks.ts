/**
 * Mechanical follow-up tasks derived from Index Diagnosis crawl data.
 * No model calls — pattern matching on evidence fields only.
 */

import type { CohortMetrics, IndexDiagnosisResult, PageIndexability, SiteFollowUpTask } from './types'

function canonicalMismatchTasks(pages: PageIndexability[]): SiteFollowUpTask[] {
  const tasks: SiteFollowUpTask[] = []
  for (const p of pages) {
    const canonStep = p.steps.find((s) => s.step === 'canonical')
    if (!canonStep || canonStep.passed) continue
    if (!/\/index\.html?$/i.test(p.url)) continue
    if (!canonStep.evidence.includes('different same-host URL')) continue

    const target = canonStep.evidence.match(/Canonical points to different same-host URL: ([^\s]+)/)?.[1]
    tasks.push({
      id: `canonical-index-html-${p.url}`,
      title: 'index.html canonical points elsewhere',
      detail:
        target && !target.includes('index.html')
          ? `Recommend a 301 redirect from ${p.url} to ${target} (or align canonical to self).`
          : 'Align canonical with the preferred URL or redirect index.html to the directory URL.',
      evidence: canonStep.evidence,
      affectedUrls: [p.url],
    })
  }
  return tasks
}

function sitemapGapTask(coverage: IndexDiagnosisResult['coverage']): SiteFollowUpTask | null {
  if (coverage.linkedOnlyUrls.length === 0) return null
  return {
    id: 'sitemap-missing-linked-urls',
    title: 'Linked URLs missing from sitemap',
    detail: `${coverage.linkedOnlyUrls.length} internally linked URL(s) are absent from sitemap.xml — add them to the sitemap.`,
    evidence: `linkedOnlyUrls count=${coverage.linkedOnlyUrls.length}`,
    affectedUrls: coverage.linkedOnlyUrls,
  }
}

function non200Task(coverage: IndexDiagnosisResult['coverage']): SiteFollowUpTask | null {
  const non200 = coverage.excluded.filter((e) => e.reason === 'NON_200')
  if (non200.length === 0) return null
  return {
    id: 'non-200-linked-urls',
    title: 'Internally linked URLs return non-200',
    detail: `${non200.length} URL(s) returned non-200 when crawled — fix or remove dead internal links.`,
    evidence: non200.map((e) => e.evidence).join(' | '),
    affectedUrls: non200.map((e) => e.url),
  }
}

function duplicateCohortTasks(cohorts: CohortMetrics[]): SiteFollowUpTask[] {
  return cohorts
    .filter((c) => c.flagged && c.kind === 'path_pattern' && c.duplicateClusterDensity >= 0.25)
    .map((c) => ({
      id: `cohort-dup-${c.cohortId}`,
      title: `Near-duplicate cohort: ${c.label}`,
      detail: `Duplicate density ${(c.duplicateClusterDensity * 100).toFixed(0)}% (site median comparison in flag). Differentiate content and add internal links to this template.`,
      evidence: c.flagEvidence || `size=${c.size} medianDepth=${c.medianDepth}`,
      affectedUrls: [],
    }))
}

export function buildSiteFollowUpTasks(result: IndexDiagnosisResult): SiteFollowUpTask[] {
  const tasks: SiteFollowUpTask[] = [
    ...canonicalMismatchTasks(result.pages),
    ...(sitemapGapTask(result.coverage) ? [sitemapGapTask(result.coverage)!] : []),
    ...(non200Task(result.coverage) ? [non200Task(result.coverage)!] : []),
    ...duplicateCohortTasks(result.cohorts),
  ]
  return tasks
}
