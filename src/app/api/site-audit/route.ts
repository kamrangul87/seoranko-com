/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 3 });
export const maxDuration = 300;
const FAST_MODEL = 'claude-haiku-4-5-20251001';

// ── STEP A: Discover all URLs from a domain via sitemap ───────────────────
async function discoverUrlsFromDomain(domain: string): Promise<{
  urls: string[];
  source: string;
  error?: string;
}> {
  // Normalise domain
  const base = domain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const baseUrl = `https://${base}`;

  // Try multiple sitemap locations in order
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

      // Check if it's a sitemap index (contains other sitemaps)
      if (xml.includes('<sitemapindex')) {
        const sitemapUrls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
          .map(m => m[1].trim())
          .filter(u => u.includes('sitemap'));

        // Fetch first 3 child sitemaps
        const allUrls: string[] = [];
        for (const childUrl of sitemapUrls.slice(0, 3)) {
          try {
            const childRes = await fetch(childUrl, {
              signal: AbortSignal.timeout(5000),
            });
            if (!childRes.ok) continue;
            const childXml = await childRes.text();
            const childUrls = Array.from(childXml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
              .map(m => m[1].trim())
              .filter(u => !u.includes('sitemap') && u.startsWith('http'));
            allUrls.push(...childUrls);
          } catch { /* skip */ }
        }

        if (allUrls.length > 0) {
          return {
            urls: allUrls.slice(0, 50),
            source: `Sitemap index: ${sitemapUrl} (${allUrls.length} URLs found)`,
          };
        }
        continue;
      }

      // Regular sitemap — extract all <loc> URLs
      const urls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
        .map(m => m[1].trim())
        .filter(u => u.startsWith('http') && !u.includes('sitemap'));

      if (urls.length > 0) {
        return {
          urls: urls.slice(0, 50),
          source: `${sitemapUrl} (${urls.length} URLs found)`,
        };
      }
    } catch { /* try next */ }
  }

  // Sitemap not found — try robots.txt for sitemap location
  try {
    const robotsRes = await fetch(`${baseUrl}/robots.txt`, {
      signal: AbortSignal.timeout(5000),
    });
    if (robotsRes.ok) {
      const robots = await robotsRes.text();
      const sitemapMatch = robots.match(/Sitemap:\s*(.+)/i);
      if (sitemapMatch?.[1]) {
        const sitemapFromRobots = sitemapMatch[1].trim();
        const res = await fetch(sitemapFromRobots, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const xml = await res.text();
          const urls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
            .map(m => m[1].trim())
            .filter(u => u.startsWith('http') && !u.includes('sitemap'));
          if (urls.length > 0) {
            return {
              urls: urls.slice(0, 50),
              source: `robots.txt → ${sitemapFromRobots} (${urls.length} URLs found)`,
            };
          }
        }
      }
    }
  } catch { /* skip */ }

  // Last resort — return just the homepage
  return {
    urls: [baseUrl],
    source: 'No sitemap found — auditing homepage only',
    error: 'No sitemap.xml found. Only the homepage was audited. Add a sitemap.xml to your site for full discovery.',
  };
}

// ── STEP B: Fetch and extract SEO signals from a single page ──────────────
interface PageSignals {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  wordCount: number;
  hasSchema: boolean;
  hasCanonical: boolean;
  internalLinks: number;
  fetchError?: string;
}

async function fetchPageSignals(url: string): Promise<PageSignals> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { url, title: '', metaDescription: '', h1: '', wordCount: 0, hasSchema: false, hasCanonical: false, internalLinks: 0, fetchError: `HTTP ${res.status}` };
    }
    const html = await res.text();

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const metaDescription =
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim() ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i)?.[1]?.trim() ||
      '';
    const h1Raw = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
    const h1 = h1Raw.replace(/<[^>]+>/g, '').trim();
    const hasSchema = html.includes('application/ld+json');
    const hasCanonical = /rel=["']canonical["']/.test(html);
    const internalLinks = (html.match(/<a\s[^>]*href=["'][^"']*["'][^>]*>/gi) || []).length;

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return { url, title, metaDescription, h1, wordCount, hasSchema, hasCanonical, internalLinks };
  } catch (err: any) {
    return { url, title: '', metaDescription: '', h1: '', wordCount: 0, hasSchema: false, hasCanonical: false, internalLinks: 0, fetchError: err.message?.slice(0, 100) };
  }
}

// ── STEP C: Score and identify issues without AI (fallback) ───────────────
function scoreBasic(p: PageSignals): number {
  if (p.fetchError) return 20;
  let score = 60;
  if (!p.title) score -= 20; else score += 5;
  if (!p.h1) score -= 20; else score += 5;
  if (!p.metaDescription) score -= 10; else score += 5;
  if (!p.hasSchema) score -= 10;
  if (p.wordCount < 300) score -= 20;
  else if (p.wordCount < 600) score -= 10;
  else if (p.wordCount >= 1500) score += 10;
  return Math.max(0, Math.min(100, score));
}

