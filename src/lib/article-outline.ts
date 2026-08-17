// Keyword-locked article outline — generate H1/H2s first, validate tokens, then write body.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'
import { getKeywordTokens } from '@/lib/topic-alignment'
import { structureBudgetForWordCount } from '@/lib/word-count'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 3 })

export interface ArticleOutline {
  h1: string
  h2s: string[]
  metaHint?: string
}

export function outlineMatchesKeyword(outline: ArticleOutline, keyword: string): boolean {
  const tokens = getKeywordTokens(keyword)
  if (!tokens.length) return Boolean(outline.h1?.trim())

  const h1 = (outline.h1 || '').toLowerCase()
  const phrase = keyword.toLowerCase().trim()
  const h1Ok =
    h1.includes(phrase) ||
    tokens.filter(t => h1.includes(t)).length >= Math.min(2, tokens.length) ||
    (tokens.length === 1 && h1.includes(tokens[0]))

  if (!h1Ok) return false

  const h2s = (outline.h2s || []).filter(Boolean)
  if (h2s.length < 3) return false

  const onTopicH2 = h2s.filter(h => {
    const lower = h.toLowerCase()
    return lower.includes(phrase) || tokens.some(t => lower.includes(t))
  }).length

  return onTopicH2 >= Math.min(2, h2s.length)
}

export function formatOutlineForWriter(outline: ArticleOutline, keyword: string): string {
  const h2List = outline.h2s.map((h, i) => `${i + 1}. ${h}`).join('\n')
  return `LOCKED H1: ${outline.h1}
LOCKED H2 SECTIONS (use these exact topics — do not invent different subjects):
${h2List}
META HINT: ${outline.metaHint || `Practical guide to ${keyword}`}`
}

function fallbackOutline(keyword: string, market: string, h2Count: number): ArticleOutline {
  const titleCase = keyword
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  const pool = [
    `What Is a ${titleCase}?`,
    `Types of ${titleCase} Options`,
    `How to Choose the Right ${titleCase}`,
    `${titleCase} Installation and Costs`,
    `${titleCase} Rules and Safety Tips`,
    `FAQ`,
    `Bottom Line`,
  ]

  // Always keep FAQ + Bottom Line as last two when h2Count >= 4
  const bodySlots = Math.max(2, h2Count - 2)
  const h2s = [...pool.slice(0, bodySlots), 'FAQ', 'Bottom Line'].slice(0, h2Count)

  return {
    h1: `${titleCase}: A Practical ${market} Guide`,
    h2s,
    metaHint: `Practical ${market} guide to ${keyword}`,
  }
}

export async function generateArticleOutline(opts: {
  keyword: string
  market: string
  secondaryKeywords?: string[]
  uniqueAngle?: string
  wordCount?: number
}): Promise<ArticleOutline | null> {
  const { keyword, market, secondaryKeywords = [], uniqueAngle = '', wordCount = 2000 } = opts
  const secondary = secondaryKeywords.slice(0, 8).join(', ')
  const budget = structureBudgetForWordCount(wordCount)

  const prompt = `Create an SEO article outline for ONE topic only.

KEYWORD: ${keyword}
MARKET: ${market}
TARGET WORD COUNT: ${wordCount} words — structure MUST fit this length
${secondary ? `RELATED TERMS TO COVER: ${secondary}` : ''}
${uniqueAngle ? `ANGLE: ${uniqueAngle}` : ''}

Rules:
1. The H1 MUST include the words from "${keyword}" (or a very close natural variant like "EV Charger Guide" for "ev charger")
2. Every H2 must stay on "${keyword}"
3. Return EXACTLY ${budget.h2Count} H2 headings (including FAQ and Bottom Line as the last two)
4. Do not outline any other subject
5. Do NOT return more than ${budget.h2Count} H2s — longer outlines blow the word budget

Return JSON only:
{"h1":"...","h2s":["...","..."],"metaHint":"one sentence"}`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL_FOR.keywordExtraction,
        max_tokens: 400,
        system: `You outline SEO articles. This outline is ONLY about "${keyword}". Exactly ${budget.h2Count} H2s to fit ${wordCount} words.`,
        messages: [{ role: 'user', content: prompt }],
      })
      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as ArticleOutline
      if (!parsed?.h1 || !Array.isArray(parsed.h2s)) continue
      parsed.h2s = parsed.h2s.map(String).filter(Boolean).slice(0, budget.h2Count)
      if (outlineMatchesKeyword(parsed, keyword)) return parsed
      console.warn('[article-outline] outline failed keyword check, attempt', attempt + 1, parsed.h1)
    } catch (err) {
      console.warn('[article-outline] generate failed:', err)
    }
  }

  return fallbackOutline(keyword, market, budget.h2Count)
}

