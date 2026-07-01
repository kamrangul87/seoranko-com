/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared AI citation testing utility.
 * Asks Claude (with live web search) whether a brand/domain is mentioned
 * or cited when AI responds to a customer-style query on a given topic.
 * Used by: site-audit, keywords, article-competitor, ranking-agent.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { MODEL_FOR } from './model-router';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });

export type CitationSource =
  | 'site_audit'
  | 'keyword_research'
  | 'article_v2'
  | 'article_improve'
  | 'article_competitor'
  | 'ranking_agent';

export interface CitationResult {
  topic: string;
  mentioned: boolean;
  cited: boolean;
  competitorsCited: string[];
  responseSnippet: string;
}

export interface CitationOpportunity {
  keyword: string;
  hasStrongCompetition: boolean;
  dominantCompetitors: string[];
  opportunityScore: number; // 0-100: higher = easier to win AI citations
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

/**
 * Test whether a brand is mentioned/cited by AI for a topic query.
 * Persists result to ai_citation_tests (non-blocking).
 */
export async function testAICitation(params: {
  brandName: string;
  domain: string;
  topic: string;
  source?: CitationSource;
}): Promise<CitationResult> {
  const { brandName, domain, topic, source = 'site_audit' } = params;

  try {
    const res = await anthropic.messages.create({
      model: MODEL_FOR.citationTesting,
      max_tokens: 500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 } as any],
      messages: [{
        role: 'user',
        content: `${topic} — which specific tools, platforms or companies do experts recommend?`,
      }],
    });

    console.log(`[model-router] task=citationTesting model=${MODEL_FOR.citationTesting} inputTokens=${res.usage.input_tokens} cacheHit=false`);
    const textBlocks = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text);
    const fullText = textBlocks.join('\n');
    const textLower = fullText.toLowerCase();
    const brandLower = brandName.toLowerCase();
    const domainLower = domain.toLowerCase().replace(/^www\./, '');

    const mentioned = textLower.includes(brandLower) || textLower.includes(domainLower);
    const urlRegex = new RegExp(domainLower.replace(/\./g, '\\.'), 'i');
    const cited = urlRegex.test(fullText) ||
      (mentioned && (fullText.includes(`[${brandName}`) || fullText.includes(`"${brandName}"`)));

    // Extract competitor names that appear near recommendation verbs
    const compMatches = fullText.match(
      /\b([A-Z][a-zA-Z0-9]{2,20}(?:\s[A-Z][a-zA-Z0-9]{2,15})?)\b(?=\s+is\b|\s+offers\b|\s+provides\b|\s+lets\b|\s+helps\b|\s+allows\b)/g
    ) || [];
    const competitorsCited = Array.from(new Set(
      compMatches
        .map((s: string) => s.trim())
        .filter((s: string) => {
          const sl = s.toLowerCase();
          return sl !== brandLower && !domainLower.includes(sl) && s.length > 2 && s.length < 40;
        })
    )).slice(0, 5);

    const result: CitationResult = {
      topic,
      mentioned,
      cited,
      competitorsCited,
      responseSnippet: fullText.slice(0, 300).trim(),
    };

    // Persist (fire-and-forget)
    void Promise.resolve(getSupabase().from('ai_citation_tests').insert({
      domain: domainLower,
      topic,
      mentioned,
      cited,
      competitors_cited: competitorsCited,
      source,
      tested_at: new Date().toISOString(),
    })).catch(() => {});

    return result;
  } catch (err) {
    console.error('[citation-tester] testAICitation error:', err);
    return { topic, mentioned: false, cited: false, competitorsCited: [], responseSnippet: '' };
  }
}

/**
 * Check the citation landscape for a keyword — used by the keywords route.
 * Returns which competitors are already being cited and how saturated the space is.
 * A high opportunityScore means few competitors are cited → easier to win.
 */
export async function checkCitationOpportunity(keyword: string): Promise<CitationOpportunity> {
  try {
    const res = await anthropic.messages.create({
      model: MODEL_FOR.citationTesting,
      max_tokens: 400,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 } as any],
      messages: [{
        role: 'user',
        content: `${keyword} — which specific tools, platforms, or companies do you recommend? List them by name.`,
      }],
    });

    console.log(`[model-router] task=citationOpportunity model=${MODEL_FOR.citationTesting} inputTokens=${res.usage.input_tokens} cacheHit=false`);
    const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');

    // Extract named entities that look like company/product names
    const matches = text.match(/\b[A-Z][a-zA-Z0-9]{2,25}(?:\s[A-Z][a-zA-Z0-9]{2,20})?\b/g) || [];
    const dominantCompetitors = Array.from(new Set(
      matches
        .filter((m: string) => m.length > 3 && m.length < 35)
        .slice(0, 8)
    ));

    // Opportunity score: fewer competitors named = more opportunity
    const hasStrongCompetition = dominantCompetitors.length >= 4;
    const opportunityScore = Math.max(0, Math.min(100, 100 - dominantCompetitors.length * 12));

    return { keyword, hasStrongCompetition, dominantCompetitors, opportunityScore };
  } catch {
    // On error, assume medium opportunity (neutral)
    return { keyword, hasStrongCompetition: false, dominantCompetitors: [], opportunityScore: 50 };
  }
}

/**
 * Queue a deferred citation test to run N days from now.
 * Stored in scheduled_citation_tests — a separate background job would execute these.
 */
export async function queueCitationTest(params: {
  domain: string;
  topic: string;
  daysFromNow?: number;
  source?: CitationSource;
}): Promise<void> {
  const { domain, topic, daysFromNow = 7, source = 'article_v2' } = params;
  const runAt = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  void Promise.resolve(getSupabase().from('scheduled_citation_tests').insert({
    domain,
    topic,
    run_at: runAt,
    completed: false,
    source,
  })).catch(() => {});
}

/**
 * Load the most recent citation test result for a domain (and optional topic).
 */
export async function getLatestCitationResult(
  domain: string,
  topic?: string,
): Promise<CitationResult | null> {
  const supabase = getSupabase();
  const q = supabase
    .from('ai_citation_tests')
    .select('topic, mentioned, cited, competitors_cited, tested_at')
    .eq('domain', domain.toLowerCase().replace(/^www\./, ''))
    .order('tested_at', { ascending: false })
    .limit(1);

  const { data } = topic
    ? await q.ilike('topic', `%${topic.toLowerCase()}%`)
    : await q;

  if (!data?.[0]) return null;
  const row = data[0];
  return {
    topic: row.topic,
    mentioned: row.mentioned,
    cited: row.cited,
    competitorsCited: row.competitors_cited ?? [],
    responseSnippet: '',
  };
}
