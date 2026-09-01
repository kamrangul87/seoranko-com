/**
 * Content / product brief generator — STRUCTURE + GUIDANCE only.
 *
 * Never invents prices, stock claims, specs, % figures, or ready-to-publish
 * prose. A mechanical post-pass strips any leftover currency/%/stock claims.
 */

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'
import { stripUnsourcedNumericClaims } from '@/lib/unsourced-numeric-stripper'
import { applyCitationGapToBrief, citationGapRequestNotes } from '@/lib/ai-visibility/citation-gap-brief'
import {
  applyDuplicateCohortToBrief,
  duplicateCohortRequestNotes,
} from '@/lib/index-diagnosis/duplicate-cohort-brief'
import type { DuplicateCohortBriefContext } from '@/lib/index-diagnosis/types'

export type BriefMode = 'content' | 'product' | 'category'

export interface BriefSection {
  heading: string
  level: 'h1' | 'h2' | 'h3'
  guidance: string
  primaryKeywordPlacement?: string
  secondaryKeywordPlacement?: string
  needsCitation: boolean
  citationNote?: string
}

export interface ContentBrief {
  mode: BriefMode
  seedKeyword: string
  suggestedTitle: string
  intent: 'informational' | 'commercial' | 'navigational' | 'transactional'
  sections: BriefSection[]
  strategistNotes: string[]
  /** True when mechanical strip removed invented-looking figures. */
  strippedInventedClaims: boolean
}

const INVENTED_CLAIM_RE =
  /[£$€]\s?[\d,]+|\d+\s?%|\b(?:in stock|out of stock|ships in \d+|sku\s*[:=]\s*\w+|gtin\s*[:=])/i

function inferMode(seed: string, explicit?: BriefMode): BriefMode {
  if (explicit) return explicit
  const s = seed.toLowerCase()
  if (/\b(buy|price|cheap|deal|sku|product)\b/.test(s)) return 'product'
  if (/\b(best|vs|category|collection|shop)\b/.test(s)) return 'category'
  return 'content'
}

function stripInventedClaimsFromBrief(brief: ContentBrief): ContentBrief {
  let stripped = false
  const scrub = (text: string): string => {
    if (!INVENTED_CLAIM_RE.test(text)) return text
    stripped = true
    // Reuse numeric stripper on a paragraph wrapper, then unwrap
    const { html } = stripUnsourcedNumericClaims(`<p>${text}</p>`)
    let out = html.replace(/^<p>|<\/p>$/g, '')
    out = out
      .replace(/\b(in stock|out of stock|ships in \d+[^\s]*)\b/gi, '[confirm live inventory]')
      .replace(/\b(sku|gtin|mpn)\s*[:=]\s*\S+/gi, '[add real product id from catalogue]')
    return out
  }

  return {
    ...brief,
    suggestedTitle: scrub(brief.suggestedTitle),
    strategistNotes: brief.strategistNotes.map(scrub),
    sections: brief.sections.map((s) => ({
      ...s,
      heading: scrub(s.heading),
      guidance: scrub(s.guidance),
      citationNote: s.citationNote ? scrub(s.citationNote) : s.citationNote,
    })),
    strippedInventedClaims: stripped,
  }
}