/** Short keyword-locked write prompt — outline first, hard word budget. */
export function buildOutlineLockedWritePrompt(opts: {
  keyword: string
  market: string
  tone: string
  wordCount: number
  brandName: string
  brandDomain: string
  outline: ArticleOutline
  secondaryKeywords?: string[]
  liveFacts?: string
  uniqueAngle?: string
}): string {
  const {
    keyword,
    market,
    tone,
    wordCount,
    brandName,
    brandDomain,
    outline,
    secondaryKeywords = [],
    liveFacts = '',
    uniqueAngle = '',
  } = opts
  const year = new Date().getFullYear()
  const month = new Date().toLocaleString('en-GB', { month: 'long' })
  const secondary = secondaryKeywords.slice(0, 10).join(', ')
  const brand = brandName.trim() || 'the publisher'
  const domain = brandDomain.trim() || ''
  const budget = structureBudgetForWordCount(wordCount)

  return `CRITICAL: Output ONLY valid HTML. No markdown.

PRIMARY KEYWORD: ${keyword}
TOPIC: Write exclusively about "${keyword}" for ${market}. Do not change subject.

TARGET LENGTH: ${wordCount} words (±12% soft band: ${Math.floor(wordCount * 0.88)}–${Math.ceil(wordCount * 1.12)}). Prefer depth over padding.
Section budget: ${budget.h2Count} H2s × ~${budget.wordsPerH2} words each (${budget.parasPerH2} short paragraphs per H2). FAQ: ${budget.faqCount} questions, ~60 words each.

${formatOutlineForWriter(outline, keyword)}

You MUST use the LOCKED H1 as your <h1> (polish wording slightly but keep the same topic and keyword).
You MUST use the LOCKED H2 sections as your <h2> headings in order.

TARGET: ${wordCount} words | TONE: ${tone} | DATE: ${month} ${year}
AUTHOR: Kamran Gul${brand !== 'the publisher' ? `, founder of ${brand}` : ''} — never invent other author or company names
${brand !== 'the publisher' ? `BRAND (exact): "${brand}"${domain ? ` (${domain})` : ''} — mention "${brand}" once naturally in the intro (e.g. "At ${brand}, we…"). NEVER invent or substitute other company names (Auto Trader, What Car, Parkers, etc.).` : (domain ? `SITE: ${domain}` : '')}
${secondary ? `Mention these related terms naturally once each where relevant: ${secondary}` : ''}
${uniqueAngle ? `Unique angle to include briefly: ${uniqueAngle}` : ''}

LIVE FACTS (use if relevant; do not invent numbers):
${liveFacts || 'None — write carefully and hedge uncertain figures'}

STRUCTURE:
1. First line: <!-- META: one sentence about ${keyword} -->
2. Second line: <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
3. <h1>…</h1>
4. Intro (~80–100 words) answering what ${keyword} is for ${market} readers
5. Each locked H2 with ${budget.parasPerH2} short paragraphs (~${budget.wordsPerH2} words per section)
6. FAQ with ${budget.faqCount} questions about ${keyword} — wrap each in <div class="faq-item"><h3>Q</h3><p>A</p></div>
7. Bottom Line (~60 words)
8. About the Author (Kamran Gul only, ~50 words)
9. Article + FAQPage JSON-LD scripts at the end

Before finishing: count your words. If over ${Math.ceil(wordCount * 1.12)}, cut paragraphs — never pad.

Write the complete HTML article now.`
}
