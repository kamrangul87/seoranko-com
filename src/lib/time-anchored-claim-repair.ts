// src/lib/time-anchored-claim-repair.ts
// C04 Step 1.4 — mechanical single-sentence repair loop for time-anchored
// claims (see dated-claim-detector.ts's detectTimeAnchoredClaims and
// article-quality-gate.ts's validateTimeAnchoredClaims). Only the exact
// failing sentence is ever sent to the model, and only that sentence is
// re-validated afterwards — never a whole-article rewrite (banned by rule
// A02: prompt-only enforcement has already failed twice in this repo).

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'
import { isSafeTextPatch } from '@/lib/sentence-integrity'
import { detectTimeAnchoredClaims } from '@/lib/dated-claim-detector'
import { validateTimeAnchoredClaims, type TimeAnchoredClaimFailure } from '@/lib/article-quality-gate'

const MAX_REPAIR_ATTEMPTS = 2

const REPAIR_SYSTEM_PROMPT = `You fix ONE sentence from an article so a figure is no longer anchored to "now" or a specific date.
RULES:
- Keep the numeric figure exactly as written (same number/%/currency) — never change it
- Keep any citation link (an <a href="...">...</a> tag) exactly as written, if present
- Remove the date-anchoring language — no "as of <date>", no "currently", no "the current X is",
  no "<Month> <Year> update/figures/rates/data", no "will X in <Year>" — instead phrase it as a
  standing fact the reader should verify, e.g. "grants of up to £350, subject to change" or
  "the threshold is periodically reviewed and may change"
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
    console.warn('[time-anchored-claim-repair] Haiku rewrite failed:', err)
    return null
  }
}

export interface TimeAnchoredClaimRepairResult {
  article: string
  repairedCount: number
  stillFailing: TimeAnchoredClaimFailure[]
}

/**
 * Retries up to MAX_REPAIR_ATTEMPTS times. Each pass re-detects and
 * re-validates from the CURRENT article text (not a cached claim list) —
 * an earlier patch shifts character offsets, so re-running detection is
 * what keeps `stillFailing` accurate rather than pointing at stale text.
 * A sentence that no longer contains the time-anchoring pattern after a
 * repair simply stops appearing in detectTimeAnchoredClaims's output —
 * that IS success, this loop does not separately try to add a citation.
 */
export async function repairTimeAnchoredClaims(
  articleHtml: string,
  now: Date = new Date(),
): Promise<TimeAnchoredClaimRepairResult> {
  let article = articleHtml
  let repairedCount = 0
  let stillFailing: TimeAnchoredClaimFailure[] = []

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const claims = detectTimeAnchoredClaims(article, now)
    const uniqueClaims = Array.from(new Map(claims.map(c => [c.sentence.trim(), c])).values())
    const failures = validateTimeAnchoredClaims(article, uniqueClaims)

    if (failures.length === 0) {
      stillFailing = []
      break
    }
    stillFailing = failures
    if (attempt === MAX_REPAIR_ATTEMPTS) break

    let anyPatched = false
    for (const failure of failures) {
      const original = failure.claim.sentence
      if (!article.includes(original)) continue

      const rewritten = await rewriteSentence(original)
      if (!rewritten || rewritten === original) continue
      if (!isSafeTextPatch(original, rewritten)) {
        console.warn('[time-anchored-claim-repair] rejected a patch that failed sentence integrity:', original.slice(0, 80))
        continue
      }
      // "Keep the number" is a prompt instruction, not something the model
      // can be trusted to always honour — verify it mechanically rather
      // than trust prompt-only compliance (this repo's own repeat failure
      // mode). Reject any patch that drops or alters the exact figure.
      if (
        failure.claim.extractedNumericValue &&
        !rewritten.includes(failure.claim.extractedNumericValue)
      ) {
        console.warn('[time-anchored-claim-repair] rejected a patch that altered the numeric figure:', original.slice(0, 80))
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
