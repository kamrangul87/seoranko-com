import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// Created lazily inside the handler (not at module scope) so the build's page-data
// collection step doesn't crash when env vars aren't present yet.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export const maxDuration = 60;

// Drop analysis runs on Haiku — simple summarisation, separate rate-limit bucket.
const FAST_MODEL = 'claude-haiku-4-5-20251001';

// ── Check current rank for a keyword ──────────────────────────────────────────
async function checkKeywordRank(
  keyword: string,
  targetUrl: string,
  locationCode: number = 2826
): Promise<{ position: number | null; competitorUrls: string[] }> {
  const login = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { position: null, competitorUrls: [] };

  try {
    const response = await fetch(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          keyword,
          location_code: locationCode,
          language_code: 'en',
          depth: 50,
        }]),
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const competitorUrls: string[] = [];
    let position: number | null = null;

    const targetDomain = targetUrl
      .replace('https://', '')
      .replace('http://', '')
      .replace('www.', '')
      .split('/')[0];

    console.log('[rank-check] keyword:', keyword, 'target:', targetUrl, 'targetDomain:', targetDomain);
    console.log('[rank-check] total items found:', items.length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log('[rank-check] organic items:', items.filter((i: any) => i.type === 'organic').length);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of items as any[]) {
      if (item.type !== 'organic') continue;

      const itemUrl = item.url || '';
      const itemDomain = item.domain?.replace('www.', '') || '';

      // Check if target domain appears anywhere in the URL
      if (
        itemDomain.includes(targetDomain) ||
        targetDomain.includes(itemDomain) ||
        itemUrl.includes(targetDomain)
      ) {
        position = item.rank_absolute;
        console.log('[rank-check] found at position:', position, 'url:', itemUrl);
      } else if (item.url) {
        competitorUrls.push(item.url);
      }
    }

    return { position, competitorUrls: competitorUrls.slice(0, 4) };
  } catch (err) {
    console.error('[rank-check] error:', err);
    return { position: null, competitorUrls: [] };
  }
}

// ── Analyse rank drop with Claude ─────────────────────────────────────────────
async function analyseRankDrop(
  keyword: string,
  previousPosition: number,
  currentPosition: number,
  competitorUrls: string[]
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `An article ranking for "${keyword}" dropped from position ${previousPosition} to ${currentPosition}.

Top competitors now ranking above it: ${competitorUrls.slice(0, 3).join(', ')}

In 2-3 sentences, what is the most likely cause and what single action would most likely recover the ranking? Be specific and actionable.`
      }]
    });
    return response.content[0].type === 'text' ? response.content[0].text : 'Analysis unavailable';
  } catch {
    return 'Analysis unavailable';
  }
}

// ── Deep competitor analysis — 25yr SEO veteran diagnosis ─────────────────────
async function deepCompetitorAnalysis(
  keyword: string,
  currentPosition: number,
  competitorUrls: string[],
  articleUrl: string
): Promise<{
  diagnosis: string;
  topCompetitorInsights: string[];
  contentGaps: string[];
  serpFeatures: string[];
  priorityActions: string[];
  estimatedPositionsToGain: number;
}> {
  // Fetch top 3 competitor pages
  const competitorContents: string[] = [];
  for (const url of competitorUrls.slice(0, 3)) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(5000),
      });
      const html = await res.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000);
      competitorContents.push(`URL: ${url}\n${text}`);
    } catch { /* skip */ }
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are a senior SEO strategist with 25 years of experience. You have worked with Fortune 500 companies and ranked thousands of articles to page one.

CURRENT SITUATION:
- Keyword: "${keyword}"
- Current position: #${currentPosition}
- Target: Top 5
- Article URL: ${articleUrl}

TOP COMPETITOR CONTENT (currently ranking above us):
${competitorContents.join('\n\n---\n\n')}

Analyse this situation like a 25-year SEO veteran and provide:

1. DIAGNOSIS: What is the single most likely reason this article is at position #${currentPosition} instead of top 5?

2. COMPETITOR INSIGHTS: What are the top 3 things the ranking competitors are doing that our article likely isn't?

3. CONTENT GAPS: What specific topics/sections are missing from our article that the top 5 all cover?

4. SERP FEATURES: What SERP features (Featured Snippet, PAA, AI Overview) exist for this keyword and how can we win them?

5. PRIORITY ACTIONS: List exactly 5 specific actions ranked by impact that would move this article from #${currentPosition} to top 5. Be brutally specific — not "improve content" but "Add an H2 section titled X covering Y with Z words".

6. ESTIMATED GAIN: How many positions could we realistically gain in 30 days if we implement all 5 actions?

