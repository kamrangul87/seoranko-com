// Trim articles that exceed the user's target word count (models often overshoot).
// Competitor-style length band: hit target ±8%, never ship ~2× over.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'

const client = new Anthropic()

export function countArticleWords(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

/** Hard ceiling: 8% over target triggers a condense pass. */
export function exceedsWordCountTarget(html: string, target: number): boolean {
  return countArticleWords(html) > Math.ceil(target * 1.08)
}

export function wordCountBand(target: number): { min: number; max: number } {
  return {
    min: Math.floor(target * 0.85),
    max: Math.ceil(target * 1.08),
  }
}

/** Structure budget so outlines don't ask for 2× the target length. */
export function structureBudgetForWordCount(target: number): {
  h2Count: number
  faqCount: number
  parasPerH2: number
  wordsPerH2: number
} {
  if (target <= 2200) return { h2Count: 6, faqCount: 5, parasPerH2: 3, wordsPerH2: 200 }
  if (target <= 2700) return { h2Count: 7, faqCount: 5, parasPerH2: 3, wordsPerH2: 220 }
  return { h2Count: 7, faqCount: 6, parasPerH2: 3, wordsPerH2: 250 }
}

/**
 * Deterministic trim when LLM condense still overshoots.
 * Drops middle body H2 sections first; keeps H1, intro, FAQ, bottom line, author.
 */
export function deterministicTrimToTarget(html: string, target: number): string {
  const maxAllowed = Math.ceil(target * 1.08)
  if (countArticleWords(html) <= maxAllowed) return html

  // Split on H2 boundaries while keeping the tags
  const parts = html.split(/(?=<h2[\s>])/i)
  if (parts.length < 4) {
    // Can't safely drop sections — truncate long paragraphs
    return trimParagraphs(html, maxAllowed)
  }

  const isProtected = (block: string) =>
    /faq|frequently asked|bottom line|about the author|conclusion/i.test(
      (block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '').replace(/<[^>]+>/g, '')
    )

  const head = parts[0]
  const sections = parts.slice(1)
  const protectedSecs = sections.filter(isProtected)
  const bodySecs = sections.filter(s => !isProtected(s))

  // Drop from the middle of body sections until under budget
  while (bodySecs.length > 2 && countArticleWords(head + bodySecs.join('') + protectedSecs.join('')) > maxAllowed) {
    const dropIdx = Math.floor(bodySecs.length / 2)
    bodySecs.splice(dropIdx, 1)
  }

  let result = head + bodySecs.join('') + protectedSecs.join('')
  if (countArticleWords(result) > maxAllowed) {
    result = trimParagraphs(result, maxAllowed)
  }
  return result
}

function trimParagraphs(html: string, maxAllowed: number): string {
  let current = html
  // Shorten longest <p> blocks iteratively
  for (let i = 0; i < 20 && countArticleWords(current) > maxAllowed; i++) {
    const paras = Array.from(current.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    if (!paras.length) break
    let longest = paras[0]
    for (const p of paras) {
      if ((p[1] || '').length > (longest[1] || '').length) longest = p
    }
    const text = longest[1].replace(/<[^>]+>/g, ' ').trim()
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length < 40) break
    const kept = words.slice(0, Math.floor(words.length * 0.7)).join(' ')
    current = current.replace(longest[0], `<p>${kept}</p>`)
  }
  return current
}

async function condenseOnce(html: string, target: number, current: number, allowDropSections: boolean): Promise<string> {
  const response = await client.messages.create({
    model: MODEL_FOR.mergeArtifactRepair,
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `This HTML article is ${current} words. HARD LIMIT: ${target} words or fewer (user-selected length).

Shorten aggressively to ~${target} words:
- Cut redundancy and merge thin paragraphs
- Keep the H1 and primary keyword topic intact
- Keep FAQ, Bottom Line, and About the Author
${allowDropSections
  ? '- You MAY remove 1–2 lowest-value middle H2 sections entirely if needed to hit the limit'
  : '- Prefer tightening prose; only merge sections if essential'}
- Preserve factual claims, links, and schema scripts

Return ONLY the shortened HTML. No commentary, no markdown fences.`,
    }],
  })

  const condensed = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  if (!condensed || condensed.length < html.length * 0.3) return html
  return condensed.replace(/^```html?\n?/i, '').replace(/```\s*$/, '').trim()
}

/**
 * Enforce target ±8%. Loops LLM condense, then deterministic trim.
 * Always returns HTML at or under ceil(target * 1.08) when possible.
 */
export async function enforceWordCountLimit(html: string, target: number): Promise<string> {
  const maxAllowed = Math.ceil(target * 1.08)
  let current = countArticleWords(html)
  if (current <= maxAllowed) return html

  console.log(`[word-count] ${current} words exceeds target ${target} (max ${maxAllowed}) — condensing`)

  let result = html
  for (let attempt = 0; attempt < 3; attempt++) {
    current = countArticleWords(result)
    if (current <= maxAllowed) break
    try {
      const next = await condenseOnce(result, target, current, attempt >= 1)
      const nextCount = countArticleWords(next)
      // Only accept if shorter (or equal and already under — shouldn't happen)
      if (nextCount < current) {
        result = next
        console.log(`[word-count] condense attempt ${attempt + 1}: ${current} → ${nextCount}`)
      } else {
        console.warn(`[word-count] condense attempt ${attempt + 1} did not shorten (${nextCount})`)
        break
      }
    } catch (err) {
      console.warn('[word-count] condense LLM failed:', err)
      break
    }
  }

  if (countArticleWords(result) > maxAllowed) {
    const before = countArticleWords(result)
    result = deterministicTrimToTarget(result, target)
    console.log(`[word-count] deterministic trim: ${before} → ${countArticleWords(result)}`)
  }

  return result
}
