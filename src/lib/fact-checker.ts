import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from '@/lib/model-router';

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


// Signals that a claim is already properly sourced
const SOURCED_RE =
  /\b(approximately|around|about|roughly|typically|usually|generally|often|tends?|up to|as much as|as little as|on average|in most cases|varies|depends|estimate[ds]?|circa|roughly)\b|\b(according to|says|reports?|claims?|estimates?|states?|shows?|found|published|research|study|survey|data from|statistics from|figures from|per the|based on)\b|\([^)]{2,}[÷×\/\*\+\-][^)]{1,}\)/i;

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

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(Boolean);
}

function isSentenceSourced(sentence: string, paragraphHtml: string): boolean {
  if (SOURCED_RE.test(sentence)) return true;
  // Has a hyperlink in the same paragraph
  if (/href=/i.test(paragraphHtml)) return true;
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
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
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
      if (patched && patched !== flagged.sentence && patchedArticle.includes(flagged.sentence)) {
        patchedArticle = patchedArticle.replace(flagged.sentence, patched);
        patchedCount++;
      }
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
