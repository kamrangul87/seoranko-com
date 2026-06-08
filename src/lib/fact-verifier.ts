// src/lib/fact-verifier.ts
// SEORANKO Fact Verification Module — Pipeline v2

import Anthropic from '@anthropic-ai/sdk';

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
  final_article: string;
}

function safeParseJson<T>(text: string): T {
  const cleaned = text.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  try { return JSON.parse(cleaned) as T; } catch { /* continue */ }
  const arr = cleaned.match(/\[[\s\S]*\]/);
  if (arr) try { return JSON.parse(arr[0]) as T; } catch { /* continue */ }
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) try { return JSON.parse(obj[0]) as T; } catch { /* continue */ }
  throw new Error(`JSON parse failed. First 200 chars: ${text.slice(0, 200)}`);
}

// ─── CALL 1: TOPIC CLASSIFICATION ────────────────────────

export async function classifyTopic(keyword: string): Promise<TopicClassification> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
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
  return safeParseJson<TopicClassification>(text);
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
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any],
      messages: [{ role: 'user', content: searchPrompt }],
    });

    return response.content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((block: any) => block.type === 'text' ? block.text : '')
      .filter(Boolean)
      .join('\n\n');
  } catch (err) {
    // Web search tool unavailable — fall back to knowledge-based facts only
    console.warn('[fact-verifier] web_search tool unavailable, falling back to knowledge base:', err);
    const fallback = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
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
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
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
}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return safeParseJson<FactExtractionResult>(text);
}

// ─── CALL 5: EDITORIAL AUDIT ──────────────────────────────

export async function editorialAudit(
  generatedArticle: string,
  verifiedFacts: VerifiedFact[],
  unverifiableClaims: string[],
  publishedPages: string[]
): Promise<EditorialAudit> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
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

Respond ONLY in valid JSON with no markdown or preamble. The final_article field must contain the corrected full article markdown with unverified facts removed and broken links removed:
{
  "fact_audit": [{"claim":"text of claim","status":"verified | unverified | removed","action":"keep | remove | caveat"}],
  "broken_links": ["list of broken href values"],
  "schema_issues": ["list any issues"],
  "article_clean": true,
  "final_article": "The corrected full article markdown"
}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  return safeParseJson<EditorialAudit>(text);
}
