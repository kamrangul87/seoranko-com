/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMasterPrompt, validateAndCorrect, getInternalLinks } from '@/lib/article-master';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });
export const maxDuration = 300;

const FAST_MODEL = 'claude-haiku-4-5-20251001';

const GOOGLE_2026 = `Google 2026 Key Ranking Factors:
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

// ── STEP 1: Fetch target page HTML ────────────────────────────────────────
async function fetchPageHtml(url: string): Promise<{ html: string; text: string; title: string; h1: string; httpStatus: number }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  const httpStatus = res.status;
  if (!res.ok) {
    return { html: '', text: '', title: '', h1: '', httpStatus };
  }
  const html = await res.text();

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
  const h1Raw = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  const h1 = h1Raw.replace(/<[^>]+>/g, '').trim();

  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { html: html.slice(0, 8000), text: text.slice(0, 6000), title, h1, httpStatus };
}

// ── STEP 2: Get low KD keywords via DataForSEO ────────────────────────────
async function getLowKdKeywords(keyword: string, locationCode: number): Promise<{
  primary: string;
  keywords: Array<{ keyword: string; volume: number; kd: number }>;
}> {
  const email = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!email || !password) return { primary: keyword, keywords: [] };

  try {
    const res = await fetch('https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        keyword: keyword.trim().toLowerCase(),
        location_code: locationCode,
        language_code: 'en',
        limit: 30,
        include_seed_keyword: true,
      }]),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items ?? [];

    const keywords = items
      .map((item: any) => ({
        keyword: item.keyword,
        volume: item.keyword_data?.keyword_info?.search_volume ?? 0,
        kd: item.keyword_data?.keyword_difficulty ?? 100,
      }))
      .filter((k: any) => k.volume > 50 && k.kd < 40)
      .sort((a: any, b: any) => a.kd - b.kd)
      .slice(0, 10);

    const primary = keywords[0]?.keyword || keyword;
    return { primary, keywords };
  } catch {
    return { primary: keyword, keywords: [] };
  }
}

// ── STEP 3: Get top 3 competitors from SERP ───────────────────────────────
async function getTopCompetitors(keyword: string, locationCode: number): Promise<Array<{
  url: string;
  content: string;
  wordCount: number;
  hasSchema: boolean;
  hasFaq: boolean;
  headings: string[];
}>> {
  const email = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!email || !password) return [];

  try {
    const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ keyword, location_code: locationCode, language_code: 'en', depth: 10 }]),
      signal: AbortSignal.timeout(15000),
    });
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

        const headingMatches = Array.from(html.matchAll(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi));
        const headings = headingMatches.map(h => h[1].trim()).slice(0, 10);
        const hasSchema = html.includes('application/ld+json');
        const hasFaq = html.toLowerCase().includes('faqpage') || html.toLowerCase().includes('faq');

        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        results.push({ url, content: text.slice(0, 3000), wordCount: text.split(/\s+/).length, hasSchema, hasFaq, headings });
      } catch { /* skip failed */ }
    }
    return results;
  } catch {
    return [];
  }
}

// ── GitHub push helper ────────────────────────────────────────────────────
function extractPageSlug(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/^\//, '').replace(/\/$/, '');
    return pathname || 'index';
  } catch {
    return 'index';
  }
}

function wrapArticleInHtml(article: string, pageUrl: string, title: string, description: string): string {
  const today = new Date().toISOString();
  const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeDesc = description.replace(/"/g, '&quot;').slice(0, 155);
  const safeUrl = pageUrl.replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}">
  <link rel="canonical" href="${safeUrl}">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${title.replace(/"/g, '\\"').slice(0, 110)}",
    "description": "${description.replace(/"/g, '\\"').slice(0, 155)}",
    "url": "${safeUrl}",
    "datePublished": "${today}",
    "dateModified": "${today}"
  }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px 16px; line-height: 1.7; color: #333; }
    h1 { font-size: 2rem; line-height: 1.2; color: #111; margin-bottom: 0.5em; }
    h2 { font-size: 1.4rem; color: #222; margin-top: 2em; border-bottom: 2px solid #f0f0f0; padding-bottom: 0.3em; }
    h3 { font-size: 1.1rem; color: #333; margin-top: 1.5em; }
    p { margin: 1em 0; } ul, ol { margin: 1em 0; padding-left: 1.5em; } li { margin: 0.4em 0; }
    strong { color: #111; }
    @media (max-width: 600px) { h1 { font-size: 1.5rem; } h2 { font-size: 1.2rem; } }
  </style>
</head>
<body>
${article}
</body>
</html>`;
}

