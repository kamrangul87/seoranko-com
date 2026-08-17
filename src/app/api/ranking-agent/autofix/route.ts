/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { buildMasterPrompt, validateAndCorrect } from '@/lib/article-master';
import { MODEL_FOR } from '@/lib/model-router';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// Created lazily inside the handler (not at module scope) so the build's page-data
// collection step doesn't crash when env vars aren't present yet.
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export const maxDuration = 300;


// ── STEP A: Fetch top 3 competitor full content ────────────────────────────
async function fetchTopCompetitors(
  keyword: string,
  locationCode: number = 2840 // global/US — see LOCATION_CODES.global in rank-tracker.ts
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

// ── STEP B: Google 2026 ranking factors (hardcoded — avoids extra API call) ─
async function getLatestGoogleUpdates(): Promise<string> {
  return `Google 2026 Key Ranking Factors:
1. EEAT is now the #1 ranking signal — pages must demonstrate Experience, Expertise, Authoritativeness, Trustworthiness through named authors, citations, and firsthand experience signals
2. Helpful Content System — content must be written for humans first, not search engines. Thin, AI-generated content without unique insights is actively demoted
3. Schema markup is a strong ranking signal — Article, FAQ, HowTo, and BreadcrumbList schema all improve rich result eligibility
4. Page Experience signals — Core Web Vitals (LCP under 2.5s, CLS under 0.1, FID under 100ms) are ranking factors
5. Comprehensive topic coverage — pages ranking in top 5 typically cover all subtopics, FAQs, and related questions for the keyword
6. Internal linking — strong internal link structure passes authority and improves crawlability
7. Content freshness — dateModified in schema and regular updates signal active maintenance to Google
8. Official source citations — linking to gov.uk, official bodies, and authoritative sources improves trust signals
9. AI Overview optimisation — concise, factual answers in the first 100 words increase chances of appearing in AI Overviews
10. Mobile-first indexing — Google indexes mobile version first; responsive design and mobile page speed are critical`;
}

// ── Retry helper for Anthropic overloaded_error ────────────────────────────
async function callWithRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 2000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isOverloaded = err?.message?.includes('overloaded') ||
                           err?.status === 529 ||
                           err?.error?.type === 'overloaded_error';
      if (isOverloaded && i < retries - 1) {
        console.log(`[autofix] API overloaded, retrying in ${delayMs * (i + 1)}ms...`);
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
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
    model: MODEL_FOR.scoreImprovement,
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

    // STEP A — Fetch top 3 competitors (fails open to [])
    console.log('[autofix] fetching top 3 competitors for:', article.keyword);
    let competitors: Awaited<ReturnType<typeof fetchTopCompetitors>> = [];
    try {
      competitors = await fetchTopCompetitors(article.keyword, article.location_code || 2840);
    } catch (err) {
      console.error('[autofix] fetchTopCompetitors failed:', err);
    }
    console.log('[autofix] competitors found:', competitors.length);
    await new Promise(r => setTimeout(r, 1000));

    // STEP B — Get latest Google updates (hardcoded — no API call)
    console.log('[autofix] building Google updates context...');
    const googleUpdates = await getLatestGoogleUpdates();
    await new Promise(r => setTimeout(r, 1000));

    // STEP C — Build improvement brief (fails open to a basic brief from agent analysis)
    console.log('[autofix] building improvement brief...');
    let brief: Awaited<ReturnType<typeof buildImprovementBrief>>;
    try {
      brief = await callWithRetry(() => buildImprovementBrief(
        article.keyword,
        article.current_position || 20,
        competitors,
        agentAnalysis,
        googleUpdates
      ));
    } catch (err) {
      console.error('[autofix] buildImprovementBrief failed:', err);
      brief = {
        briefSummary: 'Comprehensive improvement needed',
        missingElements: agentAnalysis?.contentGaps || [],
        contentToAdd: agentAnalysis?.priorityActions || [],
        structureChanges: [],
        seoFixes: [],
      };
    }
    await new Promise(r => setTimeout(r, 2000));

    // STEP D — Build the master prompt with all intelligence injected
    const avgCompetitorWords = competitors.length > 0
      ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length)
      : 1500;

    const competitorHeadings = competitors
      .flatMap(c => c.headings)
      .filter(Boolean)
      .slice(0, 10);

    const internalLinks = '';

    const autoFixPrompt = `${buildMasterPrompt({
      mode: 'improve',
      keyword: article.keyword,
      secondaryKeywords: competitorHeadings,
      entities: [],
      topicalGaps: brief.contentToAdd,
      wordCount: Math.max(avgCompetitorWords + 300, 1500),
      tone: 'professional',
      market: article.market || 'Global',
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
    const stream = anthropic.messages.stream({
      model: MODEL_FOR.articleImprovement,
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
      article.market || 'Global'
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
    return NextResponse.json({ error: error.message || 'Auto-fix failed' }, { status: 500 });
  }
}