Return ONLY valid JSON:
{
  "diagnosis": "one paragraph diagnosis",
  "topCompetitorInsights": ["insight 1", "insight 2", "insight 3"],
  "contentGaps": ["specific gap 1", "specific gap 2", "specific gap 3", "specific gap 4"],
  "serpFeatures": ["feature opportunity 1", "feature opportunity 2"],
  "priorityActions": [
    "1. [IMPACT: HIGH] Specific action with exact details",
    "2. [IMPACT: HIGH] Specific action with exact details",
    "3. [IMPACT: MEDIUM] Specific action with exact details",
    "4. [IMPACT: MEDIUM] Specific action with exact details",
    "5. [IMPACT: LOW] Specific action with exact details"
  ],
  "estimatedPositionsToGain": number
}`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    try {
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return {
        diagnosis: 'Analysis unavailable',
        topCompetitorInsights: [],
        contentGaps: [],
        serpFeatures: [],
        priorityActions: [],
        estimatedPositionsToGain: 0,
      };
    }
  } catch {
    return {
      diagnosis: 'Analysis unavailable',
      topCompetitorInsights: [],
      contentGaps: [],
      serpFeatures: [],
      priorityActions: [],
      estimatedPositionsToGain: 0,
    };
  }
}

// ── Calculate freshness score ─────────────────────────────────────────────────
function calculateFreshnessScore(
  currentPosition: number | null,
  previousPosition: number | null,
  lastChecked: string | null
): number {
  let score = 100;

  if (currentPosition === null) return 50;
  if (currentPosition > 50) score -= 30;
  else if (currentPosition > 20) score -= 15;
  else if (currentPosition > 10) score -= 5;

  if (previousPosition && currentPosition > previousPosition) {
    const drop = currentPosition - previousPosition;
    score -= Math.min(drop * 3, 30);
  }

  if (lastChecked) {
    const daysSinceCheck = (Date.now() - new Date(lastChecked).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCheck > 7) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { articleId, runAll = false } = body;
    const supabase = getSupabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let articles: any[] = [];

    if (runAll) {
      const { data } = await supabase
        .from('tracked_articles')
        .select('*')
        .eq('status', 'active');
      articles = data || [];
    } else if (articleId) {
      const { data } = await supabase
        .from('tracked_articles')
        .select('*')
        .eq('id', articleId)
        .single();
      if (data) articles = [data];
    }

    if (articles.length === 0) {
      return NextResponse.json({ message: 'No articles to check' });
    }

    const results = [];

    for (const article of articles) {
      const { position, competitorUrls } = await checkKeywordRank(
        article.keyword,
        article.url,
        article.location_code || 2826
      );

      const previousPosition = article.current_position;
      const positionChange = previousPosition && position
        ? previousPosition - position
        : 0;

      const freshnessScore = calculateFreshnessScore(
        position,
        previousPosition,
        article.last_checked
      );

      // Update tracked_articles
      await supabase
        .from('tracked_articles')
        .update({
          previous_position: previousPosition,
          current_position: position,
          position_change: positionChange,
          last_checked: new Date().toISOString(),
          freshness_score: freshnessScore,
          updated_at: new Date().toISOString(),
        })
        .eq('id', article.id);

      // Save to rank_history
      await supabase.from('rank_history').insert({
        article_id: article.id,
        position,
        keyword: article.keyword,
        url: article.url,
        competitor_urls: competitorUrls,
        checked_at: new Date().toISOString(),
      });

      // Analyse drop and log if ranking dropped
      let analysis = '';
      if (previousPosition && position && position > previousPosition + 2) {
        analysis = await analyseRankDrop(
          article.keyword,
          previousPosition,
          position,
          competitorUrls
        );

        await supabase.from('agent_logs').insert({
          article_id: article.id,
          action: 'RANK_DROP_DETECTED',
          reason: `Position dropped from ${previousPosition} to ${position}`,
          result: analysis,
          position_before: previousPosition,
          position_after: position,
        });
      } else if (previousPosition && position && position < previousPosition) {
        await supabase.from('agent_logs').insert({
          article_id: article.id,
          action: 'RANK_IMPROVED',
          reason: `Position improved from ${previousPosition} to ${position}`,
          result: `Ranking improved by ${previousPosition - position} positions`,
          position_before: previousPosition,
          position_after: position,
        });
      }

      let deepAnalysis = null;
      if (position && position > 5) {
        deepAnalysis = await deepCompetitorAnalysis(
          article.keyword,
          position,
          competitorUrls,
          article.url
        );

        // Save to agent_logs
        await supabase.from('agent_logs').insert({
          article_id: article.id,
          action: 'DEEP_ANALYSIS',
          reason: `Position #${position} — full competitor analysis completed`,
          result: JSON.stringify(deepAnalysis),
          position_before: position,
          position_after: position,
        });
      }

      results.push({
        id: article.id,
        keyword: article.keyword,
        url: article.url,
        previousPosition,
        currentPosition: position,
        positionChange,
        freshnessScore,
        analysis,
        competitorUrls,
        deepAnalysis,
      });
    }

    return NextResponse.json({ success: true, results });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[ranking-agent/check]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
