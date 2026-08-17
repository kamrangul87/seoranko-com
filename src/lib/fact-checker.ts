import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from '@/lib/model-router';
import { getAnthropicClient } from '@/lib/anthropic'
import { isSafeTextPatch, splitIntoSentences } from '@/lib/sentence-integrity';

export interface FlaggedClaim {
  claim: string;
  sentence: string;
  issue: 'unsourced_statistic';
}

export interface FactSourcingResult {
  factSourcingScore: number;
  flaggedClaims: FlaggedClaim[];
  patchedCount: number;
}

export interface FactSourcingOutput {
  article: string;
  result: FactSourcingResult;
}


// A real source names WHO is behind the claim — a specific organisation,
// acronym, or capitalised proper-noun phrase, tolerating up to two words
// (e.g. "latest published") between the possessive source name and the
// reporting verb/noun. This rejects vague attribution like "a report
// found", "researchers say", "a 2024 analysis found", "retailers reported"
// (generic/lowercase nouns), while accepting "GOV.UK confirms", "Ofgem's
// open data", "DVSA guidance", "Rightmove data", "According to Ofcom's
// 2026 report", and "DVSA's own testing figures confirm".
export const NAMED_SOURCE_RE =
  /\b(GOV\.UK|gov\.uk|Ofgem|DVSA|DVLA|HMRC|NHS|DfT|ONS|Rightmove|Ofcom|FCA|CMA|[A-Z][a-zA-Z&.]*(?:\s+[A-Z][a-zA-Z&.]*){0,3})('s)?\s+(?:\w+\s+){0,2}(?:data|report(?:s|ed|ing)?|found|shows?|states?|says?|confirms?|analysis|statistics?|survey|research|study|figures?)\b/;

// Generic/vague nouns that can masquerade as a "named source" purely
// because they're capitalised at the start of a sentence (e.g.
// "Researchers say demand is growing" — capitalised only due to sentence
// position, not because "Researchers" is a genuine proper noun). Matched
// case-insensitively against the captured source-name text so these are
// rejected regardless of position.
const VAGUE_ATTRIBUTION_TERMS = new Set([
  'researchers', 'experts', 'studies', 'reports', 'analysts', 'scientists',
  'officials', 'sources', 'surveys', 'data', 'statistics', 'research',
  'a report', 'the report', 'some', 'many', 'most', 'observers', 'critics',
]);

// An inline calculation shown as working, e.g. "(7,400W ÷ 230V)", counts as
// the claim being derived/verifiable rather than asserted from nowhere.
const SHOWN_WORKING_RE = /\([^)]{2,}[÷×\/\*\+\-][^)]{1,}\)/;

function isYearDate(raw: string): boolean {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length !== 4) return false;
  const n = parseInt(digits, 10);
  return n >= 2000 && n <= 2099;
}

function extractNumericValuesFromSentence(sentence: string): string[] {
  const re =
    /(?:\b\d+(?:\.\d+)?%|[£$€]\d[\d,.]*|\b\d[\d,]*\s*(?:kW|MW|kWh|km|miles?|mph|kg|tonne|litre|hour|minute|second|day|month)s?\b|\b\d{4,}(?:,\d{3})*\b)/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    if (!isYearDate(m[0])) found.push(m[0]);
  }
  return found;
}

function paragraphsFromHtml(html: string): Array<{ innerHtml: string; text: string }> {
  const results: Array<{ innerHtml: string; text: string }> = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const innerHtml = m[1];
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    results.push({ innerHtml, text });
  }
  return results;
}

