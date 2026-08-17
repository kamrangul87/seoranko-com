// Soft length band (Jasper / Surfer-style): aim near target ±12%, expand under min,
// condense over max — never treat length as a hard SEO ranking factor.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'
import {
  countArticleWords,
  wordCountBand,
} from '@/lib/word-count'

export {
  WORD_COUNT_OPTIONS,
  snapWordCount,
  countArticleWords,
  wordCountBand,
  exceedsWordCountTarget,
  structureBudgetForWordCount,
} from '@/lib/word-count'
export type { WordCountOption } from '@/lib/word-count'

const client = new Anthropic()

/**
 * Deterministic trim when LLM condense still overshoots.
 * Drops middle body H2 sections first; keeps H1, intro, FAQ, bottom line, author.
 */
export function deterministicTrimToTarget(html: string, target: number): string {
  const { max: maxAllowed, min: minAllowed } = wordCountBand(target)
  if (countArticleWords(html) <= maxAllowed) return html

  // Split on H2 boundaries while keeping the tags
  const parts = html.split(/(?=<h2[\s>])/i)
  if (parts.length < 4) {
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

  while (bodySecs.length > 2 && countArticleWords(head + bodySecs.join('') + protectedSecs.join('')) > maxAllowed) {
    const dropIdx = Math.floor(bodySecs.length / 2)
    bodySecs.splice(dropIdx, 1)
    // Stop trimming if we'd drop below the soft minimum
    if (countArticleWords(head + bodySecs.join('') + protectedSecs.join('')) < minAllowed) break
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

async function expandOnce(html: string, target: number, current: number): Promise<string> {
  const response = await client.messages.create({
    model: MODEL_FOR.mergeArtifactRepair,
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `This HTML article is only ${current} words. Expand it to approximately ${target} words (±10%).

Rules:
- Keep the same H1 topic and all existing H2 headings
- Add useful detail, examples, and clarifications inside existing sections — do not invent a new subject
- Keep FAQ, Bottom Line, author, links, and schema scripts
- Do not pad with fluff or repetition

Return ONLY the expanded HTML. No commentary, no markdown fences.`,
    }],
  })
  const expanded = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  if (!expanded || expanded.length < html.length * 0.8) return html
  return expanded.replace(/^```html?\n?/i, '').replace(/```\s*$/, '').trim()
}

/**
 * Jasper-style length band: land near target (±12%).
 * Condense when over max; expand once when under min; never over-trim below min.
 */
export async function enforceWordCountLimit(html: string, target: number): Promise<string> {
  const { min: minAllowed, max: maxAllowed } = wordCountBand(target)
  let current = countArticleWords(html)
  let result = html

  if (current >= minAllowed && current <= maxAllowed) return html

  if (current > maxAllowed) {
    console.log(`[word-count] ${current} words exceeds target ${target} (max ${maxAllowed}) — condensing`)
    for (let attempt = 0; attempt < 3; attempt++) {
      current = countArticleWords(result)
      if (current <= maxAllowed) break
      try {
        const next = await condenseOnce(result, target, current, attempt >= 1)
        const nextCount = countArticleWords(next)
        if (nextCount < current && nextCount >= Math.floor(minAllowed * 0.9)) {
          result = next
          console.log(`[word-count] condense attempt ${attempt + 1}: ${current} → ${nextCount}`)
        } else if (nextCount < current) {
          // Accept but stop before another pass that would go far under min
          result = next
          console.log(`[word-count] condense attempt ${attempt + 1}: ${current} → ${nextCount} (near floor)`)
          break
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
  } else if (current < minAllowed) {
    console.log(`[word-count] ${current} words under target ${target} (min ${minAllowed}) — expanding`)
    try {
      const next = await expandOnce(result, target, current)
      const nextCount = countArticleWords(next)
      if (nextCount > current) {
        result = next
        console.log(`[word-count] expand: ${current} → ${nextCount}`)
      }
    } catch (err) {
      console.warn('[word-count] expand LLM failed:', err)
    }
  }

  return result
}
