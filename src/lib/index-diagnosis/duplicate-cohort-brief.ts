/**
 * Connect a near-duplicate Index Diagnosis cohort to a Content Brief.
 * Uses real page titles/URLs — never the raw path pattern as the brief subject.
 */

import type { BriefSection, ContentBrief } from '../content-brief-generator'
import type { DuplicateCohortBriefContext } from './types'

export function duplicateCohortBriefBadgeText(ctx: DuplicateCohortBriefContext): string {
  return `Generated to differentiate overlapping ${ctx.sharedTopic} (${ctx.exampleUrls.length} URLs from this crawl)`
}

export function duplicateCohortRequestNotes(ctx: DuplicateCohortBriefContext): string {
  const urlLines = ctx.pageSummaries
    .map((p) => {
      const label = p.title || p.h1 || p.slugLabel
      return `- ${p.url} — "${label}"`
    })
    .join('\n')
  const density =
    ctx.duplicateDensity != null
      ? `${(ctx.duplicateDensity * 100).toFixed(0)}% near-duplicate density`
      : 'elevated near-duplicate density'

  return `Index Diagnosis duplicate-cohort context — build a differentiation brief (do NOT use the path pattern as the topic):
Shared topic (derived from crawl titles/slugs): ${ctx.sharedTopic}
Suggested brief title: ${ctx.suggestedBriefTitle}
Evidence: ${ctx.flagEvidence}
Duplicate signal: ${density}
Real overlapping URLs from this crawl:
${urlLines || ctx.exampleUrls.join('\n')}
The brief MUST:
1. Use "${ctx.sharedTopic}" as the subject — never "Path /blog/:slug.html" or similar patterns
2. Include one H2 section per listed URL explaining how that specific page should angle differently
3. Name each URL explicitly in its section heading or guidance
4. Give strategist guidance only — no ready-to-publish prose or invented facts`
}

export function applyDuplicateCohortToBrief(brief: ContentBrief, ctx: DuplicateCohortBriefContext): ContentBrief {
  const note = `Differentiate ${ctx.sharedTopic}: ${ctx.flagEvidence}`
  const strategistNotes = brief.strategistNotes.includes(note)
    ? brief.strategistNotes
    : [
        note,
        `These pages overlap in template and topic — each needs a distinct search intent:`,
        ...ctx.pageSummaries.map(
          (p) =>
            `• ${p.url.replace(/^https?:\/\/[^/]+/, '') || p.url} — ${p.title || p.h1 || p.slugLabel}`,
        ),
        ...brief.strategistNotes,
      ]

  const perUrlSections: BriefSection[] = ctx.pageSummaries.slice(0, 6).map((p) => {
    const label = p.title || p.h1 || p.slugLabel
    return {
      heading: `Differentiate: ${label}`,
      level: 'h2',
      guidance: `URL: ${p.url}. This page is part of the near-duplicate cohort flagged during Index Diagnosis (${ctx.flagEvidence}). Plan a unique primary angle for "${label}" that does not repeat the other URLs in this set: ${ctx.pageSummaries
        .filter((x) => x.url !== p.url)
        .map((x) => x.title || x.slugLabel)
        .slice(0, 3)
        .join('; ')}. Use distinct H2 structure, FAQ, and internal links to non-overlapping pages.`,
      needsCitation: false,
    }
  })

  const overview: BriefSection = {
    heading: ctx.suggestedBriefTitle.replace(/ — content brief$/i, ''),
    level: 'h1',
    guidance: `This brief covers ${ctx.pageSummaries.length} overlapping pages about ${ctx.sharedTopic}. Each URL below needs a clearly different search intent and content angle so Google does not treat them as near-duplicates. Do not copy structure or FAQ answers across these pages.`,
    needsCitation: false,
  }

  const existing = brief.sections.filter(
    (s) => !/differentiate|near-duplicate|path \//i.test(s.heading + s.guidance),
  )

  return {
    ...brief,
    seedKeyword: ctx.sharedTopic,
    suggestedTitle: ctx.suggestedBriefTitle,
    strategistNotes,
    sections: [overview, ...perUrlSections, ...existing],
  }
}
