// Trim articles that exceed the user's target word count (models often overshoot).

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'

const client = new Anthropic()

export function countArticleWords(html: string): number {
  return html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length
}

/** Hard ceiling: 8% over target triggers a condense pass. */
export function exceedsWordCountTarget(html: string, target: number): boolean {
  return countArticleWords(html) > Math.ceil(target * 1.08)
}

export async function enforceWordCountLimit(html: string, target: number): Promise<string> {
  const current = countArticleWords(html)
  const maxAllowed = Math.ceil(target * 1.08)
  if (current <= maxAllowed) return html

  console.log(`[word-count] ${current} words exceeds target ${target} — condensing`)

  const response = await client.messages.create({
    model: MODEL_FOR.mergeArtifactRepair,
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `This HTML article is ${current} words but MUST be ${target} words or fewer (hard limit — the user selected this length).

Shorten it to approximately ${target} words by:
- Tightening prose and removing redundancy
- Keeping every H2 section, FAQ block, byline, bottom line, and author bio
- Preserving all factual claims and links

Return ONLY the shortened HTML. No commentary, no markdown fences.`,
    }],
  })

  const condensed = response.content[0].type === 'text' ? response.content[0].text.trim() : html
  if (!condensed) return html

  const after = countArticleWords(condensed)
  console.log(`[word-count] after condense: ${after} words (target ${target})`)
  return condensed
}
