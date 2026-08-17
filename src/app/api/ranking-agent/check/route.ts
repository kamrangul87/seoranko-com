import { NextRequest, NextResponse } from 'next/server';
import { checkKeywordRank as sharedCheckKeywordRank } from '@/lib/rank-tracker';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { getLatestCitationResult } from '@/lib/citation-tester';
import { recordScoreSnapshot } from '@/lib/drift-tracker';

import { MODEL_FOR } from '@/lib/model-router';
import { getAnthropicClient } from '@/lib/anthropic'

const anthropic = getAnthropicClient({ maxRetries: 5 });

// Created lazily inside the handler (not at module scope) so the build's page-data
// collection step doesn't crash when env vars aren't present yet.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export const maxDuration = 60;

// ── Check current rank for a keyword ──────────────────────────────────────────
// §10 items 3+4 — this route had its OWN copy of checkKeywordRank that sent a
// different request (live/advanced, location 2826, depth 50, no device) and
// matched with a BIDIRECTIONAL substring test:
//     itemDomain.includes(targetDomain) || targetDomain.includes(itemDomain)
// so "autodun.com" would match a site called "dun.com". It also kept the LAST
// match in the loop rather than the best. Two request shapes for one keyword is
// exactly the locale/engine divergence item 3 tells us to eliminate, so this now
// delegates to the single shared implementation.
async function checkKeywordRank(
  keyword: string,
  targetUrl: string,
  locationCode: number = 2840 // global/US — see LOCATION_CODES.global in rank-tracker.ts
): Promise<{ position: number | null; competitorUrls: string[] }> {
  const result = await sharedCheckKeywordRank(keyword, targetUrl, locationCode);
  return { position: result.position, competitorUrls: result.competitorUrls };
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
      model: MODEL_FOR.keywordClassification,
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

  const hasCompetitorContent = competitorContents.filter(c => c.length > 100).length > 0;

  const response = await anthropic.messages.create({
    model: MODEL_FOR.competitorAnalysis,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are a senior SEO strategist with 25 years of experience.
You have ranked thousands of articles to page one on Google.

SITUATION:
- Keyword: "${keyword}"
- Current position: #${currentPosition}
- Target: Top 5
- Article URL: ${articleUrl}
- Competitor URLs ranking above: ${competitorUrls.slice(0, 3).join(', ')}
${hasCompetitorContent ? `\nCOMPETITOR CONTENT ANALYSED:\n${competitorContents.slice(0, 2).join('\n---\n').slice(0, 3000)}` : '\nNote: Competitor content could not be scraped — provide analysis based on keyword and position data.'}

As a 25-year SEO veteran, provide your expert diagnosis and action plan.

Return ONLY this exact JSON structure, no markdown:
{
  "diagnosis": "2-3 sentence expert diagnosis of why this article is at position #${currentPosition} and not top 5",
  "topCompetitorInsights": [
    "What the #1 ranking article almost certainly does better",
    "What the #2-3 ranking articles do that creates an advantage",
    "A technical or structural advantage competitors likely have"
  ],
  "contentGaps": [
    "Specific missing topic or section that top 5 articles cover",
    "Missing data, statistics, or official citations",
    "Missing FAQ questions that People Also Ask shows",
    "Missing comparison table, price table, or structured data"
  ],
  "serpFeatures": [
    "Featured Snippet opportunity: how to win it for this keyword",
    "People Also Ask opportunity: which questions to answer"
  ],
  "priorityActions": [
    "1. [IMPACT: HIGH] Add a dedicated section titled [specific H2] covering [specific topic] — this alone could move 5-8 positions",
    "2. [IMPACT: HIGH] Add [specific schema type] schema markup — competitors ranking above likely have this",
    "3. [IMPACT: MEDIUM] Increase word count by [specific number] words covering [specific topics]",
    "4. [IMPACT: MEDIUM] Add [specific number] internal links from [specific existing pages] using [specific anchor text]",
    "5. [IMPACT: LOW] Update the title tag to include [specific keyword variation] — improves CTR from position #${currentPosition}"
  ],
  "estimatedPositionsToGain": ${Math.min(currentPosition - 1, 15)}
}`
    }]
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return {
      diagnosis: text.slice(0, 500) || 'Analysis unavailable',
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
        article.location_code || 2840
      );

      const previousPosition = article.current_position;
      // §10 item 10 / §6.4: negative Δposition = good (current − previous).
      const positionChange = previousPosition && position
        ? position - previousPosition
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

      // Pull latest citation test for this article's domain+keyword (non-blocking)
      const articleDomain = article.url
        .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const citationResult = await getLatestCitationResult(articleDomain, article.keyword)
        .catch(() => null);

      // Record a score snapshot for drift tracking
      if (position != null) {
        recordScoreSnapshot({
          domain: articleDomain,
          page_url: article.url,
          score: position != null ? Math.max(0, 100 - position * 2) : 0, // convert rank to score
          source: 'ranking_agent',
        }).catch(() => {});
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
        citationResult,
      });
    }

    return NextResponse.json({ success: true, results });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[ranking-agent/check]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
