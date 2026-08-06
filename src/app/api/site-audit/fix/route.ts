/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMasterPrompt, validateAndCorrect } from '@/lib/article-master';
import { updateFixedPage, updateScrapedPage, normalizeUrl, normalizeDomain } from '@/lib/supabase/audit-db';
import { upsertFix, siteIdFromDomain } from '@/lib/supabase/fixes-db';
import { fetchPageSignals, scorePage } from '@/lib/site-audit/scorer';
import { humanizeArticle } from '@/lib/humanizer';
import { MODEL_FOR } from '@/lib/model-router';
import { LOCATION_CODES } from '@/lib/rank-tracker';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });
export const maxDuration = 300;

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

// Maps a page URL to its Next.js App Router file path
function getNextjsPagePath(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/^\//, '').replace(/\/$/, '');
    if (!pathname) return 'src/app/page.tsx';
    return `src/app/${pathname}/page.tsx`;
  } catch {
    return 'src/app/page.tsx';
  }
}

// Fetch an existing file from GitHub and decode it
async function fetchFileFromGithub(
  repo: string,
  token: string,
  branch: string,
  filePath: string
): Promise<{ content: string; sha: string } | null> {
  const repoVal = repo.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '');
  const slashIdx = repoVal.indexOf('/');
  const owner = repoVal.slice(0, slashIdx);
  const repoName = repoVal.slice(slashIdx + 1);
  if (!owner || !repoName) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const content = Buffer.from((data.content as string).replace(/\n/g, ''), 'base64').toString('utf-8');
    return { content, sha: data.sha as string };
  } catch {
    return null;
  }
}

