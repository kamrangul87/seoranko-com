/**
 * Connect an AI Visibility citation gap to a Content Brief.
 *
 * "Fix this gap" is only offered when the diagnostic named a real missing
 * signal. Insufficient-data / failed checks never get a fix action.
 * Gap-closing H2 notes are injected mechanically so the brief always
 * references the detected signal — not only if the model happens to mention it.
 */

import type { BriefSection, ContentBrief } from '../content-brief-generator'

export interface CitationGapContext {
  resultId: string
  prompt: string
  engine: string
  finding: string
  gaps: string[]
}

export function canFixCitationGap(
  cited: boolean,
  diagnostic: {
    status?: string
    finding?: string
    gaps?: string[]
    error?: string
  } | null | undefined,
): boolean {
  if (cited) return false
  if (!diagnostic) return false
  if (diagnostic.error || diagnostic.status === 'check_failed') return false
  if (diagnostic.status !== 'compared') return false
  if (!diagnostic.gaps?.length) return false
  if (/insufficient data/i.test(diagnostic.finding || '')) return false
  return true
}

export function citationEngineLabel(engine: string): string {
  if (engine === 'openai') return 'ChatGPT'
  if (engine === 'perplexity') return 'Perplexity'
  return engine
}

/** User-facing badge copy — prompt is the user's own tracked query; no competitor names. */
export function citationGapBadgeText(prompt: string, engine: string): string {
  return `Generated to close a citation gap: "${prompt}" — you weren't cited by ${citationEngineLabel(engine)} for this`
}

export function gapClosingGuidance(gap: string, prompt: string): { heading: string; guidance: string } {
  const q = prompt.trim() || 'this query'
  switch (gap) {
    case 'FAQ schema':
      return {
        heading: 'FAQ that matches the cited query',
        guidance: `Add FAQPage schema and 3–5 questions that a reader would ask about "${q}". This is the specific gap that let a competitor get cited instead of you.`,
      }
    case 'Organization schema':
      return {
        heading: 'Organisation identity on the page',
        guidance: `Add Organization schema (name, url, logo) so answer engines can attribute this page to you. This is the specific gap that let a competitor get cited instead of you.`,
      }
    case 'Article schema':
      return {
        heading: 'Article schema for this guide',
        guidance: `Add Article (or BlogPosting) schema with headline and dateModified. This is the specific gap that let a competitor get cited instead of you.`,
      }
    case 'dateModified freshness signal':
      return {
        heading: 'Show the page is current',
        guidance: `Surface a visible last-updated date and set dateModified in schema. This is the specific gap that let a competitor get cited instead of you.`,
      }
    case 'direct answer in the first paragraph':
      return {
        heading: `Direct answer to "${q}"`,
        guidance: `Add a clear, direct answer to "${q}" in the first 2-3 sentences — this is the specific gap that let a competitor get cited instead of you.`,
      }
    default:
      return {
        heading: `Close the "${gap}" gap`,
        guidance: `Your page is missing ${gap} for "${q}". Cover that signal explicitly — this is the specific gap that let a competitor get cited instead of you.`,
      }
  }
}

function looksLikeSameGap(heading: string, gap: string): boolean {
  const h = heading.toLowerCase()
  if (gap === 'FAQ schema') return /\bfaq\b/.test(h)
  if (gap === 'Organization schema') return /organisation|organization/.test(h)
  if (gap === 'Article schema') return /article schema/.test(h)
  if (gap === 'dateModified freshness signal') return /current|fresh|updated|datemodified/.test(h)
  if (gap === 'direct answer in the first paragraph') return /direct answer/.test(h)
  return h.includes(gap.toLowerCase())
}

/**
 * Mechanically splice gap-closing sections into a generated brief so the
 * missing signal is always named, even when the model ignores the pre-fill.
 */
export function applyCitationGapToBrief(brief: ContentBrief, gap: CitationGapContext): ContentBrief {
  const prompt = gap.prompt || brief.seedKeyword
  const note = `Close this citation gap for "${prompt}": ${gap.finding}`
  const strategistNotes = brief.strategistNotes.includes(note)
    ? brief.strategistNotes
    : [note, ...brief.strategistNotes]

  const sections: BriefSection[] = [...brief.sections]
  const insertAt = Math.max(0, sections.findIndex((s) => s.level !== 'h1'))
  const at = insertAt === -1 ? sections.length : insertAt

  const extras: BriefSection[] = []
  for (const g of gap.gaps) {
    if (g === 'direct answer in the first paragraph') continue
    if (sections.some((s) => looksLikeSameGap(s.heading, g) || s.guidance.includes(g))) {
      const idx = sections.findIndex((s) => looksLikeSameGap(s.heading, g) || s.guidance.includes(g))
      const built = gapClosingGuidance(g, prompt)
      if (idx >= 0 && !sections[idx].guidance.includes('specific gap that let a competitor')) {
        sections[idx] = {
          ...sections[idx],
          guidance: `${built.guidance} ${sections[idx].guidance}`.trim(),
        }
      }
      continue
    }
    const built = gapClosingGuidance(g, prompt)
    extras.push({
      heading: built.heading,
      level: 'h2',
      guidance: built.guidance,
      needsCitation: g === 'FAQ schema' || g === 'Article schema' || g === 'Organization schema',
      citationNote:
        g === 'FAQ schema' || g === 'Article schema' || g === 'Organization schema'
          ? 'Schema must match visible page content — do not invent FAQ answers or dates.'
          : undefined,
    })
  }

  const merged = [...sections.slice(0, at), ...extras, ...sections.slice(at)]

  // If the answer-first gap exists, stamp the H1 intro so writers cannot miss it.
  // If there is no H1, insert a dedicated section after extras.
  const answerGap = gap.gaps.includes('direct answer in the first paragraph')
  if (answerGap) {
    const built = gapClosingGuidance('direct answer in the first paragraph', prompt)
    const h1Idx = merged.findIndex((s) => s.level === 'h1')
    if (h1Idx >= 0) {
      if (!merged[h1Idx].guidance.includes('first 2-3 sentences')) {
        merged[h1Idx] = {
          ...merged[h1Idx],
          guidance: `${built.guidance} ${merged[h1Idx].guidance}`.trim(),
          primaryKeywordPlacement: merged[h1Idx].primaryKeywordPlacement || 'first 2-3 sentences',
        }
      }
    } else {
      merged.splice(0, 0, {
        heading: built.heading,
        level: 'h2',
        guidance: built.guidance,
        primaryKeywordPlacement: 'first 2-3 sentences',
        needsCitation: false,
      })
    }
  }

  return {
    ...brief,
    seedKeyword: prompt,
    strategistNotes,
    sections: merged,
  }
}

export function citationGapRequestNotes(gap: CitationGapContext): string {
  return `Citation-gap context — the brief must close this exact gap (do not invent competitor names):
Tracked prompt: "${gap.prompt}"
Engine that did not cite the user: ${citationEngineLabel(gap.engine)}
Diagnostic: ${gap.finding}
Missing signals: ${gap.gaps.join(', ') || '(none)'}
For each missing signal, include H2 guidance that names that signal and tells the writer how to add it.`
}