async function pushToGithub(
  repo: string,
  token: string,
  branch: string,
  filePath: string,
  content: string,
  message: string
): Promise<{ commitUrl: string; filePath: string } | null> {
  const repoVal = repo.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '');
  const slashIdx = repoVal.indexOf('/');
  const owner = repoVal.slice(0, slashIdx);
  const repoName = repoVal.slice(slashIdx + 1);
  if (!owner || !repoName) return null;

  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
  };

  let sha = '';
  try {
    const getRes = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}?ref=${branch}`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    if (getRes.ok) { const ex = await getRes.json(); sha = ex.sha; }
  } catch { /* new file */ }

  const putBody: any = {
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
  };
  if (sha) putBody.sha = sha;

  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`,
    { method: 'PUT', headers, body: JSON.stringify(putBody), signal: AbortSignal.timeout(12000) }
  );

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    console.error('[site-audit/fix] GitHub push failed:', err.message);
    return null;
  }

  const data = await putRes.json();
  const commitSha: string = data.commit?.sha || '';
  return {
    commitUrl: commitSha
      ? `https://github.com/${owner}/${repoName}/commit/${commitSha}`
      : `https://github.com/${owner}/${repoName}`,
    filePath,
  };
}

// ── Retry helper for Anthropic overloaded_error ────────────────────────────
async function callWithRetry<T>(fn: () => Promise<T>, retries: number = 3, delayMs: number = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isOverloaded = err?.message?.includes('overloaded') ||
                           err?.status === 529 ||
                           err?.error?.type === 'overloaded_error';
      if (isOverloaded && i < retries - 1) {
        console.log(`[site-audit/fix] overloaded, retrying in ${delayMs * (i + 1)}ms...`);
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, market = 'United Kingdom' } = body;
    const keyword: string = body.keyword || body.detectedKeyword || '';
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

    const fallbackTitle: string = body.fallbackTitle || '';
    const fallbackH1: string = body.fallbackH1 || '';
    const fallbackMetaDescription: string = body.fallbackMetaDescription || '';
    const fallbackH2s: string[] = Array.isArray(body.fallbackH2s) ? body.fallbackH2s : [];

    const githubRepo: string = body.githubRepo || '';
    const githubToken: string = body.githubToken || '';
    const githubBranch: string = body.githubBranch || 'main';

    const locationCode = market.toLowerCase().includes('united kingdom') || market.toLowerCase() === 'uk' ? 2826 : 2840;

    // STEP 1 — Fetch target page
    console.log('[site-audit/fix] fetching page:', url);
    let pageData: Awaited<ReturnType<typeof fetchPageHtml>>;
    let is404 = false;

    const buildSyntheticPageData = (httpStatus: number) => {
      const syntheticTitle = fallbackTitle || url;
      const syntheticH1 = fallbackH1 || fallbackTitle || '';
      const textParts = [fallbackH1, fallbackMetaDescription, ...fallbackH2s].filter(Boolean);
      const syntheticText = textParts.length > 0
        ? textParts.join('. ')
        : `Page at ${url} targeting "${keyword}"`;
      const syntheticHtml = [
        `<html><head><title>${syntheticTitle}</title></head><body>`,
        syntheticH1 ? `<h1>${syntheticH1}</h1>` : '',
        fallbackMetaDescription ? `<meta name="description" content="${fallbackMetaDescription}">` : '',
        ...fallbackH2s.map(h2 => `<h2>${h2}</h2>`),
        `</body></html>`,
      ].filter(Boolean).join('\n');
      return { title: syntheticTitle, h1: syntheticH1, text: syntheticText, html: syntheticHtml, httpStatus };
    };

    try {
      pageData = await fetchPageHtml(url);
      if (pageData.httpStatus >= 400) {
        is404 = true;
        console.warn(`[site-audit/fix] page returned HTTP ${pageData.httpStatus}, generating new page from fallback data`);
        pageData = buildSyntheticPageData(pageData.httpStatus);
      }
    } catch (err: any) {
      const hasFallback = fallbackTitle || fallbackH1 || fallbackMetaDescription || fallbackH2s.length > 0;
      if (!hasFallback && !keyword) {
        return NextResponse.json({ error: `Cannot fetch page: ${err.message}` }, { status: 400 });
      }
      console.warn('[site-audit/fix] page fetch network error, using audit fallback data');
      is404 = true;
      pageData = buildSyntheticPageData(0);
    }

    // STEP 2 — Detect keyword and find low KD opportunities
    const seedKeyword = keyword || pageData.h1 || pageData.title || url;
    console.log('[site-audit/fix] getting keywords for:', seedKeyword);
    const kwData = await getLowKdKeywords(seedKeyword, locationCode);
    console.log('[site-audit/fix] primary keyword:', kwData.primary);
    await new Promise(r => setTimeout(r, 1000));

    // STEP 3 — Get top 3 competitors
    console.log('[site-audit/fix] getting competitors for:', kwData.primary);
    const competitors = await getTopCompetitors(kwData.primary, locationCode);
    console.log('[site-audit/fix] competitors found:', competitors.length);
    await new Promise(r => setTimeout(r, 1000));

    // STEP 4 — Build improvement brief (Haiku — fast)
    const competitorSummary = competitors.map((c, i) =>
      `Competitor ${i + 1} (${c.url}):
- Word count: ~${c.wordCount}
- Has schema: ${c.hasSchema} | Has FAQ: ${c.hasFaq}
- H2 headings: ${c.headings.slice(1).join(', ')}
- Content preview: ${c.content.slice(0, 500)}`
    ).join('\n\n');

    const keywordList = kwData.keywords.slice(0, 8).map(k => `${k.keyword} (vol: ${k.volume}, KD: ${k.kd})`).join('\n');

    console.log('[site-audit/fix] building improvement brief...');
    let brief: { briefSummary: string; missingElements: string[]; contentToAdd: string[]; structureChanges: string[]; seoFixes: string[] } | null = null;
    try {
      const briefResp = await callWithRetry(() => anthropic.messages.create({
        model: FAST_MODEL,
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `You are a senior SEO consultant. Analyse this page and create an improvement brief.

PAGE URL: ${url}
PAGE TITLE: ${pageData.title}
PAGE H1: ${pageData.h1}
CURRENT CONTENT (excerpt): ${pageData.text.slice(0, 3000)}

TARGET KEYWORD: ${kwData.primary}
LOW KD KEYWORD OPPORTUNITIES:
${keywordList}

${competitors.length > 0 ? `TOP 3 COMPETITORS:\n${competitorSummary}` : 'No competitor data available.'}

GOOGLE 2026 RANKING FACTORS:
${GOOGLE_2026}

Return ONLY valid JSON:
{
  "briefSummary": "2 sentence strategy summary",
  "missingElements": ["element missing vs competitors"],
  "contentToAdd": ["new H2 section title to add"],
  "structureChanges": ["specific structural change"],
  "seoFixes": ["specific technical SEO fix"]
}`,
        }],
      }));
      const briefText = briefResp.content[0].type === 'text' ? briefResp.content[0].text : '{}';
      const start = briefText.indexOf('{');
      const end = briefText.lastIndexOf('}');
      if (start !== -1 && end !== -1) brief = JSON.parse(briefText.slice(start, end + 1));
    } catch (err) {
      console.error('[site-audit/fix] brief failed:', err);
    }

    if (!brief) {
      brief = {
        briefSummary: `Improve ${url} to rank for "${kwData.primary}" by expanding content and adding structured data.`,
        missingElements: ['Schema markup', 'FAQ section', 'Comprehensive topic coverage'],
        contentToAdd: ['Frequently Asked Questions', 'Expert Tips', 'Key Takeaways'],
        structureChanges: ['Add H2 sections for all major subtopics'],
        seoFixes: ['Add Article schema', 'Add canonical tag', 'Improve meta description'],
      };
    }
    await new Promise(r => setTimeout(r, 2000));

    // STEP 5 — Build master prompt
    const avgCompetitorWords = competitors.length > 0
      ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length)
      : 1500;

    const competitorHeadings = competitors.flatMap(c => c.headings).filter(Boolean).slice(0, 10);
    const internalLinks = getInternalLinks(kwData.primary);

    const fixPrompt = `${buildMasterPrompt({
      mode: 'improve',
      keyword: kwData.primary,
      secondaryKeywords: [
        ...competitorHeadings,
        ...kwData.keywords.slice(0, 5).map(k => k.keyword),
      ],
      entities: [],
      topicalGaps: brief.contentToAdd,
      wordCount: Math.max(avgCompetitorWords + 300, 1500),
      tone: 'professional',
      market,
      internalLinks,
      competitorTopics: brief.missingElements,
      originalArticle: pageData.html || `Page at ${url} targeting "${kwData.primary}"`,
      missingElements: brief.missingElements,
      factualErrors: [],
      improvementPriorities: [...brief.seoFixes, ...brief.structureChanges],
    })}

═══════════════════════════════════════
SITE AUDIT FIX BRIEF
═══════════════════════════════════════
PAGE TO FIX: ${url}
TARGET KEYWORD: ${kwData.primary}
STRATEGY: ${brief.briefSummary}

GOOGLE 2026 REQUIREMENTS (apply all of these):
${GOOGLE_2026}

${competitors.length > 0 ? `TOP ${competitors.length} COMPETITOR ANALYSIS:
${competitors.map((c, i) => `
Competitor ${i + 1}: ${c.url}
- ~${c.wordCount} words (we must exceed this)
- Schema: ${c.hasSchema ? 'YES' : 'No'} | FAQ: ${c.hasFaq ? 'YES' : 'No'}
- Their H2 sections: ${c.headings.slice(1, 6).join(' | ')}`).join('\n')}` : ''}

LOW KD KEYWORDS TO TARGET (weave naturally into content):
${kwData.keywords.slice(0, 8).map(k => `- "${k.keyword}" (vol: ${k.volume}, KD: ${k.kd})`).join('\n')}

MUST ADD TO BEAT COMPETITORS:
${brief.contentToAdd.map((item, i) => `${i + 1}. ${item}`).join('\n')}

STRUCTURE CHANGES REQUIRED:
${brief.structureChanges.join('\n')}

TECHNICAL SEO FIXES REQUIRED:
${brief.seoFixes.join('\n')}

Write the fully improved, humanised article now. Make it rank #1 for "${kwData.primary}".`;

    // STEP 6 — Stream improved article (NOT wrapped — MessageStream is not a Promise)
    console.log('[site-audit/fix] streaming improved article...');
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: fixPrompt }],
    });

    let improvedArticle = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        improvedArticle += chunk.delta.text;
      }
    }

    // STEP 7 — Validate and correct
    const { article: validatedArticle, corrections } = await validateAndCorrect(
      improvedArticle,
      kwData.primary,
      market
    );

    // STEP 8 — Push new HTML page to GitHub for 404 pages
    let commitUrl: string | null = null;
    let githubFilePath: string | null = null;

    if (is404 && githubRepo && githubToken) {
      console.log('[site-audit/fix] pushing new page to GitHub...');
      const slug = extractPageSlug(url);
      const filePath = `public/${slug}/index.html`;
      const metaDesc = brief?.briefSummary?.slice(0, 155) || fallbackMetaDescription || '';
      const htmlPage = wrapArticleInHtml(validatedArticle, url, pageData.title || kwData.primary, metaDesc);
      const pushResult = await pushToGithub(
        githubRepo,
        githubToken,
        githubBranch,
        filePath,
        htmlPage,
        `SEO: create ${filePath} — optimised for "${kwData.primary}" via SEORANKO`
      );
      if (pushResult) {
        commitUrl = pushResult.commitUrl;
        githubFilePath = pushResult.filePath;
        console.log('[site-audit/fix] pushed to GitHub:', filePath);
      }
    }

    return NextResponse.json({
      success: true,
      improvedArticle: validatedArticle,
      keyword: kwData.primary,
      lowKdKeywords: kwData.keywords,
      competitorsAnalysed: competitors.length,
      avgCompetitorWords,
      brief,
      corrections,
      isNewPage: is404,
      commitUrl,
      githubFilePath,
    });

  } catch (error: any) {
    console.error('[site-audit/fix]', error);
    return NextResponse.json({ error: error.message || 'Fix failed' }, { status: 500 });
  }
}
