/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { buildMasterPrompt, validateAndCorrect, getInternalLinks } from '@/lib/article-master';

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

const FAST_MODEL = 'claude-haiku-4-5-20251001';

// ── STEP A: Fetch top 3 competitor full content ────────────────────────────
async function fetchTopCompetitors(
  keyword: string,
  locationCode: number = 2826
): Promise<{ url: string; content: string; wordCount: number; hasSchema: boolean; hasFaq: boolean; headings: string[] }[]> {
  const email = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!email || !password) return [];

  try {
    const response = await fetch(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{ keyword, location_code: locationCode, language_code: 'en', depth: 10 }]),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await response.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items ?? [];
    const topUrls = items
      .filter((i: any) => i.type === 'organic')
      .slice(0, 3)
      .map((i: any) => i.url)
      .filter((url: string) => !['youtube.com', 'reddit.com', 'amazon.com'].some(b => url.includes(b)));

    const results = [];
    for (const url of topUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
        });
        const html = await res.text();

        const headingMatches = html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi) || [];
        const headings = headingMatches.map(h => h.replace(/<[^>]+>/g, '').trim()).slice(0, 10);

        const hasSchema = html.includes('application/ld+json');
        const hasFaq = html.toLowerCase().includes('faqpage') || html.toLowerCase().includes('faq');

        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const wordCount = text.split(/\s+/).length;
        const content = text.slice(0, 3000);

        results.push({ url, content, wordCount, hasSchema, hasFaq, headings });
      } catch { /* skip failed */ }
    }
    return results;
  } catch {
    return [];
  }
}

// ── STEP B: Get latest Google algorithm updates via live search ────────────
async function getLatestGoogleUpdates(): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 500,
      tools: [{ type: 'web_search_20250305', name: 'web_search' } as any],
      messages: [{
        role: 'user',
        content: `Search for: "Google algorithm update 2026 ranking factors SEO"

Return a brief list of the most important Google ranking signals and updates from 2025-2026 that affect article rankings. Focus on:
- EEAT requirements
- Helpful Content signals
- AI content policies
- Core Web Vitals
- Any recent algorithm updates

Return as a brief paragraph only — 100 words max.`
      }]
    });

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join(' ')
      .slice(0, 500);

    return text || 'Google 2026 priorities: EEAT signals, helpful content, original research, fast page speed, schema markup, comprehensive topic coverage, human expert authorship.';
  } catch {
    return 'Google 2026 priorities: EEAT signals, helpful content, original research, fast page speed, schema markup, comprehensive topic coverage, human expert authorship.';
  }
}

