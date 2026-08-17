// src/lib/fact-verifier.ts
// SEORANKO Fact Verification Module — Pipeline v2

import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from './model-router';
import { applyGuardedReplace } from '@/lib/sentence-integrity';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ─── TYPES ───────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';
export type TopicCategory = 'evergreen' | 'regulatory' | 'health' | 'finance' | 'legal' | 'news' | 'technical';

export interface TopicClassification {
  topic_category: TopicCategory;
  requires_live_verification: boolean;
  risk_level: RiskLevel;
  risk_reason: string;
  verification_queries: string[];
  authoritative_sources: string[];
}

export interface VerifiedFact {
  fact: string;
  source: string;
  confidence: 'confirmed' | 'likely' | 'unverified';
}

export interface FactExtractionResult {
  verified_facts: VerifiedFact[];
  conflicting_claims: Array<{
    claim: string;
    source_a: string;
    source_b: string;
    recommendation: string;
  }>;
  unverifiable_claims: string[];
  safe_to_proceed: boolean;
  blocker_reason?: string;
}

export interface EditorialAudit {
  fact_audit: Array<{
    claim: string;
    status: 'verified' | 'unverified' | 'removed';
    action: 'keep' | 'remove' | 'caveat';
  }>;
  broken_links: string[];
  schema_issues: string[];
  article_clean: boolean;
  edits_to_apply?: Array<{ find: string; replace: string }>;
  final_article: string;
}

function cleanJson(text: string): string {
  let cleaned = text.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();
  const firstBrace = Math.min(
    cleaned.indexOf('{') === -1 ? Infinity : cleaned.indexOf('{'),
    cleaned.indexOf('[') === -1 ? Infinity : cleaned.indexOf('[')
  );
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (firstBrace !== Infinity && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function repairJson(text: string): string {
  let cleaned = cleanJson(text);
  const openBraces = (cleaned.match(/{/g) || []).length;
  let closeBraces = (cleaned.match(/}/g) || []).length;
  const openBrackets = (cleaned.match(/\[/g) || []).length;
  let closeBrackets = (cleaned.match(/\]/g) || []).length;
  cleaned = cleaned.replace(/,\s*$/, '');
  cleaned = cleaned.replace(/,\s*}/g, '}');
  cleaned = cleaned.replace(/,\s*]/g, ']');
  while (closeBrackets < openBrackets) { cleaned += ']'; closeBrackets++; }
  while (closeBraces < openBraces) { cleaned += '}'; closeBraces++; }
  return cleaned;
}

function safeParseJson<T>(text: string, context = 'unknown', repair = false): T {
  try {
    const parsed = repair ? repairJson(text) : cleanJson(text);
    return JSON.parse(parsed) as T;
  } catch (err) {
    console.error(`[fact-verifier] JSON parse failed in ${context}. Raw text:`, text.slice(0, 500));
    throw new Error(`JSON parse failed in ${context}: ${err}`);
  }
}

// ─── CALL 1: TOPIC CLASSIFICATION ────────────────────────

