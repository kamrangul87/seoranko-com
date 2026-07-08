/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { upsertAuditResults, insertAuditHistory, getAuditResults, normalizeUrl, normalizeDomain } from '@/lib/supabase/audit-db';
import { AuditIssue, PageSignals, DomainSignals, fetchPageSignals, scorePage } from '@/lib/site-audit/scorer';

import { MODEL_FOR } from '@/lib/model-router';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 3 });
export const maxDuration = 300;

// ── STEP A: Discover all URLs from a domain via sitemap ───────────────────────

function parseSitemapUrls(xml: string): string[] {
  // Handle both <loc> and CDATA-wrapped locs; strip HTML entities
  return Array.from(xml.matchAll(/<loc>(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?<\/loc>/gi))
    .map(m => m[1].trim().replace(/&amp;/g, '&').replace(/&#x2F;/g, '/'))
    .filter(u => u.startsWith('http'));
}

async function discoverUrlsFromDomain(domain: string): Promise<{
  urls: string[];
  source: string;
  error?: string;
}> {
  const base = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const baseUrl = `https://${base}`;

  const sitemapLocations = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/sitemap/sitemap.xml`,
    `${baseUrl}/blog/sitemap.xml`,
    `${baseUrl}/wp-sitemap.xml`,
    `${baseUrl}/news-sitemap.xml`,
  ];

  for (const sitemapUrl of sitemapLocations) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      if (!res.ok) {
        console.log(`[sitemap] ${sitemapUrl} → ${res.status}`);
        continue;
      }
      const xml = await res.text();
      console.log(`[sitemap] ${sitemapUrl} → 200, ${xml.length} chars`);

      if (xml.includes('<sitemapindex')) {
        const childLocs = parseSitemapUrls(xml).filter(u => u.includes('sitemap'));
        const allUrls: string[] = [];
        await Promise.all(childLocs.slice(0, 5).map(async childUrl => {
          try {
            const childRes = await fetch(childUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
              signal: AbortSignal.timeout(6000),
            });
            if (!childRes.ok) return;
            const childXml = await childRes.text();
            const found = parseSitemapUrls(childXml).filter(u => !u.includes('sitemap'));
            console.log(`[sitemap] child ${childUrl} → ${found.length} URLs`);
            allUrls.push(...found);
          } catch (e) { console.log(`[sitemap] child fetch error: ${e}`); }
        }));
        if (allUrls.length > 0) {
          const deduped = Array.from(new Set(allUrls)).slice(0, 50);
          return { urls: deduped, source: `Sitemap index: ${sitemapUrl} (${deduped.length} URLs)` };
        }
        continue;
      }

      const urls = parseSitemapUrls(xml).filter(u => !u.includes('sitemap'));
      console.log(`[sitemap] ${sitemapUrl} → ${urls.length} page URLs`);
      if (urls.length > 0) {
        const deduped = Array.from(new Set(urls)).slice(0, 50);
        return { urls: deduped, source: `${sitemapUrl} (${deduped.length} URLs)` };
      }
    } catch (e) { console.log(`[sitemap] fetch error for ${sitemapUrl}: ${e}`); }
  }

  // Try robots.txt for a Sitemap: directive
  try {
    const robotsRes = await fetch(`${baseUrl}/robots.txt`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const robots = await robotsRes.text();
      const sitemapMatch = robots.match(/^Sitemap:\s*(.+)/im);
      if (sitemapMatch?.[1]) {
        const sitemapFromRobots = sitemapMatch[1].trim();
        console.log(`[sitemap] robots.txt → ${sitemapFromRobots}`);
        const res = await fetch(sitemapFromRobots, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const xml = await res.text();
          const urls = parseSitemapUrls(xml).filter(u => !u.includes('sitemap'));
          console.log(`[sitemap] robots.txt sitemap → ${urls.length} URLs`);
          if (urls.length > 0) {
            const deduped = Array.from(new Set(urls)).slice(0, 50);
            return { urls: deduped, source: `robots.txt → ${sitemapFromRobots} (${deduped.length} URLs)` };
          }
        }
      }
    }
  } catch (e) { console.log(`[sitemap] robots.txt error: ${e}`); }

  console.log(`[sitemap] No sitemap found for ${baseUrl} — will crawl homepage`);
  return {
    urls: [baseUrl],
    source: 'No sitemap found — crawling homepage for links',
    error: 'No sitemap.xml found. Homepage crawled for internal links.',
  };
}

// Crawl homepage HTML for internal links
async function crawlHomepageForLinks(baseUrl: string): Promise<string[]> {
  try {
    let baseDomain = '';
    try { baseDomain = new URL(baseUrl).hostname.replace(/^www\./, ''); } catch { /* skip */ }

    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = await res.text();
    const linkMatches = Array.from(html.matchAll(/href=["']([^"'#?]+)["']/gi));
    const urls = linkMatches
      .map(m => m[1].trim())
      .filter(href => href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:'))
      .map(href => {
        if (href.startsWith('http')) {
          // Accept links on same domain (with or without www)
          try {
            const linkHost = new URL(href).hostname.replace(/^www\./, '');
            return linkHost === baseDomain ? href : null;
          } catch { return null; }
        }
        if (href.startsWith('/')) return `${baseUrl}${href}`;
        return null;
      })
      .filter((u): u is string => Boolean(u))
      .filter(u => !u.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|pdf|zip|xml)\b/i))
      .filter(u => {
        try {
          const p = new URL(u).pathname;
          return p !== '/' && p !== '';
        } catch { return false; }
      });
    return Array.from(new Set(urls)).slice(0, 40);
  } catch {
    return [];
  }
}

// HEAD-check common paths that might not be in the sitemap
async function checkCommonPaths(baseUrl: string): Promise<string[]> {
  const paths = ['/blog', '/about', '/contact', '/pricing', '/faq', '/services', '/products', '/news', '/resources', '/help'];
  const found: string[] = [];
  await Promise.all(paths.map(async (path) => {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) found.push(`${baseUrl}${path}`);
    } catch { /* skip */ }
  }));
  return found;
}

// ── STEP C: Domain-level signals (robots.txt + llms.txt) ──────────────────────

const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'GoogleExtendedBot', 'anthropic-ai'];

function isAiCrawlerBlocked(robotsTxt: string, botName: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inBotSection = false;
  let inWildcardSection = false;
  let botBlocked = false;
  let wildcardBlocked = false;
  const botLower = botName.toLowerCase();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // blank lines reset section tracking
      if (inBotSection || inWildcardSection) {
        inBotSection = false;
        inWildcardSection = false;
      }
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const agent = trimmed.slice(11).trim().toLowerCase();
      inBotSection = agent === botLower;
      inWildcardSection = agent === '*';
      continue;
    }
    if (lower.startsWith('disallow:')) {
      const path = trimmed.slice(9).trim();
      if (path === '/') {
        if (inBotSection) botBlocked = true;
        if (inWildcardSection) wildcardBlocked = true;
      }
    }
    if (lower.startsWith('allow:')) {
      const path = trimmed.slice(6).trim();
      if ((path === '/' || path === '') && inBotSection) botBlocked = false;
    }
  }
  return botBlocked || wildcardBlocked;
}

async function fetchDomainSignals(baseUrl: string): Promise<DomainSignals> {
  const [robotsTxt, llmsOk] = await Promise.all([
    fetch(`${baseUrl}/robots.txt`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEORANKO-Audit/1.0)' },
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.text() : '').catch(() => ''),
    fetch(`${baseUrl}/llms.txt`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok).catch(() => false),
  ]);

  const blockedAiCrawlers = AI_CRAWLERS.filter(bot => isAiCrawlerBlocked(robotsTxt, bot));
  return { blockedAiCrawlers, hasLlmsTxt: llmsOk };
}

// ── STEP C2: Entity presence (Wikipedia, Reddit, LinkedIn) ────────────────────
async function checkEntityPresence(baseDomain: string): Promise<{
  wikipedia: boolean; reddit: boolean; linkedin: boolean; foundCount: number;
}> {
  const brandName = baseDomain.split('.')[0];
  const brand = brandName.charAt(0).toUpperCase() + brandName.slice(1);
  try {
    const res = await anthropic.messages.create({
      model: MODEL_FOR.keywordExtraction,
      max_tokens: 250,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
      messages: [{
        role: 'user',
        content: `Does the brand "${brand}" have a presence on: 1) Wikipedia (search site:en.wikipedia.org "${brand}"), 2) Reddit (search site:reddit.com "${brand}"), 3) LinkedIn company page (search site:linkedin.com/company "${brand}")? Search each and answer with ONLY valid JSON: {"wikipedia":boolean,"reddit":boolean,"linkedin":boolean}`,
      }],
    });
    const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const start = text.indexOf('{'); const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const obj = JSON.parse(text.slice(start, end + 1));
      const foundCount = [obj.wikipedia, obj.reddit, obj.linkedin].filter(Boolean).length;
      return { wikipedia: !!obj.wikipedia, reddit: !!obj.reddit, linkedin: !!obj.linkedin, foundCount };
    }
  } catch { /* fail open */ }
  return { wikipedia: false, reddit: false, linkedin: false, foundCount: 0 };
}

// ── STEP D: AI — keyword detection + quick wins ────────────────────────────────

async function aiAnalysePages(pages: PageSignals[], market: string): Promise<Array<{
  url: string;
  detectedKeyword: string;
  quickWins: string[];
}>> {
  const summary = pages.map((p, i) =>
    `Page ${i + 1}: ${p.url}
Title: ${p.title || 'MISSING'}
H1: ${p.h1 || 'MISSING'}
H2s: ${p.h2s.slice(0, 5).join(' | ') || 'none'}
Words: ${p.wordCount}
Meta: ${p.metaDescription?.slice(0, 80) || 'MISSING'}`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: MODEL_FOR.keywordExtraction,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: `You are a senior SEO and AI-search (GEO/AEO) consultant. For each page, detect the primary target keyword and list 4 specific quick wins for the ${market} market. Include one tip per AI engine: ChatGPT, Perplexity, Google AI Overviews, and Claude. Prefix each with the engine name in square brackets.

${summary}

Return ONLY valid JSON array (no markdown, no extra text):
[{"url":"exact url","detectedKeyword":"primary keyword","quickWins":["[ChatGPT] tip","[Perplexity] tip","[Google AIO] tip","[Claude] tip"]}]`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
  } catch (err) {
    console.error('[site-audit] AI analysis parse failed:', err);
  }
  return [];
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

function gradeLabel(s: number) {
  return s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 50 ? 'C' : s >= 30 ? 'D' : 'F';
}

// Convert a stored AuditRow back into the shape the UI expects,
// applying score_after_fix and fixed_issues if present.
function rowToResult(row: any) {
  const displayScore = row.score_after_fix != null ? row.score_after_fix : row.score;
  return {
    url: row.page_url,
    title: row.title,
    metaDescription: row.meta_description,
    h1: row.h1,
    wordCount: row.word_count,
    hasSchema: row.has_schema,
    hasFaq: row.has_faq,
    httpStatus: row.http_status,
    score: displayScore,
    searchScore: displayScore,
    aiScore: null as number | null,
    scoreOriginal: row.score,
    scoreBeforeFix: row.score_before_fix,
    scoreAfterFix: row.score_after_fix,
    grade: gradeLabel(displayScore),
    aiGrade: null as string | null,
    issues: row.score_after_fix != null
      ? (row.issues ?? []).filter((iss: any) => !(row.fixed_issues ?? []).includes(issueToKey(iss.message)))
      : (row.issues ?? []),
    opportunities: row.opportunities ?? [],
    aiAnalysis: row.ai_analysis,
    fixedIssues: row.fixed_issues ?? [],
    status: row.status ?? 'audited',
    lastFixedAt: row.last_fixed_at,
  };
}

const ISSUE_KEY_MAP: Record<string, string> = {
  'Missing title tag': 'missing_title',
  'Missing H1': 'missing_h1',
  'Missing meta description': 'missing_meta_description',
  'No structured data': 'no_schema',
  'Thin content:': 'thin_content',
  'Low word count:': 'thin_content',
  'No internal links': 'no_internal_links',
  'Missing Open Graph': 'missing_og_tags',
  'Page not found (404)': 'page_not_found',
};
function issueToKey(message: string): string {
  for (const [prefix, key] of Object.entries(ISSUE_KEY_MAP)) {
    if (message.startsWith(prefix)) return key;
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, domain, market = 'United Kingdom', mode } = body;

    const cleanDomain = domain ? normalizeDomain(domain) : '';

    // ── CACHED MODE: pure DB load, no scraping (Refresh Status button) ──────
    if (mode === 'cached' && domain) {
      const { rows, found } = await getAuditResults(cleanDomain);
      if (found && rows.length > 0) {
        const results = rows.map(rowToResult).sort((a, b) => a.score - b.score);
        const scores = results.map(r => r.score);
        const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        const lastAuditedAt = rows
          .map(r => r.last_audited_at)
          .filter(Boolean)
          .sort()
          .pop() ?? null;
        return NextResponse.json({
          success: true,
          fromCache: true,
          lastAuditedAt,
          discoverySource: `Loaded ${rows.length} pages from database`,
          discoveryError: '',
          summary: {
            totalPages: rows.length,
            audited: results.length,
            avgScore,
            criticalIssues: results.filter(r => r.issues.some((i: any) => i.severity === 'critical')).length,
            pagesNeedingAttention: results.filter(r => r.score < 70).length,
            pagesWithSchema: results.filter(r => r.hasSchema).length,
            pagesWithoutH1: results.filter(r => !r.h1).length,
            aiReadyPages: results.filter(r => (r.aiScore ?? 0) >= 70).length,
          },
          results,
        });
      }
      // Fall through to fresh audit if nothing in DB
    }

    let urlList: string[] = [];
    let discoverySource = '';
    let discoveryError = '';

    let domainSignals: DomainSignals = { blockedAiCrawlers: [], hasLlmsTxt: false };

    if (domain) {
      const discovery = await discoverUrlsFromDomain(domain);
      urlList = discovery.urls;
      discoverySource = discovery.source;
      discoveryError = discovery.error || '';

      const base = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const baseUrl = `https://${base}`;

      // Fetch domain-level signals in parallel with URL augmentation
      const [augmentResult, ds, entityPresence] = await Promise.all([
        (async () => {
          if (urlList.length < 20) {
            const [crawledUrls, commonPathUrls] = await Promise.all([
              crawlHomepageForLinks(baseUrl),
              checkCommonPaths(baseUrl),
            ]);
            console.log(`[crawl] crawlHomepageForLinks → ${crawledUrls.length} URLs, commonPaths → ${commonPathUrls.length} URLs`);
            return Array.from(new Set([...crawledUrls, ...commonPathUrls]));
          }
          return [] as string[];
        })(),
        fetchDomainSignals(baseUrl),
        checkEntityPresence(base).catch(() => ({ wikipedia: false, reddit: false, linkedin: false, foundCount: 0 })),
      ]);

      domainSignals = { ...ds, entityPresence };

      if (augmentResult.length > 0) {
        const existingSet = new Set(urlList);
        const newUrls = augmentResult.filter((u: string) => !existingSet.has(u));
        if (newUrls.length > 0) {
          urlList = [...urlList, ...newUrls];
          discoverySource += ` + ${newUrls.length} page${newUrls.length !== 1 ? 's' : ''} via crawl`;
        }
      }

      urlList = Array.from(new Set(urlList.map(normalizeUrl))).slice(0, 50);
    } else if (urls && Array.isArray(urls)) {
      urlList = urls.slice(0, 20).map((u: string) => normalizeUrl(u.trim())).filter(Boolean);
    }

    if (urlList.length === 0) {
      return NextResponse.json({ error: 'No URLs found to audit' }, { status: 400 });
    }

    // ── SMART MODE: load fixed pages from DB and skip re-scraping them ───────
    // mode='fresh' bypasses this (Re-audit All button)
    const fixedPageMap: Map<string, any> = new Map();
    if (mode !== 'fresh' && cleanDomain) {
      const { rows: existingRows } = await getAuditResults(cleanDomain);
      existingRows.filter((r: any) => r.status === 'fixed').forEach((r: any) => {
        fixedPageMap.set(normalizeUrl(r.page_url), r);
      });
      if (fixedPageMap.size > 0) {
        console.log(`[site-audit] smart mode: preserving ${fixedPageMap.size} fixed page(s), skipping re-scrape`);
      }
    }

    // Exclude fixed pages from scraping
    const auditUrls = urlList.slice(0, 20).filter(u => !fixedPageMap.has(u));

    // Fetch page signals in parallel batches of 5
    const pageSignals: PageSignals[] = [];
    for (let i = 0; i < auditUrls.length; i += 5) {
      const chunk = auditUrls.slice(i, i + 5);
      const chunkResults = await Promise.all(chunk.map(u => fetchPageSignals(u)));
      pageSignals.push(...chunkResults);
    }

    // AI analysis
    let aiData: Array<{ url: string; detectedKeyword: string; quickWins: string[] }> = [];
    try {
      aiData = await aiAnalysePages(pageSignals, market);
    } catch (err) {
      console.error('[site-audit] AI analysis failed:', err);
    }

    // Score freshly scraped pages
    const freshResults = pageSignals
      .map(page => {
        const { score, searchScore, aiScore, issues, opportunities } = scorePage(page, pageSignals, domainSignals);
        const ai = aiData.find(r => r.url === page.url);
        return {
          url: page.url,
          title: page.title,
          metaDescription: page.metaDescription,
          h1: page.h1,
          h1Count: page.h1Count,
          h2s: page.h2s,
          wordCount: page.wordCount,
          hasSchema: page.hasSchema,
          hasCanonical: page.hasCanonical,
          hasFaq: page.hasFaq,
          hasOfficialSources: page.hasOfficialSources,
          images: page.images,
          imagesWithoutAlt: page.imagesWithoutAlt,
          internalLinks: page.internalLinks,
          externalLinks: page.externalLinks,
          fetchTimeMs: page.fetchTimeMs,
          htmlSizeKb: page.htmlSizeKb,
          hasViewport: page.hasViewport,
          hasOgTags: page.hasOgTitle && page.hasOgDescription,
          hasTwitterCard: page.hasTwitterCard,
          noindex: page.noindex,
          isHttps: page.isHttps,
          httpStatus: page.httpStatus,
          score,
          searchScore,
          aiScore,
          grade: gradeLabel(score),
          aiGrade: gradeLabel(aiScore),
          issues,
          opportunities,
          aiAnalysis: ai ? { detectedKeyword: ai.detectedKeyword, quickWins: ai.quickWins } : undefined,
          fetchError: page.fetchError,
        };
      })
      .sort((a, b) => a.score - b.score);

    // Merge freshly scraped results with preserved fixed pages (smart mode)
    const fixedResults = Array.from(fixedPageMap.values()).map(rowToResult);
    const allResults = [...freshResults, ...fixedResults].sort((a, b) => a.score - b.score);

    const scores = allResults.map(r => r.score);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    // Only upsert freshly scraped pages — never overwrite fixed page rows
    if (cleanDomain && freshResults.length > 0) {
      upsertAuditResults(cleanDomain, freshResults).catch(e =>
        console.error('[site-audit] background upsert failed:', e)
      );
      insertAuditHistory(cleanDomain, freshResults.map(r => ({
        url: r.url,
        score: r.score,
        aiScore: r.aiScore ?? null,
      }))).catch(e => console.warn('[site-audit] history insert failed:', e));
    }

    const preservedNote = fixedPageMap.size > 0
      ? ` · ${fixedPageMap.size} fixed page${fixedPageMap.size !== 1 ? 's' : ''} preserved`
      : '';

    return NextResponse.json({
      success: true,
      fromCache: false,
      discoverySource: discoverySource + preservedNote,
      discoveryError,
      domainSignals,
      summary: {
        totalPages: urlList.length,
        audited: allResults.length,
        avgScore,
        criticalIssues: allResults.filter(r => r.issues.some((i: AuditIssue) => i.severity === 'critical')).length,
        pagesNeedingAttention: allResults.filter(r => r.score < 70).length,
        pagesWithSchema: allResults.filter(r => r.hasSchema).length,
        pagesWithoutH1: allResults.filter(r => !r.h1).length,
        aiReadyPages: allResults.filter(r => (r.aiScore ?? 0) >= 70).length,
      },
      results: allResults,
    });

  } catch (error: any) {
    console.error('[site-audit]', error);
    return NextResponse.json({ error: error.message || 'Audit failed' }, { status: 500 });
  }
}
