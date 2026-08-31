/**
 * AI Visibility config — prompt caps and approximate API unit costs.
 * Tiers are not built yet; caps are env-configurable.
 */

export function getAiVisibilityPromptCap(): number {
  const raw = process.env.AI_VISIBILITY_PROMPT_CAP
  const n = raw ? Number(raw) : 15
  if (!Number.isFinite(n) || n < 1) return 15
  return Math.min(Math.floor(n), 50)
}

/** Rough USD estimates for cost logging (not billing). */
export const AI_VISIBILITY_COST = {
  openaiInputPer1k: 0.00015, // gpt-4o-mini ballpark
  openaiOutputPer1k: 0.0006,
  perplexityPerRequest: 0.005, // sonar request estimate when usage absent
} as const

export const AI_VISIBILITY_ENGINES = ['openai', 'perplexity'] as const
export type AiVisibilityEngine = (typeof AI_VISIBILITY_ENGINES)[number]

export const AI_VISIBILITY_PHASE_NOTE =
  'Phase 1 checks ChatGPT (OpenAI API) and Perplexity Sonar only. Google AI Overviews and Claude are not available via API yet — no browser scraping in this phase.'