function fallbackBrief(seed: string, mode: BriefMode): ContentBrief {
  if (mode === 'product') {
    return {
      mode,
      seedKeyword: seed,
      suggestedTitle: `${seed} — product page brief`,
      intent: 'transactional',
      strategistNotes: [
        'Pull real specs, price, and stock from your catalogue — never invent them in copy.',
        'Prioritize unique differentiators and use-cases over manufacturer boilerplate.',
      ],
      sections: [
        {
          heading: seed,
          level: 'h1',
          guidance: 'State the product name and primary use-case in plain language. Place the primary keyword once, naturally.',
          primaryKeywordPlacement: 'H1 + first sentence',
          needsCitation: false,
        },
        {
          heading: 'Who this is for',
          level: 'h2',
          guidance: 'Describe the buyer scenario and constraints. Do not invent measurements or compatibility claims — flag anything that needs a datasheet.',
          secondaryKeywordPlacement: 'One secondary phrase in the opening sentence',
          needsCitation: true,
          citationNote: 'Link the official spec sheet or brand compatibility list when you claim fitment.',
        },
        {
          heading: 'Key attributes to cover',
          level: 'h2',
          guidance: 'List the attribute fields to fill from catalogue data (materials, dimensions, warranty). Leave blanks for the human — do not fabricate values.',
          needsCitation: true,
          citationNote: 'Every numeric attribute needs a catalogue or manufacturer source.',
        },
        {
          heading: 'How to choose / use',
          level: 'h2',
          guidance: 'Advisory steps for selection or setup. Keep voice as strategist notes, not finished prose.',
          needsCitation: false,
        },
      ],
      strippedInventedClaims: false,
    }
  }

  if (mode === 'category') {
    return {
      mode,
      seedKeyword: seed,
      suggestedTitle: `${seed} — category intro brief`,
      intent: 'commercial',
      strategistNotes: [
        'Category pages need unique intro copy above the grid — not only filters.',
        'Suggest subcategory and filter angles; do not invent assortment counts or prices.',
      ],
      sections: [
        {
          heading: seed,
          level: 'h1',
          guidance: 'Name the collection and the shopper job-to-be-done. One primary-keyword use in the H1.',
          primaryKeywordPlacement: 'H1',
          needsCitation: false,
        },
        {
          heading: 'How to browse this collection',
          level: 'h2',
          guidance: 'Explain filter/subcategory angles the shopper should consider. Guidance only — no invented inventory claims.',
          needsCitation: false,
        },
        {
          heading: 'What to compare',
          level: 'h2',
          guidance: 'List comparison dimensions (fit, material, use-case). Mark any regulatory claims as needing a real source.',
          needsCitation: true,
          citationNote: 'If you mention standards or eligibility, cite the official page.',
        },
      ],
      strippedInventedClaims: false,
    }
  }

  return {
    mode: 'content',
    seedKeyword: seed,
    suggestedTitle: `${seed} — content brief`,
    intent: 'informational',
    strategistNotes: [
      'This brief is strategist guidance for a human writer — not publishable draft copy.',
      'Wherever a section needs a figure, deadline, or policy claim, needsCitation is true.',
    ],
    sections: [
      {
        heading: seed,
        level: 'h1',
        guidance: 'Open with the reader problem and the promise of the page. Place the primary keyword once near the start.',
        primaryKeywordPlacement: 'H1 + intro',
        needsCitation: false,
      },
      {
        heading: `What ${seed} means in practice`,
        level: 'h2',
        guidance: 'Define scope and audience. Avoid invented statistics — if a number is needed, mark it for a real source.',
        needsCitation: true,
        citationNote: 'Any prevalence / cost / rate figure needs an official or named source.',
      },
      {
        heading: 'Step-by-step approach',
        level: 'h2',
        guidance: 'Outline 3–5 actionable steps the writer should cover. Keep each step advisory.',
        secondaryKeywordPlacement: 'Distribute secondaries across step subheads',
        needsCitation: false,
      },
      {
        heading: 'Common mistakes to avoid',
        level: 'h2',
        guidance: 'List failure modes from practitioner experience. No fabricated case-study numbers.',
        needsCitation: false,
      },
      {
        heading: 'FAQ angles',
        level: 'h2',
        guidance: 'Propose 3 FAQ questions the writer should answer with sourced facts where needed.',
        needsCitation: true,
        citationNote: 'Policy / eligibility FAQ answers need official citations.',
      },
    ],
    strippedInventedClaims: false,
  }
}