// ── STEP C: Build intelligent improvement brief ────────────────────────────
async function buildImprovementBrief(
  keyword: string,
  currentPosition: number,
  competitors: Awaited<ReturnType<typeof fetchTopCompetitors>>,
  agentAnalysis: any,
  googleUpdates: string
): Promise<{
  briefSummary: string;
  missingElements: string[];
  contentToAdd: string[];
  structureChanges: string[];
  seoFixes: string[];
}> {
  const competitorSummary = competitors.map((c, i) =>
    `Competitor ${i + 1} (${c.url}):
    - Word count: ~${c.wordCount}
    - Has schema: ${c.hasSchema}
    - Has FAQ: ${c.hasFaq}
    - H2 headings: ${c.headings.slice(1).join(', ')}
    - Content preview: ${c.content.slice(0, 500)}`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are a 25-year SEO veteran. An article ranking #${currentPosition} for "${keyword}" needs to reach top 5.

LATEST GOOGLE UPDATES:
${googleUpdates}

TOP 3 COMPETITOR ANALYSIS:
${competitorSummary}

RANKING AGENT DIAGNOSIS:
${agentAnalysis?.diagnosis || 'Position needs improvement'}

PRIORITY ACTIONS FROM AGENT:
${(agentAnalysis?.priorityActions || []).join('\n')}

CONTENT GAPS IDENTIFIED:
${(agentAnalysis?.contentGaps || []).join('\n')}

Create a precise improvement brief. Return ONLY valid JSON:
{
  "briefSummary": "2 sentence summary of the improvement strategy",
  "missingElements": ["specific element missing vs top 3 competitors"],
  "contentToAdd": ["specific new section or content block to add with exact H2 title"],
  "structureChanges": ["specific structural change needed"],
  "seoFixes": ["specific technical SEO fix needed"]
}`
    }]
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return {
      briefSummary: 'Comprehensive improvement needed',
      missingElements: agentAnalysis?.contentGaps || [],
      contentToAdd: [],
      structureChanges: [],
      seoFixes: [],
    };
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { articleId, currentArticleHtml = '' } = body;
    const supabase = getSupabase();

    if (!articleId) {
      return NextResponse.json({ error: 'articleId required' }, { status: 400 });
    }

    // Get article data
    const { data: article } = await supabase
      .from('tracked_articles')
      .select('*, agent_logs(*)')
      .eq('id', articleId)
      .single();

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    // Get latest analysis from agent_logs
    const analysisLog = [...(article.agent_logs || [])]
      .reverse()
      .find((log: any) => log.action === 'DEEP_ANALYSIS');

    let agentAnalysis = null;
    if (analysisLog?.result) {
      try {
        agentAnalysis = JSON.parse(analysisLog.result.replace(/```json|```/g, '').trim());
      } catch { /* use null */ }
    }

    // STEP A — Fetch top 3 competitors
    console.log('[autofix] fetching top 3 competitors for:', article.keyword);
    const competitors = await fetchTopCompetitors(article.keyword, article.location_code || 2826);
    console.log('[autofix] competitors found:', competitors.length);

    // STEP B — Get latest Google updates
    console.log('[autofix] fetching Google updates...');
    const googleUpdates = await getLatestGoogleUpdates();

    // STEP C — Build improvement brief
    console.log('[autofix] building improvement brief...');
    const brief = await buildImprovementBrief(
      article.keyword,
      article.current_position || 20,
      competitors,
      agentAnalysis,
      googleUpdates
    );

    // STEP D — Build the master prompt with all intelligence injected
    const avgCompetitorWords = competitors.length > 0
      ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length)
      : 1500;

    const competitorHeadings = competitors
      .flatMap(c => c.headings)
      .filter(Boolean)
      .slice(0, 10);

    const internalLinks = getInternalLinks(article.keyword);

    const autoFixPrompt = `${buildMasterPrompt({
      mode: 'improve',
      keyword: article.keyword,
      secondaryKeywords: competitorHeadings,
      entities: [],
      topicalGaps: brief.contentToAdd,
      wordCount: Math.max(avgCompetitorWords + 300, 1500),
      tone: 'professional',
      market: article.market || 'United Kingdom',
      internalLinks,
      competitorTopics: brief.missingElements,
      originalArticle: currentArticleHtml || `Article at ${article.url} targeting "${article.keyword}" currently at position #${article.current_position}`,
      missingElements: brief.missingElements,
      factualErrors: [],
      improvementPriorities: [
        ...brief.seoFixes,
        ...brief.structureChanges,
        ...(agentAnalysis?.priorityActions || []),
      ],
    })}

═══════════════════════════════════════
AUTOFIX INTELLIGENCE BRIEF
═══════════════════════════════════════
STRATEGY: ${brief.briefSummary}

LATEST GOOGLE 2026 REQUIREMENTS (apply these):
${googleUpdates}

TOP 3 COMPETITOR ANALYSIS:
${competitors.map((c, i) => `
Competitor ${i + 1}: ${c.url}
- ~${c.wordCount} words (we must exceed this)
- Schema markup: ${c.hasSchema ? 'YES — we must have this too' : 'No'}
- FAQ section: ${c.hasFaq ? 'YES — we must have this too' : 'No'}
- Their H2 sections: ${c.headings.slice(1, 6).join(' | ')}
`).join('\n')}

WHAT TO ADD (not optional — these are required to beat competitors):
${brief.contentToAdd.map((item, i) => `${i + 1}. ${item}`).join('\n')}

STRUCTURE CHANGES REQUIRED:
${brief.structureChanges.join('\n')}

TECHNICAL SEO FIXES REQUIRED:
${brief.seoFixes.join('\n')}

TARGET: This rewritten article must be able to rank in TOP 5 for "${article.keyword}".
Write it as if your career depends on it. Be comprehensive, accurate, and authoritative.`;

    // STEP E — Stream the improved article
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: autoFixPrompt }],
    });

    let improvedArticle = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        improvedArticle += chunk.delta.text;
      }
    }

    // STEP F — Validate and correct
    const { article: validatedArticle, corrections } = await validateAndCorrect(
      improvedArticle,
      article.keyword,
      article.market || 'United Kingdom'
    );

    // STEP G — Log the autofix action
    await supabase.from('agent_logs').insert({
      article_id: articleId,
      action: 'AUTOFIX_APPLIED',
      reason: `Auto-fix applied: analysed ${competitors.length} competitors, applied Google 2026 updates, rewrote article to target top 5`,
      result: JSON.stringify({
        competitorsAnalysed: competitors.length,
        avgCompetitorWords,
        brief: brief.briefSummary,
        corrections,
      }),
      position_before: article.current_position,
      position_after: null,
    });

    return NextResponse.json({
      success: true,
      improvedArticle: validatedArticle,
      brief,
      competitorsAnalysed: competitors.length,
      avgCompetitorWords,
      googleUpdatesApplied: true,
      corrections,
    });

  } catch (error: any) {
    console.error('[autofix]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
