/**
 * Phase 12 — Google-aligned SEO policy (Search Central people-first guidance).
 *
 * Thresholds here are HEURISTICS for writers, not fake ranking rules.
 * Do NOT invent magic word counts, density %, title lengths, heading counts,
 * internal-link quotas, or FAQ quotas as "Google requirements."
 *
 * Optimize for: people-first content, helpfulness, originality, accurate
 * information, clear titles, descriptive headings, natural language,
 * crawlable internal links, descriptive anchors, useful alt text, valid
 * structured data, indexability, good page experience.
 */

export const GOOGLE_SEO_POLICY_VERSION = '2026-search-central-people-first'

export type SeoHeuristicKind =
  | 'people_first'
  | 'helpfulness'
  | 'accuracy'
  | 'clarity'
  | 'crawlability'
  | 'structured_data'
  | 'page_experience'
  | 'editorial_preference'

/** Explicitly NOT Google ranking signals — product/editorial preferences only. */
export const NOT_GOOGLE_RANKING_SIGNALS = [
  'magic_word_count',
  'magic_keyword_density',
  'magic_title_length',
  'required_heading_count',
  'required_internal_link_count',
  'required_faq_count',
] as const

export interface SeoHeuristic {
  id: string
  kind: SeoHeuristicKind
  /** What we check for writers. */
  intent: string
  /** How to treat the threshold. */
  treatment: 'hard_block' | 'review' | 'advisory' | 'never_enforce_as_google_rule'
  notes: string
}

/**
 * Canonical heuristic registry — keep Quality Gate aligned with this list.
 */
export const SEO_HEURISTICS: SeoHeuristic[] = [
  {
    id: 'topic-alignment',
    kind: 'people_first',
    intent: 'Article must be about the requested query / search intent',
    treatment: 'hard_block',
    notes: 'Off-topic pages fail helpfulness — not a keyword-stuffing rule.',
  },
  {
    id: 'factual-accuracy',
    kind: 'accuracy',
    intent: 'Material claims should be sourced or flagged for review',
    treatment: 'review',
    notes: 'Aligned with accurate information / trust.',
  },
  {
    id: 'freshness',
    kind: 'accuracy',
    intent: 'Time-sensitive claims need verification',
    treatment: 'review',
    notes: 'Not a freshness-date meta hack — claim-level evidence.',
  },
  {
    id: 'structured-data-validity',
    kind: 'structured_data',
    intent: 'JSON-LD must be valid and match visible content',
    treatment: 'hard_block',
    notes: 'Valid structured data — not rich-result guarantees.',
  },
  {
    id: 'clear-title-heading',
    kind: 'clarity',
    intent: 'Titles and headings should describe the page for humans',
    treatment: 'review',
    notes: 'Descriptive, not a magic character count.',
  },
  {
    id: 'natural-language',
    kind: 'helpfulness',
    intent: 'Avoid AI slop / unreadable merge artifacts',
    treatment: 'review',
    notes: 'Natural language for readers.',
  },
  {
    id: 'crawlable-links',
    kind: 'crawlability',
    intent: 'Internal/content links should be real <a href> with clear anchors',
    treatment: 'review',
    notes: 'No quota on link count.',
  },
  {
    id: 'alt-text-useful',
    kind: 'page_experience',
    intent: 'Images should have useful alt when present',
    treatment: 'advisory',
    notes: 'Useful alt text — not keyword stuffing in alt.',
  },
  {
    id: 'editorial-word-count',
    kind: 'editorial_preference',
    intent: 'User length target is editorial, not SEO compliance',
    treatment: 'never_enforce_as_google_rule',
    notes: 'ADVISORY / CONTENT_COVERAGE only — never pad for a number.',
  },
  {
    id: 'keyword-density',
    kind: 'editorial_preference',
    intent: 'Primary phrase should appear naturally if the page is on-topic',
    treatment: 'never_enforce_as_google_rule',
    notes: 'Near-zero presence can be a topic-coverage smell; density % is not a Google ranking factor.',
  },
]

export function isMagicGoogleMyth(signal: string): boolean {
  return (NOT_GOOGLE_RANKING_SIGNALS as readonly string[]).includes(signal)
}

/**
 * Soft keyword-presence heuristic (Phase 12).
 * Returns whether density is so low it may indicate off-topic / thin coverage —
 * NOT a "magic density %" ranking rule.
 */
export function keywordPresenceHeuristic(opts: {
  keywordDensityPct?: number
  keywordDensityScore?: number
}): 'ok' | 'review' | 'ignore' {
  const { keywordDensityPct, keywordDensityScore } = opts
  if (typeof keywordDensityPct !== 'number' && typeof keywordDensityScore !== 'number') {
    return 'ignore'
  }
  // Extremely low presence — suggest review as coverage smell, never critical "Google rule"
  if (
    (typeof keywordDensityPct === 'number' && keywordDensityPct < 0.15) ||
    (typeof keywordDensityScore === 'number' && keywordDensityScore < 20)
  ) {
    return 'review'
  }
  return 'ok'
}