function parseBriefJson(raw: string, seed: string, mode: BriefMode): ContentBrief | null {
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    const data = JSON.parse(clean)
    if (!data || !Array.isArray(data.sections)) return null
    return {
      mode,
      seedKeyword: seed,
      suggestedTitle: String(data.suggestedTitle || `${seed} brief`),
      intent: data.intent || 'informational',
      strategistNotes: Array.isArray(data.strategistNotes) ? data.strategistNotes.map(String) : [],
      sections: data.sections.map((s: Record<string, unknown>) => ({
        heading: String(s.heading || 'Section'),
        level: (s.level === 'h1' || s.level === 'h3' ? s.level : 'h2') as BriefSection['level'],
        guidance: String(s.guidance || ''),
        primaryKeywordPlacement: s.primaryKeywordPlacement ? String(s.primaryKeywordPlacement) : undefined,
        secondaryKeywordPlacement: s.secondaryKeywordPlacement
          ? String(s.secondaryKeywordPlacement)
          : undefined,
        needsCitation: Boolean(s.needsCitation),
        citationNote: s.citationNote ? String(s.citationNote) : undefined,
      })),
      strippedInventedClaims: false,
    }
  } catch {
    return null
  }
}

export async function generateContentBrief(input: {
  seedKeyword: string
  mode?: BriefMode
  secondaryKeywords?: string[]
  market?: string
  /** Pre-fill only — does not change seed-only generation for ordinary briefs. */
  citationGap?: {
    resultId: string
    prompt: string
    engine: string
    finding: string
    gaps: string[]
  }
  indexDiagnosisCohort?: DuplicateCohortBriefContext
}): Promise<ContentBrief> {
  const seed = input.seedKeyword.trim()
  if (!seed) throw new Error('seedKeyword is required')
  const mode = inferMode(seed, input.mode)
  const market = input.market || 'Global'
  const secondaries = (input.secondaryKeywords || []).slice(0, 8)

  const gapNotes = input.citationGap
    ? `\n\n${citationGapRequestNotes(input.citationGap)}`
    : ''
  const cohortNotes = input.indexDiagnosisCohort
    ? `\n\n${duplicateCohortRequestNotes(input.indexDiagnosisCohort)}`
    : ''

  let brief: ContentBrief
  if (!process.env.ANTHROPIC_API_KEY) {
    brief = stripInventedClaimsFromBrief(fallbackBrief(seed, mode))
  } else {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const response = await client.messages.create({
        model: MODEL_FOR.contentBrief,
        max_tokens: 2000,
        system: `You are an experienced SEO strategist writing INTERNAL BRIEFING NOTES for a human writer.
NEVER write finished publishable prose.
NEVER invent prices, stock levels, SKUs, GTINs, percentages, grant amounts, or specific specs.
Output JSON only with keys: suggestedTitle, intent, strategistNotes (string[]), sections (array of {heading, level: h1|h2|h3, guidance, primaryKeywordPlacement?, secondaryKeywordPlacement?, needsCitation: boolean, citationNote?}).
Guidance must tell WHAT to cover and WHY — not the finished answer.
When a section would need a real figure or policy claim, set needsCitation true and explain what source the human must add.
Mode: ${mode}. Market context: ${market}.`,
        messages: [
          {
            role: 'user',
            content: `Seed keyword: "${seed}"
Secondary keywords: ${secondaries.join(', ') || '(none)'}
Produce a ${mode} brief with one H1 and 4–7 supporting sections.${gapNotes}${cohortNotes}`,
          },
        ],
      })
      const raw = response.content[0].type === 'text' ? response.content[0].text : ''
      const parsed = parseBriefJson(raw, seed, mode)
      brief = stripInventedClaimsFromBrief(parsed || fallbackBrief(seed, mode))
    } catch {
      brief = stripInventedClaimsFromBrief(fallbackBrief(seed, mode))
    }
  }

  if (input.citationGap) {
    brief = applyCitationGapToBrief(brief, input.citationGap)
  }
  if (input.indexDiagnosisCohort) {
    brief = applyDuplicateCohortToBrief(brief, input.indexDiagnosisCohort)
  }
  return brief
}

/** Test helper — detects leftover invented-claim shapes in a brief. */
export function briefContainsInventedClaims(brief: ContentBrief): boolean {
  const blob = [
    brief.suggestedTitle,
    ...brief.strategistNotes,
    ...brief.sections.flatMap((s) => [s.heading, s.guidance, s.citationNote || '']),
  ].join('\n')
  return INVENTED_CLAIM_RE.test(blob)
}
