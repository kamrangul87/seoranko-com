// Detect when generated prose does not match the requested keyword/topic.

import { analyzeKeywordDensity } from '@/lib/content-scorer'

export interface TopicAlignmentResult {
  aligned: boolean
  h1Text: string
  keywordOccurrences: number
  keywordDensityScore: number
  reason?: string
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'and', 'or'])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function getKeywordTokens(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
}

export function assertNonEmptyKeyword(raw: unknown): string {
  const k = String(raw ?? '').trim()
  if (!k) throw new Error('KEYWORD_REQUIRED')
  return k
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
  const kwLower = kw.toLowerCase()

  const density = analyzeKeywordDensity(html, kw)
  const tokens = getKeywordTokens(kw)

  const h1HasFullPhrase = h1Lower.includes(kwLower)
  const h1HasTokens = tokens.length > 0 && tokens.filter(t => h1Lower.includes(t)).length >= Math.min(2, tokens.length)
  const h1Aligned = h1HasFullPhrase || h1HasTokens || (tokens.length === 1 && h1Lower.includes(tokens[0]))

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase()

  const phraseRegex = new RegExp(escapeRegExp(kwLower), 'g')
  const phraseHits = (bodyText.match(phraseRegex) || []).length

  let tokenHits = 0
  for (const t of tokens) {
    tokenHits += (bodyText.match(new RegExp(`\\b${escapeRegExp(t)}\\b`, 'g')) || []).length
  }

  const minPhrase = 2
  const minTokenHits = tokens.length >= 2 ? 4 : 3
  const bodyAligned = phraseHits >= minPhrase || tokenHits >= minTokenHits

  let aligned = h1Aligned && bodyAligned
  let reason: string | undefined

  if (!h1Aligned) {
    reason = `Title "${h1Text || '(missing)'}" does not match keyword "${kw}"`
    aligned = false
  } else if (!bodyAligned) {
    reason = `Article body barely mentions "${kw}" (${phraseHits} phrase hit(s), ${tokenHits} token hit(s)) — likely off-topic`
    aligned = false
  } else if (density.score < 15 && density.occurrences < 2) {
    reason = `Keyword "${kw}" is effectively absent (density ${density.density.toFixed(1)}%)`
    aligned = false
  }

  return {
    aligned,
    h1Text,
    keywordOccurrences: density.occurrences,
    keywordDensityScore: density.score,
    reason,
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
