/**
 * Derive a real shared topic from near-duplicate cohort URLs/titles — never use raw path patterns.
 */

import type { DuplicateCohortBriefContext, PageIndexability } from './types'

export interface CohortPageSummary {
  url: string
  title: string
  h1: string
  slugLabel: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'your', 'how', 'why',
  'what', 'html', 'index', 'blog', 'page', 'www',
])

function slugFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    const last = parts[parts.length - 1] || ''
    return last.replace(/\.html?$/i, '')
  } catch {
    return ''
  }
}

function slugToLabel(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

/** Pattern from cohort id `path:/blog/:slug.html` → `/blog/:slug.html` */
export function cohortPathPattern(cohortId: string, cohortLabel?: string): string {
  if (cohortId.startsWith('path:')) return cohortId.slice(5)
  if (cohortLabel?.startsWith('Path ')) return cohortLabel.slice(5).trim()
  return cohortLabel || ''
}

export function pagesInCohort(pages: PageIndexability[], cohortId: string, cohortLabel?: string): PageIndexability[] {
  const pattern = cohortPathPattern(cohortId, cohortLabel)
  if (!pattern) return []
  return pages.filter((p) => p.pathPattern === pattern)
}

function sharedTopicFromSummaries(summaries: CohortPageSummary[]): string {
  const freq = new Map<string, number>()
  for (const s of summaries) {
    const blob = [s.slugLabel, s.title, s.h1].filter(Boolean).join(' ')
    for (const tok of tokenize(blob)) {
      freq.set(tok, (freq.get(tok) || 0) + 1)
    }
  }

  const shared = Array.from(freq.entries())
    .filter(([, n]) => n >= 2 || (summaries.length <= 2 && n >= 1))
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))

  const top = shared.slice(0, 4).map(([w]) => w)
  if (top.includes('uk') && (top.includes('ev') || top.includes('electric') || top.includes('charger'))) {
    return 'UK EV and vehicle-check guides'
  }
  if (top.includes('mot') && top.includes('uk')) {
    return 'UK MOT and vehicle history guides'
  }
  if (top.includes('ev') || top.includes('electric') || top.includes('charger')) {
    return 'EV and electric vehicle guides'
  }
  if (top.length >= 2) {
    return top.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' / ') + ' content'
  }
  if (summaries[0]?.slugLabel) {
    return `${summaries[0].slugLabel} and related guides`
  }
  return 'Overlapping site content'
}

export function buildCohortPageSummaries(pages: PageIndexability[]): CohortPageSummary[] {
  return pages.map((p) => {
    const slug = slugFromUrl(p.url)
    return {
      url: p.url,
      title: p.pageTitle || '',
      h1: p.pageH1 || '',
      slugLabel: slugToLabel(slug) || p.url.replace(/^https?:\/\/[^/]+/, ''),
    }
  })
}

export function buildDuplicateCohortBriefContext(
  cohortId: string,
  cohortLabel: string,
  flagEvidence: string,
  pages: PageIndexability[],
  duplicateDensity?: number,
): DuplicateCohortBriefContext {
  const cohortPages = pagesInCohort(pages, cohortId, cohortLabel)
  const pageSummaries = buildCohortPageSummaries(cohortPages)
  const exampleUrls = cohortPages.map((p) => p.url)
  const sharedTopic = sharedTopicFromSummaries(pageSummaries)
  const suggestedBriefTitle = `Differentiating your ${sharedTopic} — content brief`

  return {
    cohortLabel,
    cohortId,
    flagEvidence,
    exampleUrls,
    duplicateDensity,
    sharedTopic,
    suggestedBriefTitle,
    pageSummaries,
  }
}