// Reject matches where the captured "source name" is itself a vague noun
// (e.g. "Researchers say...") that's capitalised only by sentence position.
// Exported so other pattern-based checks (dated-claim-detector.ts) can reuse
// exactly this "is this actually a named source" judgment rather than
// re-matching NAMED_SOURCE_RE and re-deriving the vague-term exclusion.
export function hasNamedSource(text: string): boolean {
  const match = text.match(NAMED_SOURCE_RE);
  if (match && !VAGUE_ATTRIBUTION_TERMS.has(match[1].toLowerCase())) return true;

  // "According to GOV.UK...", "per Ofgem guidance", "under DVSA rules"
  if (
    /\b(according to|per|under|from|as stated (?:on|by|in))\s+(?:the\s+)?(GOV\.UK|gov\.uk|Ofgem|OZEV|Office for Zero Emission Vehicles|DVSA|DVLA|HMRC|NHS|DfT|ONS|Rightmove|Ofcom|FCA|CMA)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  // "GOV.UK's official ... pages/guidance/site" — no reporting verb required
  if (
    /\b(GOV\.UK|gov\.uk|Ofgem|OZEV|Office for Zero Emission Vehicles)\s*('s)?\s+official\b/i.test(
      text,
    )
  ) {
    return true;
  }

  // Named regulator/body cited in policy context without a strict verb pattern
  if (
    /\b(Office for Zero Emission Vehicles|OZEV|Ofgem|DVSA|DVLA|HMRC|GOV\.UK|gov\.uk)\b/i.test(
      text,
    ) &&
    /\b(grant|scheme|fund|policy|regulation|guidance|tariff|chargepoint)\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

function isSentenceSourced(sentence: string, paragraphHtml: string): boolean {
  // Has a hyperlink in the same paragraph — genuinely checkable, always counts
  if (/href=/i.test(paragraphHtml)) return true;
  if (hasNamedSource(sentence)) return true;
  // Shows the arithmetic behind the number, so it's derivable/verifiable
  if (SHOWN_WORKING_RE.test(sentence)) return true;
  return false;
}

export async function checkAndPatchFactSourcing(
  article: string,
  keyword: string,
  market: string,
): Promise<FactSourcingOutput> {
  const paragraphs = paragraphsFromHtml(article);
  const flaggedClaims: FlaggedClaim[] = [];

  let totalNumericSentences = 0;
  let sourcedCount = 0;

  for (const { innerHtml, text } of paragraphs) {
    const sentences = splitIntoSentences(text);
    for (const sentence of sentences) {
      const nums = extractNumericValuesFromSentence(sentence);
      if (nums.length === 0) continue;
      totalNumericSentences++;
      if (isSentenceSourced(sentence, innerHtml)) {
        sourcedCount++;
      } else {
        flaggedClaims.push({
          claim: nums[0],
          sentence: sentence.slice(0, 200),
          issue: 'unsourced_statistic',
        });
      }
    }
  }

  const factSourcingScore =
    totalNumericSentences === 0
      ? 100
      : Math.round((sourcedCount / totalNumericSentences) * 100);

  // If score is already good enough, return unchanged article
  if (factSourcingScore >= 80 || flaggedClaims.length === 0) {
    return {
      article,
      result: { factSourcingScore, flaggedClaims, patchedCount: 0 },
    };
  }

  // Auto-patch: send flagged sentences to Haiku for hedging/attribution
  const flaggedSnippets = flaggedClaims
    .slice(0, 20) // cap at 20 to keep prompt short
    .map((f, i) => `${i + 1}. "${f.sentence}"`)
    .join('\n');

  let patchedArticle = article;
  let patchedCount = 0;

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: MODEL_FOR.bannedWordDetection,
      max_tokens: 2048,
      system: [{ type: 'text' as const, text: `You are a fact-sourcing editor for an article about "${keyword}" in the ${market} market.
Your job: rewrite each numbered sentence to add appropriate hedging (approximately, typically, around, etc.) or attribution (According to industry data, ...).
RULES:
- Keep the meaning identical; only add hedging words or attribution phrases
- Do NOT invent specific sources or URLs
- Do NOT change the HTML structure
- Return ONLY a JSON array of rewritten sentences, indexed from 1, no other text
- Example output: {"1": "rewritten sentence 1", "2": "rewritten sentence 2"}`, cache_control: { type: 'ephemeral' as const } }],
      messages: [{
        role: 'user',
        content: `Rewrite these unsourced sentences with appropriate hedging:\n\n${flaggedSnippets}`,
      }],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const cleanRaw = raw.replace(/```json|```/g, '').trim();
    const patches: Record<string, string> = JSON.parse(cleanRaw);

    flaggedClaims.slice(0, 20).forEach((flagged, i) => {
      const key = String(i + 1);
      const patched = patches[key];
      if (!patched || patched === flagged.sentence || !patchedArticle.includes(flagged.sentence)) return;
      // Shared integrity guard — reject sentence splits / insertion corruption
      if (!isSafeTextPatch(flagged.sentence, patched)) {
        console.warn('[fact-checker] rejected a patch that failed sentence integrity:', flagged.sentence.slice(0, 80));
        return;
      }
      patchedArticle = patchedArticle.replace(flagged.sentence, patched);
      patchedCount++;
    });

    // Recalculate score based on patchedCount improvement
    const improvedSourced = sourcedCount + patchedCount;
    const improvedScore = Math.round((improvedSourced / totalNumericSentences) * 100);

    return {
      article: patchedArticle,
      result: {
        factSourcingScore: Math.min(100, improvedScore),
        flaggedClaims,
        patchedCount,
      },
    };
  } catch (err) {
    console.error('[fact-checker] patching failed:', err);
    return {
      article,
      result: { factSourcingScore, flaggedClaims, patchedCount: 0 },
    };
  }
}