function issuesBasic(p: PageSignals): string[] {
  if (p.fetchError) return [`Cannot access page: ${p.fetchError}`];
  const issues: string[] = [];
  if (!p.title) issues.push('Missing page title tag');
  if (!p.h1) issues.push('Missing H1 heading');
  if (!p.metaDescription) issues.push('Missing meta description');
  if (!p.hasSchema) issues.push('No structured data / schema markup');
  if (p.wordCount < 300) issues.push('Very thin content — under 300 words');
  else if (p.wordCount < 600) issues.push('Thin content — under 600 words');
  return issues;
}

function oppsBasic(p: PageSignals): string[] {
  const opps: string[] = [];
  if (!p.hasSchema) opps.push('Add Article, FAQ, or HowTo schema markup');
  if (p.wordCount < 1000) opps.push('Expand content to 1000+ words for better rankings');
  if (!p.hasCanonical) opps.push('Add canonical tag to prevent duplicate content issues');
  if (!p.metaDescription) opps.push('Write a compelling meta description (150-160 chars)');
  return opps;
}

// ── STEP D: AI batch audit with Claude Haiku ─────────────────────────────
async function auditPagesWithAI(pages: PageSignals[], market: string): Promise<Array<{
  url: string;
  score: number;
  issues: string[];
  opportunities: string[];
}>> {
  const pagesSummary = pages.map((p, i) =>
    `Page ${i + 1}: ${p.url}
- Title: ${p.title || 'MISSING'}
- Meta description: ${p.metaDescription ? p.metaDescription.slice(0, 120) : 'MISSING'}
- H1: ${p.h1 || 'MISSING'}
- Word count: ${p.wordCount}
- Schema markup: ${p.hasSchema ? 'Yes' : 'No'}
- Canonical tag: ${p.hasCanonical ? 'Yes' : 'No'}
- Internal links: ${p.internalLinks}
${p.fetchError ? `- FETCH ERROR: ${p.fetchError}` : ''}`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are a senior SEO consultant auditing ${pages.length} pages for the ${market} market.

${pagesSummary}

Audit each page and return a score (0-100) with specific issues and opportunities.

Scoring: Start at 60. Missing title/H1: -20 each. Missing meta: -10. No schema: -10. Under 300 words: -20. Under 600 words: -10. 1500+ words: +10. Good title+H1+meta: +15. Schema present: +10. Fetch error: score=20.

Return ONLY a valid JSON array (no markdown, no extra text):
[{"url":"exact url here","score":75,"issues":["specific issue 1","specific issue 2"],"opportunities":["specific opportunity 1"]}]`,
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
    console.error('[site-audit] AI result parse failed:', err);
  }
  return [];
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, domain, market = 'United Kingdom' } = body;

    let urlList: string[] = [];
    let discoverySource = '';
    let discoveryError = '';

    if (domain) {
      const discovery = await discoverUrlsFromDomain(domain);
      urlList = discovery.urls;
      discoverySource = discovery.source;
      discoveryError = discovery.error || '';
    } else if (urls && Array.isArray(urls)) {
      urlList = urls.slice(0, 20).map((u: string) => u.trim()).filter(Boolean);
    }

    if (urlList.length === 0) {
      return NextResponse.json({ error: 'No URLs found to audit' }, { status: 400 });
    }

    // Cap at 20 pages for auditing
    const auditUrls = urlList.slice(0, 20);

    // Fetch page signals in parallel batches of 5
    const pageSignals: PageSignals[] = [];
    const chunkSize = 5;
    for (let i = 0; i < auditUrls.length; i += chunkSize) {
      const chunk = auditUrls.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(url => fetchPageSignals(url)));
      pageSignals.push(...chunkResults);
    }

    // AI audit (falls back to basic scoring if it fails)
    let aiResults: Array<{ url: string; score: number; issues: string[]; opportunities: string[] }> = [];
    try {
      aiResults = await auditPagesWithAI(pageSignals, market);
    } catch (err) {
      console.error('[site-audit] AI audit failed, using basic scoring:', err);
    }

    // Merge signals + AI results
    const results = pageSignals.map(page => {
      const ai = aiResults.find(r => r.url === page.url);
      return {
        url: page.url,
        title: page.title,
        metaDescription: page.metaDescription,
        h1: page.h1,
        wordCount: page.wordCount,
        hasSchema: page.hasSchema,
        hasCanonical: page.hasCanonical,
        score: ai?.score ?? scoreBasic(page),
        issues: ai?.issues?.length ? ai.issues : issuesBasic(page),
        opportunities: ai?.opportunities?.length ? ai.opportunities : oppsBasic(page),
        fetchError: page.fetchError,
      };
    });

    const scores = results.map(r => r.score);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    return NextResponse.json({
      success: true,
      discoverySource,
      discoveryError,
      summary: {
        totalPages: urlList.length,
        audited: results.length,
        avgScore,
        criticalIssues: results.filter(r => r.score < 50).length,
        pagesWithSchema: results.filter(r => r.hasSchema).length,
        pagesWithoutH1: results.filter(r => !r.h1).length,
      },
      results,
    });

  } catch (error: any) {
    console.error('[site-audit]', error);
    return NextResponse.json({ error: error.message || 'Audit failed' }, { status: 500 });
  }
}
