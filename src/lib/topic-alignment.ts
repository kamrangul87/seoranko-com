// Detect when generated prose does not match the requested keyword/topic.
// Mechanical checks only — never require an exact match of a long parenthetical
// keyword phrase (that false-positive discarded on-topic drafts).

import { analyzeKeywordDensity } from '@/lib/content-scorer'

export interface TopicAlignmentResult {
  aligned: boolean
  h1Text: string
  keywordOccurrences: number
  keywordDensityScore: number
  reason?: string
  /** Soft warning for Quality Gate — article kept, not discarded. */
  warning?: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'and', 'or',
  'vs', 'versus', 'with', 'from', 'into', 'over', 'under', 'how', 'what', 'why',
  'when', 'where', 'which', 'your', 'you', 'our', 'best', 'guide', 'complete',
])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Strip parentheticals / bracket noise so
 * "EV charger types comparison (Level 1, 2, DC fast charging)"
 * → "EV charger types comparison"
 */
export function coreKeywordPhrase(keyword: string): string {
  return keyword
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getKeywordTokens(keyword: string): string[] {
  const core = coreKeywordPhrase(keyword)
  return core
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
}

/** First 2–4 content tokens — what humans actually expect to see in the article. */
export function primaryTopicPhrase(keyword: string): string {
  const tokens = getKeywordTokens(keyword)
  if (tokens.length === 0) return coreKeywordPhrase(keyword).toLowerCase()
  return tokens.slice(0, Math.min(4, tokens.length)).join(' ')
}

export function assertNonEmptyKeyword(raw: unknown): string {
  const k = String(raw ?? '').trim()
  if (!k) throw new Error('KEYWORD_REQUIRED')
  return k
}

function countTokenHits(bodyText: string, tokens: string[]): number {
  let tokenHits = 0
  for (const t of tokens) {
    tokenHits += (bodyText.match(new RegExp(`\\b${escapeRegExp(t)}\\b`, 'g')) || []).length
  }
  return tokenHits
}

function uniqueTokensPresent(bodyText: string, tokens: string[]): number {
  return tokens.filter(t => new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(bodyText)).length
}

/** True when H1 and body clearly cover the requested keyword topic. */
export function checkTopicAlignment(html: string, keyword: string): TopicAlignmentResult {
  const kw = keyword.trim()
  if (!kw) {
    return {
      aligned: false,
      h1Text: '',
      keywordOccurrences: 0,
      keywordDensityScore: 0,
      reason: 'Keyword is missing',
    }
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : ''
  const h1Lower = h1Text.toLowerCase()

  const core = coreKeywordPhrase(kw)
  const coreLower = core.toLowerCase()
  const topicPhrase = primaryTopicPhrase(kw)
  const tokens = getKeywordTokens(kw)

  // Density / occurrence scoring against the CORE phrase (not the parenthetical
  // long-tail string — that almost never appears verbatim and caused density 0.0% discards).
  const densityTarget = topicPhrase || coreLower || kw.toLowerCase()
  const density = analyzeKeywordDensity(html, densityTarget)

  const h1HasFullPhrase = Boolean(coreLower) && h1Lower.includes(coreLower)
  const h1HasTopic = Boolean(topicPhrase) && h1Lower.includes(topicPhrase)
  const h1TokenCoverage = tokens.length === 0
    ? 0
    : tokens.filter(t => h1Lower.includes(t)).length / tokens.length
  const h1HasEnoughTokens =
    tokens.length > 0 &&
    tokens.filter(t => h1Lower.includes(t)).length >= Math.min(2, tokens.length)
  const h1Aligned =
    h1HasFullPhrase ||
    h1HasTopic ||
    h1HasEnoughTokens ||
    (tokens.length === 1 && h1Lower.includes(tokens[0])) ||
    (tokens.length >= 3 && h1TokenCoverage >= 0.5)

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()

  const phraseRegex = new RegExp(escapeRegExp(topicPhrase || coreLower), 'g')
  const phraseHits = topicPhrase || coreLower
    ? (bodyText.match(phraseRegex) || []).length
    : 0

  const tokenHits = countTokenHits(bodyText, tokens)
  const distinctTokens = uniqueTokensPresent(bodyText, tokens)

  // Long keywords (5+ tokens) cannot require verbatim phrase density.
  const isLongKeyword = tokens.length >= 5 || kw.length > 48
  const minPhrase = isLongKeyword ? 1 : 2
  const minTokenHits = isLongKeyword
    ? Math.max(6, tokens.length)
    : tokens.length >= 2 ? 4 : 3
  const minDistinct = isLongKeyword
    ? Math.min(3, tokens.length)
    : Math.min(2, tokens.length)

  const bodyAligned =
    phraseHits >= minPhrase ||
    (tokenHits >= minTokenHits && distinctTokens >= minDistinct) ||
    (distinctTokens >= Math.min(3, tokens.length) && tokenHits >= 4)

  let aligned = h1Aligned && bodyAligned
  let reason: string | undefined
  let warning: string | undefined

  if (!h1Aligned) {
    reason = `Title "${h1Text || '(missing)'}" does not match keyword "${kw}"`
    aligned = false
  } else if (!bodyAligned) {
    reason = `Article body barely mentions the topic of "${topicPhrase || kw}" (${phraseHits} phrase hit(s), ${distinctTokens}/${tokens.length} topic words) — likely off-topic`
    aligned = false
  } else if (density.score < 15 && density.occurrences < 1 && phraseHits === 0 && distinctTokens < Math.min(3, Math.max(1, tokens.length))) {
    // Only hard-fail density when tokens are also weak — never for long verbatim phrases alone
    reason = `Keyword topic "${topicPhrase || kw}" is effectively absent (density ${density.density.toFixed(1)}%)`
    aligned = false
  } else if (density.occurrences < 2 && phraseHits < 2 && !isLongKeyword) {
    warning = `Keyword density is light (${density.density.toFixed(1)}%) — consider a denser rewrite later`
  }

  return {
    aligned,
    h1Text,
    keywordOccurrences: density.occurrences,
    keywordDensityScore: density.score,
    reason,
    warning,
  }
}

/** Keep previous HTML if a rewrite drifted off-topic. */
export function keepIfOnTopic(
  previousHtml: string,
  nextHtml: string,
  keyword: string,
  stage: string
): string {
  const check = checkTopicAlignment(nextHtml, keyword)
  if (check.aligned) return nextHtml
  console.warn(`[topic-alignment] ${stage} drifted off-topic — keeping previous HTML:`, check.reason)
  return previousHtml
}

/**
 * Drop secondary / long-tail terms that share almost no tokens with the
 * primary keyword — a stale cluster brief (e.g. "near me" vs "types comparison")
 * was poisoning generation toward the wrong topic.
 */
export function filterRelatedKeywords(primary: string, candidates: string[]): string[] {
  const primaryTokens = getKeywordTokens(primary)
  const primarySet = new Set(primaryTokens)
  if (primaryTokens.length === 0) return []
  const topic = primaryTopicPhrase(primary)
  const need = Math.min(2, primaryTokens.length)
  // For long topics, secondaries must share a distinctive token beyond the
  // generic head ("ev charger"), otherwise "near me" briefs stick to every EV article.
  const distinctive = primaryTokens.length >= 3 ? primaryTokens.slice(2) : primaryTokens

  return candidates.filter(c => {
    const raw = (c || '').trim()
    if (!raw) return false
    const lower = raw.toLowerCase()
    if (topic && lower.includes(topic)) return true
    const core = coreKeywordPhrase(primary).toLowerCase()
    if (core && lower.includes(core)) return true

    const cTokens = getKeywordTokens(raw)
    if (cTokens.length === 0) return false

    const overlap = cTokens.filter(t =>
      primarySet.has(t) ||
      primaryTokens.some(p => p.length >= 4 && (p.startsWith(t) || t.startsWith(p)))
    ).length

    if (overlap < need) return false

    if (distinctive.length === 0) return true
    return cTokens.some(t =>
      distinctive.some(d => d === t || (d.length >= 4 && (d.startsWith(t) || t.startsWith(d))))
    )
  })
}
