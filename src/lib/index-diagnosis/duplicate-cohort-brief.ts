/**
 * Connect a near-duplicate Index Diagnosis cohort to a Content Brief.
 * No invented content — brief gets strategist guidance from crawl evidence only.
 */

import type { BriefSection, ContentBrief } from '../content-brief-generator'
import type { DuplicateCohortBriefContext } from './types'

export function duplicateCohortBriefBadgeText(label: string): string {
  return `Generated to differentiate near-duplicate cohort: ${label}`
}

export function duplicateCohortRequestNotes(ctx: DuplicateCohortBriefContext): string {
  const examples =
    ctx.exampleUrls.length > 0
      ? ctx.exampleUrls.join(', ')
      : '(no example URLs captured in crawl)'
  const density =
    ctx.duplicateDensity != null
      ? `${(ctx.duplicateDensity * 100).toFixed(0)}% near-duplicate density`
      : 'elevated near-duplicate density'
  return `Index Diagnosis duplicate-cohort context — the brief must help differentiate this template (do not invent page copy):
Cohort pattern: ${ctx.cohortLabel}
Evidence: ${ctx.flagEvidence}
Duplicate signal: ${density}
Example URLs from this crawl: ${examples}
Focus on unique angles, distinct H2 structure, and internal linking so each URL in this cohort serves a different search intent.`
}

export function applyDuplicateCohortToBrief(brief: ContentBrief, ctx: DuplicateCohortBriefContext): ContentBrief {
  const note = `Differentiate near-duplicate cohort "${ctx.cohortLabel}": ${ctx.flagEvidence}`
  const strategistNotes = brief.strategistNotes.includes(note)
    ? brief.strategistNotes
    : [note, ...brief.strategistNotes]

  const differentiationSection: BriefSection = {
    heading: `Differentiate ${ctx.cohortLabel} from similar pages`,
    level: 'h2',
    guidance: `This URL belongs to cohort "${ctx.cohortLabel}" flagged during Index Diagnosis (${ctx.flagEvidence}). Plan content that does not overlap with sibling URLs in this template — unique primary angle, distinct FAQ, and internal links to related (non-duplicate) pages. Example sibling URLs from crawl: ${ctx.exampleUrls.slice(0, 3).join(', ') || 'see crawl report'}.`,
    needsCitation: false,
  }

  const hasSimilar = brief.sections.some((s) =>
    /differentiate|near-duplicate|cohort/i.test(s.heading + s.guidance),
  )
  const sections = hasSimilar ? brief.sections : [differentiationSection, ...brief.sections]

  return {
    ...brief,
    seedKeyword: ctx.exampleUrls[0]?.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '') || brief.seedKeyword,
    strategistNotes,
    sections,
  }
}