export async function classifyTopic(keyword: string): Promise<TopicClassification> {
  const response = await anthropic.messages.create({
    model: MODEL_FOR.factVerification,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a content strategist. Classify this article topic and determine what facts need live verification.

Topic: ${keyword}

Respond ONLY in valid JSON with no markdown or preamble:
{
  "topic_category": "evergreen | regulatory | health | finance | legal | news | technical",
  "requires_live_verification": true,
  "risk_level": "low | medium | high",
  "risk_reason": "why this topic could contain outdated or hallucinated facts",
  "verification_queries": ["exact search query 1","exact search query 2","exact search query 3"],
  "authoritative_sources": ["gov.uk","nhs.uk"]
}

HIGH risk: government rules/laws/regulations, tax rates, financial thresholds, health claims, statistics with specific numbers, dates/deadlines, legal requirements, product pricing
MEDIUM risk: market data, product specs, industry trends
LOW risk: evergreen how-to guides, opinion pieces, general advice`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return safeParseJson<TopicClassification>(text, 'classifyTopic');
}

// ─── CALL 2: WEB SEARCH (Anthropic built-in tool) ────────

export async function searchAndCollectFacts(
  keyword: string,
  queries: string[],
  riskLevel: RiskLevel
): Promise<string> {
  const maxResults = riskLevel === 'high' ? 5 : riskLevel === 'medium' ? 3 : 2;
  const queriesToRun = riskLevel === 'low' ? queries.slice(0, 1) : queries;

  const searchPrompt = `You are a research assistant. Search for accurate, up-to-date information about: "${keyword}"

Run searches using these specific queries:
${queriesToRun.map((q, i) => `${i + 1}. ${q}`).join('\n')}

For each query, retrieve the top ${maxResults} results. Extract all specific factual claims including:
- Dates and deadlines
- Numbers, statistics, percentages
- Legal requirements and rules
- Official announcements
- Named organisations and their statements

Return ALL raw facts found, with the source URL for each. Do not summarise or interpret — just collect the facts.`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL_FOR.factVerification,
      max_tokens: 4000,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any],
      messages: [{ role: 'user', content: searchPrompt }],
    });

    console.log(`[model-router] task=searchAndCollectFacts model=${MODEL_FOR.factVerification} inputTokens=${response.usage.input_tokens} cacheHit=false`);
    return response.content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((block: any) => block.type === 'text' ? block.text : '')
      .filter(Boolean)
      .join('\n\n');
  } catch (err) {
    // Web search tool unavailable — fall back to knowledge-based facts only
    console.warn('[fact-verifier] web_search tool unavailable, falling back to knowledge base:', err);
    const fallback = await anthropic.messages.create({
      model: MODEL_FOR.factVerification,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `List the most important verified facts about: "${keyword}". Include sources where known. Be conservative — only include facts you are highly confident are accurate. Format as a bulleted list with source noted for each.`,
      }],
    });
    return fallback.content[0].type === 'text' ? fallback.content[0].text : '';
  }
}

// ─── CALL 3: FACT EXTRACTION & VERIFICATION ──────────────

export async function extractAndVerifyFacts(
  keyword: string,
  rawSearchResults: string
): Promise<FactExtractionResult> {
  const response = await anthropic.messages.create({
    model: MODEL_FOR.factVerification,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a fact-checker. Below are raw search results for an article about: "${keyword}"

SEARCH RESULTS:
${rawSearchResults}

Extract every specific factual claim and verify it against the sources provided.

Respond ONLY in valid JSON with no markdown or preamble:
{
  "verified_facts": [{"fact":"exact factual claim","source":"source URL or domain","confidence":"confirmed | likely | unverified"}],
  "conflicting_claims": [{"claim":"description of the conflict","source_a":"source 1 says X","source_b":"source 2 says Y","recommendation":"use source A | use source B | omit entirely | note conflict"}],
  "unverifiable_claims": ["List any claims the article might make that could NOT be confirmed from these sources"],
  "safe_to_proceed": true,
  "blocker_reason": "Only populated if safe_to_proceed is false"
}

IMPORTANT: Keep each fact description under 100 characters. Limit verified_facts to maximum 20 items. Limit unverifiable_claims to maximum 10 items. This is critical — the response must be complete valid JSON.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return safeParseJson<FactExtractionResult>(text, 'extractAndVerifyFacts', true);
}

// ─── CALL 5: EDITORIAL AUDIT ──────────────────────────────

export async function editorialAudit(
  generatedArticle: string,
  verifiedFacts: VerifiedFact[],
  unverifiableClaims: string[],
  publishedPages: string[]
): Promise<EditorialAudit> {
  const response = await anthropic.messages.create({
    model: MODEL_FOR.factVerification,
    max_tokens: 6000,
    messages: [{
      role: 'user',
      content: `You are a senior editor performing a pre-publication fact audit.

ARTICLE TO REVIEW:
${generatedArticle}

VERIFIED FACTS (only these are allowed):
${JSON.stringify(verifiedFacts, null, 2)}

CLAIMS TO FLAG AND REMOVE:
${unverifiableClaims.join('\n')}

PUBLISHED PAGES (only these internal links are valid):
${publishedPages.join('\n')}

Perform these checks:
1. FACT AUDIT — Flag every specific factual claim. Is it in the verified facts? If not, mark RED.
2. LINK AUDIT — Check every internal href. Is it in the published pages list? If not, mark as broken.
3. SCHEMA AUDIT — Does the author name in any JSON-LD schema match the author name in the article body?
4. CONSISTENCY — Any contradictions within the article itself?

Respond ONLY in valid JSON with no markdown or preamble. Do NOT return the full article — instead return edits_to_apply (max 10 edits, each find/replace under 100 characters):
{
  "fact_audit": [{"claim":"text of claim","status":"verified | unverified | removed","action":"keep | remove | caveat"}],
  "broken_links": ["list of broken href values"],
  "schema_issues": ["list any issues"],
  "article_clean": true,
  "edits_to_apply": [{"find":"exact text to find in article","replace":"replacement text or empty string to remove"}]
}

IMPORTANT: Limit fact_audit to maximum 15 items. Limit edits_to_apply to maximum 10 items. Each find/replace string must be under 100 characters. The response must be complete valid JSON.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  const audit = safeParseJson<EditorialAudit>(text, 'editorialAudit', true);

  let finalArticle = generatedArticle;
  for (const edit of audit.edits_to_apply || []) {
    if (edit.find && edit.replace !== undefined) {
      const { html, applied } = applyGuardedReplace(finalArticle, edit.find, edit.replace, 'editorial-audit')
      if (applied) finalArticle = html
    }
  }
  return { ...audit, final_article: finalArticle };
}
