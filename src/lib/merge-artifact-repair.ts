// src/lib/merge-artifact-repair.ts
// Detects truncated-word / merged-sentence artifacts (the "gging",
// "ificant", "18%. months" family of bugs) and repairs them with a
// targeted single-sentence fix rather than trusting the generation
// prompt alone to avoid them. A system-prompt instruction is a request,
// not an enforcement mechanism — this is the mechanical detect-and-repair
// loop (same principle RARR uses for attribution repair).

import Anthropic from '@anthropic-ai/sdk'
import { MODEL_FOR } from '@/lib/model-router'

export interface MergeArtifact {
  matchedText: string
  index: number
  sentenceContext: string
}

// Broadened detection patterns covering the known bug shapes seen in
// production: truncated words before a period, merged sentences with
// no space, and stray mid-word punctuation like "18%. months" or
// "Network.s Association" / "22kW. units"
const MERGE_ARTIFACT_PATTERNS = [
  /\b[a-z]{2,}\.\s?[a-z]\s[a-z]{2,}\b/g,             // "ificant.t network" style (any word length)
  /\b[A-Za-z]{3,}\.[a-z]\s+[A-Z][a-z]+/g,            // "Network.s Association" — period mid-word
  /\b\d+[a-zA-Z]*\.\s+[a-z]{2,}\b/g,                 // "22kW. units" — period after unit/number
  /\b\d+%\.\s+[a-z]{3,}\b/g,                         // "18%. months" style — number+percent then broken clause
  /[a-z]\.[A-Z][a-z]+/g,                             // "word.Next" — missing space after period
]

// Mechanical fixes for merge shapes that have an obvious correct form — no
// Claude call needed. Runs before the targeted repair loop so common cases
// like "Network.s Association" and "22kW. units" are fixed deterministically.
export function applyDeterministicMergeFixes(articleContent: string): { content: string; fixesMade: number } {
  let content = articleContent
  let fixesMade = 0

  // "Network.s Association" → "Networks Association" (drop stray mid-word period)
  content = content.replace(/\b([A-Za-z]{3,})\.([a-z])\s+(?=[A-Z])/g, (_match, word: string, letter: string) => {
    fixesMade++
    return `${word}${letter} `
  })

  // "22kW. units" → "22kW units" (drop stray period after number/unit)
  content = content.replace(/\b(\d+[a-zA-Z]*)\.\s+([a-z]{2,})\b/g, (_match, unit: string, word: string) => {
    fixesMade++
    return `${unit} ${word}`
  })

  // "18%. months" → "18% months"
  content = content.replace(/\b(\d+%)\.\s+([a-z]{3,})\b/g, (_match, pct: string, word: string) => {
    fixesMade++
    return `${pct} ${word}`
  })

  return { content, fixesMade }
}

// Detects directly against the real content (not a stripped copy) — the
// repair step below splices the fix back in by finding `matchedText`
// verbatim, which only works if detection ran against the exact same
// string being mutated. (An earlier version of this detector scanned a
// whitespace-collapsed, tag-stripped copy for `sentenceContext`, then tried
// to find that collapsed text inside the original HTML — a substring that,
// once real HTML tags and multi-line whitespace are back in the mix, almost
// never matches, so the repair silently no-ops while still burning a Claude
// call and reporting a false `repairsMade` count.)
export function detectMergeArtifacts(articleContent: string): MergeArtifact[] {
  const artifacts: MergeArtifact[] = []

  for (const pattern of MERGE_ARTIFACT_PATTERNS) {
    let match
    const re = new RegExp(pattern.source, pattern.flags)
    while ((match = re.exec(articleContent)) !== null) {
      const contextStart = Math.max(0, match.index - 80)
      const contextEnd = Math.min(articleContent.length, match.index + 80)
      const sentenceContext = articleContent.slice(contextStart, contextEnd)
      // Skip matches inside an href/src/style attribute value — a URL or
      // inline style is not prose and isn't safe to hand to Claude for a
      // "clean this sentence up" rewrite.
      if (/(href|src|style)=["'][^"']*$/i.test(articleContent.slice(contextStart, match.index))) continue
      artifacts.push({
        matchedText: match[0],
        index: match.index,
        sentenceContext
      })
    }
  }
  return artifacts
}

const client = new Anthropic()

// Repair ONE broken sentence at a time — cheap, targeted, doesn't
// risk introducing new issues by regenerating the whole article
export async function repairMergeArtifact(
  articleContent: string,
  artifact: MergeArtifact
): Promise<string> {

  const response = await client.messages.create({
    model: MODEL_FOR.mergeArtifactRepair,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `This fragment from an article has a broken/truncated word or a
merged sentence with no proper spacing. Surrounding context, for reference
only:

"${artifact.sentenceContext}"

The specific broken part to fix is exactly this substring: "${artifact.matchedText}"

Rewrite ONLY that substring as clean, complete, correctly-punctuated text —
do not rewrite the surrounding context, do not add or remove anything before
or after it. Keep the same meaning and facts. Return ONLY the corrected
replacement for that substring, nothing else — no explanation, no quotes
around it, no HTML tags unless the original substring already contained them.`
    }]
  })

  const fixed = response.content[0].type === 'text' ? response.content[0].text.trim() : artifact.matchedText
  if (!fixed) return articleContent

  // matchedText was captured from this exact string by detectMergeArtifacts,
  // so it is guaranteed to be found — replaces only the first occurrence.
  return articleContent.replace(artifact.matchedText, fixed)
}

// Full repair pass — detect all artifacts, fix each one, return clean content
export async function repairAllMergeArtifacts(
  articleContent: string
): Promise<{ content: string; repairsMade: number }> {

  const deterministic = applyDeterministicMergeFixes(articleContent)
  let currentContent = deterministic.content
  let repairsMade = deterministic.fixesMade

  // Re-detect after each fix since positions shift — cap at 5 to avoid
  // runaway loops on genuinely malformed content
  for (let i = 0; i < 5; i++) {
    const artifacts = detectMergeArtifacts(currentContent)
    if (artifacts.length === 0) break

    try {
      currentContent = await repairMergeArtifact(currentContent, artifacts[0])
      repairsMade++
    } catch (err) {
      console.warn('[merge-artifact-repair] repair call failed, stopping pass:', err)
      break
    }
  }

  return { content: currentContent, repairsMade }
}
