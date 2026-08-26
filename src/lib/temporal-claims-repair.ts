// src/lib/temporal-claims-repair.ts
// Mechanical single-sentence repair loop for temporal-claims.ts's stricter
// same-sentence C04 check. Only the exact failing sentence is ever sent to
// the model, and only that sentence is re-validated afterwards — never a
// whole-article rewrite.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'
import { isSafeTextPatch } from '@/lib/sentence-integrity'
import { detectTemporalClaims, type TemporalClaim } from '@/lib/temporal-claims'

const MAX_REPAIR_ATTEMPTS = 2
const NUMERIC_QUALIFYING_TERM_RE = /[£$€]\s?\d|\d+(?:\.\d+)?\s?%/

const REPAIR_SYSTEM_PROMPT = `You fix ONE sentence from an article so a figure is no longer anchored to "now" or a specific date.
RULES:
- Keep the numeric figure exactly as written (same number/%/currency) — never change it
- Keep any citation link (an <a href="...">...</a> tag) exactly as written, if present
- Remove the date-anchoring language — no "as of <date>", no "currently", no "at the time of writing",
  no bare "<Month> <Year>", no "this year" — instead phrase it as a standing fact the reader should
  verify, e.g. "grants of up to £350, subject to change" or "the threshold is periodically reviewed"
- Do NOT add a new sentence, split the sentence into two, or change anything else about it
- Return ONLY the rewritten sentence — no commentary, no surrounding quotes, no markdown`

async function rewriteSentence(sentence: string): Promise<string | null> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const response = await client.messages.create({
      model: MODEL_FOR.timeAnchoredClaimRepair,
      max_tokens: 300,
      system: [{ type: 'text' as const, text: REPAIR_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user', content: sentence }],
    })
    const block = response.content[0]
    const raw = block?.type === 'text' ? block.text.trim() : ''
    return raw || null
  } catch (err) {
    console.warn('[temporal-claims-repair] Haiku rewrite failed:', err)
    return null
  }
}

export interface TemporalClaimRepairResult {
  article: string
  repairedCount: number
  stillFailing: TemporalClaim[]
}

/**
 * Retries up to MAX_REPAIR_ATTEMPTS times, re-detecting from the CURRENT
 * article text each pass (an earlier patch shifts character offsets). A
 * sentence that no longer matches a temporal marker after a repair simply
 * stops appearing in detectTemporalClaims's output — that IS success; this
 * loop does not separately try to add a citation.
 */
export async function repairTemporalClaims(
  articleHtml: string,
): Promise<TemporalClaimRepairResult> {
  let article = articleHtml
  let repairedCount = 0
  let stillFailing: TemporalClaim[] = []

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const claims = detectTemporalClaims(article)
    const uniqueFailing = Array.from(
      new Map(
        claims.filter(c => !c.hasSameSentenceCitation).map(c => [c.sentence.trim(), c]),
      ).values(),
    )

    if (uniqueFailing.length === 0) {
      stillFailing = []
      break
    }
    stillFailing = uniqueFailing
    if (attempt === MAX_REPAIR_ATTEMPTS) break

    let anyPatched = false
    for (const claim of uniqueFailing) {
      const original = claim.sentence
      if (!article.includes(original)) continue

      const rewritten = await rewriteSentence(original)
      if (!rewritten || rewritten === original) continue
      if (!isSafeTextPatch(original, rewritten)) {
        console.warn('[temporal-claims-repair] rejected a patch that failed sentence integrity:', original.slice(0, 80))
        continue
      }
      // "Keep the number" is a prompt instruction, not something the model
      // can be trusted to always honour — verify it mechanically. Checked
      // against the whole ORIGINAL sentence, not claim.qualifyingTerm —
      // regex alternation picks whichever qualifying term matches first
      // left-to-right (e.g. "grant" before "75%" in "the grant covers
      // 75%"), so qualifyingTerm alone can miss a real figure elsewhere in
      // the same sentence.
      const numericMatch = original.match(NUMERIC_QUALIFYING_TERM_RE)
      if (numericMatch && !rewritten.includes(numericMatch[0].trim())) {
        console.warn('[temporal-claims-repair] rejected a patch that altered the numeric figure:', original.slice(0, 80))
        continue
      }

      article = article.replace(original, rewritten)
      repairedCount++
      anyPatched = true
    }

    if (!anyPatched) break // no progress possible this pass — stop retrying
  }

  return { article, repairedCount, stillFailing }
}
