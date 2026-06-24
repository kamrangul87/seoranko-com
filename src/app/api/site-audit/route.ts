/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { upsertAuditResults, getAuditResults, normalizeUrl, normalizeDomain } from '@/lib/supabase/audit-db';
import { AuditIssue, PageSignals, fetchPageSignals, scorePage } from '@/lib/site-audit/scorer';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 3 });
export const maxDuration = 300;
const FAST_MODEL = 'claude-haiku-4-5-20251001';

// ── STEP A: Discover all URLs from a domain via sitemap ───────────────────────

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
      });
      if (!res.ok) continue;
      const xml = await res.text();

      if (xml.includes('<sitemapindex')) {
        const childUrls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
          .map(m => m[1].trim()).filter(u => u.includes('sitemap'));
        const allUrls: string[] = [];
        for (const childUrl of childUrls.slice(0, 5)) {
          try {
            const childRes = await fetch(childUrl, { signal: AbortSignal.timeout(5000) });
            if (!childRes.ok) continue;
            const childXml = await childRes.text();
            const found = Array.from(childXml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
              .map(m => m[1].trim()).filter(u => !u.includes('sitemap') && u.startsWith('http'));
            allUrls.push(...found);
          } catch { /* skip */ }
        }
        if (allUrls.length > 0) {
          const deduped = Array.from(new Set(allUrls)).slice(0, 50);
          return { urls: deduped, source: `Sitemap index: ${sitemapUrl} (${allUrls.length} URLs found)` };
        }
        continue;
      }

      const urls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
        .map(m => m[1].trim()).filter(u => u.startsWith('http') && !u.includes('sitemap'));
      if (urls.length > 0) {
        const deduped = Array.from(new Set(urls)).slice(0, 50);
        return { urls: deduped, source: `${sitemapUrl} (${urls.length} URLs found)` };
      }
    } catch { /* try next */ }
  }

  try {
    const robotsRes = await fetch(`${baseUrl}/robots.txt`, { signal: AbortSignal.timeout(5000) });
    if (robotsRes.ok) {
      const robots = await robotsRes.text();
      const sitemapMatch = robots.match(/Sitemap:\s*(.+)/i);
      if (sitemapMatch?.[1]) {
        const sitemapFromRobots = sitemapMatch[1].trim();
        const res = await fetch(sitemapFromRobots, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const xml = await res.text();
          const urls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
            .map(m => m[1].trim()).filter(u => u.startsWith('http') && !u.includes('sitemap'));
          if (urls.length > 0) {
            const deduped = Array.from(new Set(urls)).slice(0, 50);
            return { urls: deduped, source: `robots.txt → ${sitemapFromRobots} (${urls.length} URLs found)` };
          }
        }
      }
    }
  } catch { /* skip */ }

  return {
    urls: [baseUrl],
    source: 'No sitemap found — auditing homepage only',
    error: 'No sitemap.xml found. Only the homepage was audited.',
  };
}

// Crawl homepage HTML for internal links
async function crawlHomepageForLinks(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const linkMatches = Array.from(html.matchAll(/href=["']([^"'#?]+)["']/gi));
    const urls = linkMatches
      .map(m => m[1].trim())
      .filter(href => href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:'))
      .map(href => {
        if (href.startsWith('http')) return href.startsWith(baseUrl) ? href : null;
        if (href.startsWith('/')) return `${baseUrl}${href}`;
        return null;
      })
      .filter((u): u is string => Boolean(u))
      .filter(u => !u.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|pdf|zip|xml)\b/i))
      .filter(u => u !== baseUrl && u !== `${baseUrl}/`);
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
    model: FAST_MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a senior SEO consultant. For each page, detect the primary target keyword and list 3 specific quick wins that would immediately improve rankings for the ${market} market.

${summary}

Return ONLY valid JSON array (no markdown, no extra text):
[{"url":"exact url","detectedKeyword":"primary keyword","quickWins":["quick win 1","quick win 2","quick win 3"]}]`,
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
    scoreOriginal: row.score,
    scoreBeforeFix: row.score_before_fix,
    scoreAfterFix: row.score_after_fix,
    grade: gradeLabel(displayScore),
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
          },
          results,
        });
      }
      // Fall through to fresh audit if nothing in DB
    }

    let urlList: string[] = [];
    let discoverySource = '';
    let discoveryError = '';

    if (domain) {
      const discovery = await discoverUrlsFromDomain(domain);
      urlList = discovery.urls;
      discoverySource = discovery.source;
      discoveryError = discovery.error || '';

      const base = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const baseUrl = `https://${base}`;

      // If sitemap found fewer than 15 pages, augment with crawl + common paths
      if (urlList.length < 15) {
        const [crawledUrls, commonPathUrls] = await Promise.all([
          crawlHomepageForLinks(baseUrl),
          checkCommonPaths(baseUrl),
        ]);
        const allExtra = Array.from(new Set([...crawledUrls, ...commonPathUrls]));
        const existingSet = new Set(urlList);
        const newUrls = allExtra.filter(u => !existingSet.has(u));
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
        const { score, issues, opportunities } = scorePage(page, pageSignals);
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
    }

    const preservedNote = fixedPageMap.size > 0
      ? ` · ${fixedPageMap.size} fixed page${fixedPageMap.size !== 1 ? 's' : ''} preserved`
      : '';

    return NextResponse.json({
      success: true,
      fromCache: false,
      discoverySource: discoverySource + preservedNote,
      discoveryError,
      summary: {
        totalPages: urlList.length,
        audited: allResults.length,
        avgScore,
        criticalIssues: allResults.filter(r => r.issues.some((i: AuditIssue) => i.severity === 'critical')).length,
        pagesNeedingAttention: allResults.filter(r => r.score < 70).length,
        pagesWithSchema: allResults.filter(r => r.hasSchema).length,
        pagesWithoutH1: allResults.filter(r => !r.h1).length,
      },
      results: allResults,
    });

  } catch (error: any) {
    console.error('[site-audit]', error);
    return NextResponse.json({ error: error.message || 'Audit failed' }, { status: 500 });
  }
}