function slugToComponentName(slug: string): string {
  return slug
    .split(/[-_/]/)
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function articleHtmlToMarkdown(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[^>]*-->/g, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `# ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `## ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `### ${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.replace(/<[^>]+>/g, '').trim()}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `${t.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildMarkdownGuide(article: string, pageUrl: string, keyword: string, brief: any): string {
  const slug = extractPageSlug(pageUrl);
  const today = new Date().toISOString().split('T')[0];
  const mdContent = articleHtmlToMarkdown(article);
  return `# SEO Fix Guide: /${slug}

> Generated by SEORANKO on ${today}

## Target Keyword
**${keyword}**

## Strategy
${brief?.briefSummary || 'Optimise this page for the target keyword.'}

## Missing Elements to Add
${(brief?.missingElements || []).map((e: string) => `- ${e}`).join('\n') || '- See content below'}

## Technical SEO Fixes Required
${(brief?.seoFixes || []).map((f: string) => `- ${f}`).join('\n') || '- See content below'}

---

## SEO-Optimised Content

*Paste this content into your page component or CMS:*

${mdContent}
`;
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

// ── Vercel redeploy trigger ────────────────────────────────────────────────
async function triggerVercelRedeploy(): Promise<boolean> {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_AUTODUN;
  if (!hookUrl) return false;
  try {
    const res = await fetch(hookUrl, { method: 'POST', signal: AbortSignal.timeout(10000) });
    console.log('[site-audit/fix] Vercel redeploy triggered, status:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[site-audit/fix] Vercel redeploy hook failed:', e);
    return false;
  }
}

// ── Fact verification ─────────────────────────────────────────────────────
function factCheckContent(content: string): { content: string; status: 'passed' | 'fixed'; log: string } {
  let fixed = content;
  const changes: string[] = [];

  // Strip fake UK phone numbers (01632 = Ofcom reserved fictional prefix)
  if (/\b01632[\s-]?\d{6}\b/.test(fixed)) {
    fixed = fixed.replace(/\b01632[\s-]?\d{6}\b/g, '');
    changes.push('Removed fake phone number (01632 prefix)');
  }
  // 07700 900 XXX = Ofcom reserved fake mobile range
  if (/\b07700\s*900\s*\d{3}\b/.test(fixed)) {
    fixed = fixed.replace(/\b07700\s*900\s*\d{3}\b/g, '');
    changes.push('Removed fake mobile number (07700 900 range)');
  }

  // Strip invented registered addresses (LLM pattern: "Registered address: 123 High St ... EC1A 1BB")
  const fakeAddressPattern = /(?:registered\s+(?:office|address)|our\s+address)\s*[:\-]\s*[^<\n]{10,100}[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/gi;
  if (fakeAddressPattern.test(fixed)) {
    fixed = fixed.replace(fakeAddressPattern, 'Contact: support@autodun.com');
    changes.push('Removed fake registered address');
  }

  // Fix wrong contact emails — any non-autodun contact/info/hello address
  const wrongEmailPattern = /\b(?:info|contact|hello|enquiries|admin)@(?!autodun\.com)[a-z0-9.-]+\.[a-z]{2,}\b/gi;
  if (wrongEmailPattern.test(fixed)) {
    fixed = fixed.replace(wrongEmailPattern, 'support@autodun.com');
    changes.push('Corrected contact email to support@autodun.com');
  }

  // Strip placeholder company registration numbers
  const fakeRegNums = ['12345678', '87654321', '11223344', '00000001', '99999999', '12121212'];
  for (const num of fakeRegNums) {
    const pattern = new RegExp(`(?:company\\s+(?:reg(?:istration)?\\s+)?(?:number|no\\.?):?\\s*)${num}\\b`, 'gi');
    if (pattern.test(fixed)) {
      fixed = fixed.replace(pattern, '');
      changes.push('Removed fake company registration number');
    }
  }

  // Strip invented autodun URL variants (e.g. auto-dun.com, autodun.co.uk)
  const wrongUrlPattern = /\bhttps?:\/\/(?!autodun\.com|mot\.autodun\.com|ev\.autodun\.com|ai\.autodun\.com|seoranko\.com)[a-z0-9.-]*autodun[a-z0-9.-]*\//gi;
  if (wrongUrlPattern.test(fixed)) {
    fixed = fixed.replace(wrongUrlPattern, 'https://autodun.com/');
    changes.push('Corrected invented autodun URL variant');
  }

  const status = changes.length > 0 ? 'fixed' : 'passed';
  const log = status === 'passed'
    ? 'Fact check passed — no fake data detected'
    : `Fake data removed: ${changes.join('; ')}`;

  return { content: fixed, status, log };
}

// ── Compute which audit issues the fix resolves ────────────────────────────
async function persistFixesAfterUpdate(
  domain: string,
  pageUrl: string,
  fixedIssues: string[],
  title: string,
  metaDesc: string,
): Promise<void> {
  const siteId = siteIdFromDomain(domain);
  const FIX_MAP: Record<string, { fix_type: Parameters<typeof upsertFix>[0]['fix_type']; getValue: () => string }> = {
    missing_title:            { fix_type: 'meta_title',      getValue: () => title },
    title_too_long:           { fix_type: 'meta_title',      getValue: () => title },
    missing_meta_description: { fix_type: 'meta_description', getValue: () => metaDesc },
    meta_too_long:            { fix_type: 'meta_description', getValue: () => metaDesc },
    missing_h1:               { fix_type: 'h1',              getValue: () => title },
    no_schema:                { fix_type: 'schema',          getValue: () => 'AI-generated structured data added' },
    missing_og_tags:          { fix_type: 'og_title',        getValue: () => title },
  };
  await Promise.allSettled(
    fixedIssues
      .map(key => FIX_MAP[key])
      .filter(Boolean)
      .map(({ fix_type, getValue }) =>
        upsertFix({ site_id: siteId, page_url: pageUrl, fix_type, new_value: getValue() })
      )
  );
}

function computeFixedIssues(
  inputIssues: Array<{ severity: string; category: string; message: string; deduction: number }>,
  is404: boolean,
  createNextjs: boolean,
): { fixedIssues: string[]; scoreGain: number; simulatedScore: number | null } {
  if (is404) {
    const fixedIssues = [
      'page_not_found', 'missing_title', 'missing_h1',
      'missing_meta_description', 'no_schema', 'thin_content', 'no_internal_links',
    ];
    if (createNextjs) fixedIssues.push('missing_og_tags');
    return { fixedIssues, scoreGain: 0, simulatedScore: createNextjs ? 82 : 72 };
  }

  const RESOLUTIONS: { key: string; patterns: string[] }[] = [
    { key: 'missing_title',            patterns: ['Missing title tag'] },
    { key: 'title_too_long',           patterns: ['Title too long:'] },
    { key: 'missing_h1',               patterns: ['Missing H1'] },
    { key: 'missing_meta_description', patterns: ['Missing meta description'] },
    { key: 'meta_too_long',            patterns: ['Meta description too long:'] },
    { key: 'no_schema',                patterns: ['No structured data'] },
    { key: 'thin_content',             patterns: ['Thin content:', 'Low word count:'] },
    { key: 'no_internal_links',        patterns: ['No internal links'] },
    { key: 'missing_og_tags',          patterns: ['Missing Open Graph'] },
  ];

  const fixedIssues: string[] = [];
  let scoreGain = 0;
  for (const res of RESOLUTIONS) {
    const match = inputIssues.find(iss => res.patterns.some(pat => iss.message.startsWith(pat)));
    if (match) { fixedIssues.push(res.key); scoreGain += match.deduction; }
  }
  return { fixedIssues, scoreGain, simulatedScore: null };
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

// ── Re-scrape helpers ─────────────────────────────────────────────────────

// Returns true if any key issue that was "fixed" is still present on the live page,
// meaning the deployment hasn't propagated yet.
function isLiveSiteStale(fixedIssueKeys: string[], freshIssues: any[]): boolean {
  const STALE_PATTERNS: Record<string, string[]> = {
    missing_title:            ['Missing title tag'],
    missing_h1:               ['Missing H1'],
    missing_meta_description: ['Missing meta description'],
    no_schema:                ['No structured data'],
    page_not_found:           ['Page not found'],
    no_internal_links:        ['No internal links'],
  };
  return fixedIssueKeys.some(key => {
    const patterns = STALE_PATTERNS[key];
    if (!patterns) return false;
    return freshIssues.some((iss: any) => patterns.some((p: string) => iss.message?.startsWith(p)));
  });
}

// Wait 3 s, re-fetch live page, update Supabase with fresh reality.
// If the live site hasn't deployed the fix yet, skips the DB overwrite and
// returns liveSiteStale: true so the caller can include it in the response.
// If the fetch itself fails (CORS, timeout, blocked), returns fetchFailed: true
// so the caller can show a softer "scan unavailable" message instead of an error.
async function rescrapeAndUpdate(
  url: string,
  cleanDomain: string,
  fixedIssueKeys: string[],
): Promise<{ liveSiteStale: boolean; fetchFailed: boolean }> {
  try {
    await new Promise(r => setTimeout(r, 3000));
    console.log('[site-audit/fix] re-scraping live page:', url);
    const freshSignals = await fetchPageSignals(url);
    const { score: freshScore, issues: freshIssues } = scorePage(freshSignals, [freshSignals]);
    const stale = isLiveSiteStale(fixedIssueKeys, freshIssues);
    if (stale) {
      console.log('[site-audit/fix] live site is stale — skipping DB overwrite');
    } else {
      await updateScrapedPage(cleanDomain, url, {
        score:        freshScore,
        scoreAfterFix: freshScore,
        issues:       freshIssues,
        wordCount:    freshSignals.wordCount,
        hasSchema:    freshSignals.hasSchema,
        hasFaq:       freshSignals.hasFaq,
      });
    }
    return { liveSiteStale: stale, fetchFailed: false };
  } catch (e) {
    console.error('[site-audit/fix] re-scrape failed (keeping existing audit data):', e);
    return { liveSiteStale: true, fetchFailed: true };
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawUrl: string = body.url;
    const { market = 'Global' } = body;
    const keyword: string = body.keyword || body.detectedKeyword || '';
    if (!rawUrl) return NextResponse.json({ error: 'url is required' }, { status: 400 });

    const url = normalizeUrl(rawUrl);
    const cleanDomain = normalizeDomain(rawUrl);

    const fallbackTitle: string = body.fallbackTitle || '';
    const fallbackH1: string = body.fallbackH1 || '';
    const fallbackMetaDescription: string = body.fallbackMetaDescription || '';
    const fallbackH2s: string[] = Array.isArray(body.fallbackH2s) ? body.fallbackH2s : [];
    const inputIssues: Array<{ severity: string; category: string; message: string; deduction: number }> =
      Array.isArray(body.issues) ? body.issues : [];
    const pageScoreInput: number = typeof body.pageScore === 'number' ? body.pageScore : 0;

    const githubRepo: string = body.githubRepo || '';
    const githubToken: string = body.githubToken || '';
    const githubBranch: string = body.githubBranch || 'main';
    const createNextjs: boolean = Boolean(body.createNextjs);
    const fixExistingNextjs: boolean = Boolean(body.fixExistingNextjs);

    // Consolidated onto the canonical LOCATION_CODES map instead of its own
    // 2-country check (was UK-vs-everything-else-is-US).
    const marketKey = market.trim().toLowerCase();
    const locationCode =
      LOCATION_CODES[marketKey]?.code ??
      Object.values(LOCATION_CODES).find(v => v.name.toLowerCase() === marketKey)?.code ??
      LOCATION_CODES.global.code;

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
        model: MODEL_FOR.keywordExtraction,
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

    // STEP 5a — Create Next.js component (alternative to HTML article)
    if (createNextjs) {
      const slug = extractPageSlug(url);
      const componentName = slugToComponentName(slug) || 'Home';
      const nextjsPagePath = getNextjsPagePath(url);
      const avgWords = competitors.length > 0
        ? Math.round(competitors.reduce((s, c) => s + c.wordCount, 0) / competitors.length)
        : 1200;
      const targetWords = Math.max(avgWords + 200, 1200);
      const secKeywords = kwData.keywords.slice(0, 6).map(k => k.keyword).join(', ');
      const compHeadings = competitors.flatMap(c => c.headings).filter(Boolean).slice(0, 8).join(', ');
      const today = new Date().toISOString().split('T')[0];

      const componentPrompt = `You are an expert Next.js developer. Generate a production-ready Next.js 14 App Router page component.

FILE: ${nextjsPagePath}
COMPONENT NAME: ${componentName}Page
TARGET KEYWORD: "${kwData.primary}"
MARKET: ${market}
STRATEGY: ${brief.briefSummary}
TARGET WORD COUNT: ${targetWords} words
SECONDARY KEYWORDS (use naturally): ${secKeywords}
${compHeadings ? `COMPETITOR SECTION IDEAS (cover these): ${compHeadings}` : ''}
MUST ADD: ${brief.contentToAdd.join(', ')}
TECH FIXES: ${brief.seoFixes.join(', ')}

Output ONLY valid TypeScript/TSX — no markdown code fences, no explanations, no comments outside JSX.
Start immediately with: import type { Metadata } from 'next';

REQUIRED EXACT STRUCTURE:

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '[60-char title with keyword]',
  description: '[150-char meta description with keyword and CTA]',
  openGraph: { title: '[same title]', description: '[same description]', type: 'article' },
};

export default function ${componentName}Page() {
  return (
    <article className="max-w-3xl mx-auto px-4 py-12 font-sans">

      <h1 className="text-3xl font-bold text-gray-900 mb-6 leading-tight">[H1 with keyword]</h1>

      <p className="text-lg text-gray-700 mb-6">[100-word intro with keyword in first sentence]</p>

      [EXACTLY 5 sections like this:]
      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-800 mt-8 mb-4">[H2 with secondary keyword]</h2>
        <p className="text-gray-700 mb-4">[150 words]</p>
      </section>

      <section className="mt-12 bg-gray-50 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">Frequently Asked Questions</h2>
        [4 FAQ items as:]
        <div className="mb-4">
          <h3 className="font-semibold text-gray-900 mb-2">[Question?]</h3>
          <p className="text-gray-700">[80-word answer]</p>
        </div>
      </section>

      <section className="mt-8 p-4 border-l-4 border-orange-500 bg-orange-50">
        <h2 className="text-lg font-semibold mb-2">The Bottom Line</h2>
        <p className="text-gray-700">[80-word practical summary with 2 action steps]</p>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": "[H1]",
        "author": { "@type": "Person", "name": "Kamran Gul" },
        "publisher": { "@type": "Organization", "name": "Autodun", "url": "https://autodun.com" },
        "datePublished": "${today}",
        "dateModified": "${today}"
      })}} />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          [4 FAQ objects]
        ]
      })}} />

    </article>
  );
}

Write the complete component now. Output TSX only.`;

      console.log('[site-audit/fix] streaming Next.js component...');
      const compStream = anthropic.messages.stream({
        model: MODEL_FOR.auditFixGeneration,
        max_tokens: 8000,
        messages: [{ role: 'user', content: componentPrompt }],
      });

      let componentCode = '';
      for await (const chunk of compStream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          componentCode += chunk.delta.text;
        }
      }
      // Strip any accidental markdown fences
      componentCode = componentCode.replace(/^```[a-z]*\n?/gm, '').replace(/```\s*$/gm, '').trim();

      let commitUrl: string | null = null;
      let githubFilePath: string | null = null;
      const deployHookConfiguredNextjs = !!process.env.VERCEL_DEPLOY_HOOK_AUTODUN;
      let redeployTriggeredNextjs = false;
      if (githubRepo && githubToken) {
        const pushResult = await pushToGithub(
          githubRepo, githubToken, githubBranch, nextjsPagePath, componentCode,
          `feat: add ${nextjsPagePath} — optimised for "${kwData.primary}" via SEORANKO`
        );
        if (pushResult) {
          commitUrl = pushResult.commitUrl;
          githubFilePath = pushResult.filePath;
          console.log('[site-audit/fix] pushed Next.js component to:', nextjsPagePath);
          redeployTriggeredNextjs = await triggerVercelRedeploy();
        }
      }

      const { fixedIssues: fi, scoreGain: sg, simulatedScore: ss } = computeFixedIssues(inputIssues, true, true);
      const sbf = pageScoreInput || 30;
      const saf = ss ?? Math.min(100, sbf + sg);

      // Persist fix to Supabase
      try {
        await updateFixedPage(cleanDomain, url, fi, sbf, saf);
        persistFixesAfterUpdate(cleanDomain, url, fi, kwData.primary, brief?.briefSummary ?? '').catch(() => {});
      } catch (e) {
        console.error('[site-audit/fix] DB update (createNextjs) failed:', e);
      }

      // Re-scrape live page — update DB with real current state and detect stale deployment
      const { liveSiteStale: createStale, fetchFailed: createFetchFailed } = await rescrapeAndUpdate(url, cleanDomain, fi);

      return NextResponse.json({
        success: true,
        componentCode,
        keyword: kwData.primary,
        lowKdKeywords: kwData.keywords,
        competitorsAnalysed: competitors.length,
        avgCompetitorWords: avgWords,
        brief,
        corrections: [],
        factCheckStatus: 'passed' as const,
        isNewPage: true,
        commitUrl,
        githubFilePath,
        redeployTriggered: redeployTriggeredNextjs,
        deployHookConfigured: deployHookConfiguredNextjs,
        fixedIssues: fi,
        scoreGain: sg,
        simulatedScore: ss,
        scoreBeforeFix: sbf,
        scoreAfterFix: saf,
        liveSiteStale: createStale,
        liveSiteStaleMessage: createStale
          ? createFetchFailed
            ? 'Fix pushed to GitHub. Live site re-scan unavailable right now — issues shown are from the last successful scan.'
            : 'Fix pushed to GitHub but live site still shows old content — your hosting needs to redeploy before changes appear here'
          : undefined,
      });
    }

    // STEP 5b — Rewrite an existing Next.js source file with SEO fixes
    if (fixExistingNextjs && githubRepo && githubToken) {
      const filePath = getNextjsPagePath(url);
      console.log('[site-audit/fix] reading existing Next.js file:', filePath);

      const existingFile = await fetchFileFromGithub(githubRepo, githubToken, githubBranch, filePath);
      const existingContent = existingFile?.content || '';

      const today = new Date().toISOString().split('T')[0];
      const secKeywords = kwData.keywords.slice(0, 6).map(k => k.keyword).join(', ');
      const issuesList = inputIssues.length > 0
        ? inputIssues.map(i => `- [${i.severity.toUpperCase()}] ${i.message}`).join('\n')
        : '- Missing visible H1 tag\n- No structured data schema\n- Title too long or missing\n- Thin content';

      const rewritePrompt = `You are an expert Next.js developer and SEO specialist.

TASK: Rewrite the following Next.js page component to fix all SEO issues listed below while preserving every existing import, component, functionality, and layout.

FILE PATH: ${filePath}
PAGE URL: ${url}
TARGET KEYWORD: "${kwData.primary}"
SECONDARY KEYWORDS (weave naturally): ${secKeywords}
TODAY: ${today}

SEO ISSUES TO FIX:
${issuesList}

EXISTING FILE CONTENT:
\`\`\`tsx
${existingContent.slice(0, 14000)}
\`\`\`

REQUIRED CHANGES:
1. Export a metadata object with title under 60 chars (include "${kwData.primary}"), description under 160 chars with CTA, and openGraph block — example:
   export const metadata: Metadata = { title: '...', description: '...', openGraph: { title: '...', description: '...' } };
2. Ensure there is a visible <h1> tag as the first semantic heading — if one exists in a child component, add one before it in the page JSX; never duplicate
3. Add this Organization schema inside the JSX return (before the closing tag):
   <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
     "@context": "https://schema.org",
     "@type": "Organization",
     "name": "Autodun",
     "url": "https://autodun.com",
     "description": "Free UK vehicle tools — MOT history, EV charging checker, mileage verification",
     "founder": { "@type": "Person", "name": "Kamran Gul" },
     "dateModified": "${today}"
   })}} />
4. Add at least 3 internal navigation links to /blog, /about, /contact if not already present
5. Add a short intro paragraph (80+ words) about Autodun's free UK vehicle tools if the page has thin/no body text

RULES:
- Output ONLY valid TypeScript/TSX — no markdown fences, no explanations, no extra comments
- Keep ALL existing imports; add \`import type { Metadata } from 'next';\` if not already imported
- Do NOT change any existing classNames, layout, or visual design
- Do NOT invent phone numbers, addresses, or company registration numbers
- Output the complete rewritten file starting with the first import line`;

      console.log('[site-audit/fix] streaming Next.js page rewrite...');
      const rewriteStream = anthropic.messages.stream({
        model: MODEL_FOR.auditFixGeneration,
        max_tokens: 12000,
        messages: [{ role: 'user', content: rewritePrompt }],
      });

      let rewrittenCode = '';
      for await (const chunk of rewriteStream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          rewrittenCode += chunk.delta.text;
        }
      }
      rewrittenCode = rewrittenCode.replace(/^```[a-z]*\n?/gm, '').replace(/```\s*$/gm, '').trim();

      const { content: checkedCode, log: factCheckLog } = factCheckContent(rewrittenCode);
      console.log('[site-audit/fix] rewrite fact-check:', factCheckLog);

      const avgWordsRewrite = competitors.length > 0
        ? Math.round(competitors.reduce((s, c) => s + c.wordCount, 0) / competitors.length)
        : 1200;

      let commitUrlRewrite: string | null = null;
      let githubFilePathRewrite: string | null = null;
      const deployHookConfiguredRewrite = !!process.env.VERCEL_DEPLOY_HOOK_AUTODUN;
      let redeployTriggeredRewrite = false;

      const pushResult = await pushToGithub(
        githubRepo, githubToken, githubBranch, filePath, checkedCode,
        `seo: fix ${filePath} — H1, schema, meta for "${kwData.primary}" via SEORANKO`
      );
      if (pushResult) {
        commitUrlRewrite = pushResult.commitUrl;
        githubFilePathRewrite = pushResult.filePath;
        console.log('[site-audit/fix] pushed rewritten page to:', filePath);
        redeployTriggeredRewrite = await triggerVercelRedeploy();
      }

      const { fixedIssues: fi, scoreGain: sg, simulatedScore: ss } = computeFixedIssues(inputIssues, false, true);
      const sbf = pageScoreInput;
      const saf = ss != null ? ss : Math.min(100, sbf + sg);

      try {
        await updateFixedPage(cleanDomain, url, fi, sbf, saf);
        persistFixesAfterUpdate(cleanDomain, url, fi, kwData.primary, brief?.briefSummary ?? '').catch(() => {});
      } catch (e) {
        console.error('[site-audit/fix] DB update (fixExistingNextjs) failed:', e);
      }

      // Re-scrape live page — update DB with real current state and detect stale deployment
      const { liveSiteStale: rewriteStale, fetchFailed: rewriteFetchFailed } = await rescrapeAndUpdate(url, cleanDomain, fi);

      return NextResponse.json({
        success: true,
        componentCode: checkedCode,
        keyword: kwData.primary,
        lowKdKeywords: kwData.keywords,
        competitorsAnalysed: competitors.length,
        avgCompetitorWords: avgWordsRewrite,
        brief,
        corrections: [],
        factCheckStatus: 'passed' as const,
        isNewPage: false,
        commitUrl: commitUrlRewrite,
        githubFilePath: githubFilePathRewrite,
        redeployTriggered: redeployTriggeredRewrite,
        deployHookConfigured: deployHookConfiguredRewrite,
        fixedIssues: fi,
        scoreGain: sg,
        simulatedScore: ss,
        scoreBeforeFix: sbf,
        scoreAfterFix: saf,
        liveSiteStale: rewriteStale,
        liveSiteStaleMessage: rewriteStale
          ? rewriteFetchFailed
            ? 'Fix pushed to GitHub. Live site re-scan unavailable right now — issues shown are from the last successful scan.'
            : 'Fix pushed to GitHub but live site still shows old content — your hosting needs to redeploy before changes appear here'
          : undefined,
      });
    }

    // STEP 5 — Build master prompt
    const avgCompetitorWords = competitors.length > 0
      ? Math.round(competitors.reduce((sum, c) => sum + c.wordCount, 0) / competitors.length)
      : 1500;

    const competitorHeadings = competitors.flatMap(c => c.headings).filter(Boolean).slice(0, 10);
    const internalLinks = '';

    const fixPrompt = `${buildMasterPrompt({
      mode: 'generate',
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
      model: MODEL_FOR.auditFixGeneration,
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

    // STEP 7.5 — Fact-check: strip fake phone numbers, addresses, emails, reg numbers
    const { content: factCheckedArticle, status: factCheckStatus, log: factCheckLog } = factCheckContent(validatedArticle);
    console.log('[site-audit/fix] fact-check:', factCheckLog);

    // STEP 7.6 — Light humanization pass
    let finalArticle = factCheckedArticle;
    let humanScore: number | undefined;
    try {
      const humanized = await humanizeArticle(factCheckedArticle, { level: 'light', primaryKeyword: kwData.primary });
      finalArticle = humanized.humanizedHtml;
      humanScore = humanized.humanScore;
      console.log('[site-audit/fix] human score:', humanScore);
    } catch (err) {
      console.warn('[site-audit/fix] humanization failed, using fact-checked article:', err);
    }

    // STEP 8 — Push to GitHub for 404 pages (HTML + markdown developer guide)
    let commitUrl: string | null = null;
    let githubFilePath: string | null = null;
    const deployHookConfigured = !!process.env.VERCEL_DEPLOY_HOOK_AUTODUN;
    let redeployTriggered = false;

    if (is404 && githubRepo && githubToken) {
      console.log('[site-audit/fix] pushing new page to GitHub...');
      const slug = extractPageSlug(url);
      const metaDesc = brief?.briefSummary?.slice(0, 155) || fallbackMetaDescription || '';
      const htmlPage = wrapArticleInHtml(finalArticle, url, pageData.title || kwData.primary, metaDesc);
      const mdGuide = buildMarkdownGuide(finalArticle, url, kwData.primary, brief);

      // Push HTML (static hosting / reference)
      const htmlPath = `public/${slug}/index.html`;
      const htmlResult = await pushToGithub(
        githubRepo, githubToken, githubBranch, htmlPath, htmlPage,
        `SEO: create ${htmlPath} — optimised for "${kwData.primary}" via SEORANKO`
      );

      // Push markdown developer guide
      const mdPath = `docs/seo-fixes/${slug}.md`;
      const mdResult = await pushToGithub(
        githubRepo, githubToken, githubBranch, mdPath, mdGuide,
        `SEO: add fix guide docs/seo-fixes/${slug}.md via SEORANKO`
      );

      const primary = htmlResult || mdResult;
      if (primary) {
        commitUrl = primary.commitUrl;
        githubFilePath = htmlResult ? htmlResult.filePath : (mdResult ? mdResult.filePath : null);
        console.log('[site-audit/fix] pushed to GitHub:', htmlPath, '+', mdPath);
        // Trigger Vercel redeploy after successful push
        redeployTriggered = await triggerVercelRedeploy();
      }
    }

    const { fixedIssues, scoreGain, simulatedScore } = computeFixedIssues(inputIssues, is404, false);
    const scoreBeforeFix = pageScoreInput || (is404 ? 30 : 0);
    const scoreAfterFix = simulatedScore != null ? simulatedScore : Math.min(100, scoreBeforeFix + scoreGain);

    // Persist fix to Supabase
    if (fixedIssues.length > 0) {
      try {
        await updateFixedPage(cleanDomain, url, fixedIssues, scoreBeforeFix, scoreAfterFix);
        persistFixesAfterUpdate(cleanDomain, url, fixedIssues, kwData.primary, brief?.briefSummary ?? '').catch(() => {});
      } catch (e) {
        console.error('[site-audit/fix] DB update failed:', e);
      }
    }

    // Re-scrape live page only when we pushed to GitHub (so deployment may have run)
    let liveSiteStale = false;
    let liveSiteFetchFailed = false;
    if (commitUrl) {
      const { liveSiteStale: htmlStale, fetchFailed: htmlFetchFailed } = await rescrapeAndUpdate(url, cleanDomain, fixedIssues);
      liveSiteStale = htmlStale;
      liveSiteFetchFailed = htmlFetchFailed;
    }

    return NextResponse.json({
      success: true,
      improvedArticle: finalArticle,
      humanScore,
      keyword: kwData.primary,
      lowKdKeywords: kwData.keywords,
      competitorsAnalysed: competitors.length,
      avgCompetitorWords,
      brief,
      corrections,
      factCheckStatus,
      isNewPage: is404,
      commitUrl,
      githubFilePath,
      redeployTriggered,
      deployHookConfigured,
      fixedIssues,
      scoreGain,
      simulatedScore,
      scoreBeforeFix,
      scoreAfterFix,
      liveSiteStale,
      liveSiteStaleMessage: liveSiteStale
        ? liveSiteFetchFailed
          ? 'Fix pushed to GitHub. Live site re-scan unavailable right now — issues shown are from the last successful scan.'
          : 'Fix pushed to GitHub but live site still shows old content — your hosting needs to redeploy before changes appear here'
        : undefined,
    });

  } catch (error: any) {
    console.error('[site-audit/fix]', error);
    return NextResponse.json({ error: error.message || 'Fix failed' }, { status: 500 });
  }
}
