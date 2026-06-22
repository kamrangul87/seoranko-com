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
        const sitemapUrls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
          .map(m => m[1].trim()).filter(u => u.includes('sitemap'));
        const allUrls: string[] = [];
        for (const childUrl of sitemapUrls.slice(0, 3)) {
          try {
            const childRes = await fetch(childUrl, { signal: AbortSignal.timeout(5000) });
            if (!childRes.ok) continue;
            const childXml = await childRes.text();
            const childUrls = Array.from(childXml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
              .map(m => m[1].trim()).filter(u => !u.includes('sitemap') && u.startsWith('http'));
            allUrls.push(...childUrls);
          } catch { /* skip */ }
        }
        if (allUrls.length > 0) {
          return { urls: allUrls.slice(0, 50), source: `Sitemap index: ${sitemapUrl} (${allUrls.length} URLs found)` };
        }
        continue;
      }

      const urls = Array.from(xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))
        .map(m => m[1].trim()).filter(u => u.startsWith('http') && !u.includes('sitemap'));
      if (urls.length > 0) {
        return { urls: urls.slice(0, 50), source: `${sitemapUrl} (${urls.length} URLs found)` };
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
            return { urls: urls.slice(0, 50), source: `robots.txt → ${sitemapFromRobots} (${urls.length} URLs found)` };
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

// ── Crawl homepage for internal links (fallback when sitemap is sparse) ───
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
    return Array.from(new Set(urls)).slice(0, 30);
  } catch {
    return [];
  }
}

// ── STEP B: Extended page signals ─────────────────────────────────────────
interface PageSignals {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  h2s: string[];
  wordCount: number;
  hasSchema: boolean;
  hasCanonical: boolean;
  hasFaq: boolean;
  hasOfficialSources: boolean;
  hasInternalLinks: boolean;
  images: number;
  internalLinks: number;
  fetchError?: string;
}

function emptyPage(url: string, fetchError?: string): PageSignals {
  return { url, title: '', metaDescription: '', h1: '', h2s: [], wordCount: 0, hasSchema: false, hasCanonical: false, hasFaq: false, hasOfficialSources: false, hasInternalLinks: false, images: 0, internalLinks: 0, fetchError };
}

async function fetchPageSignals(url: string): Promise<PageSignals> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return emptyPage(url, `HTTP ${res.status}`);

    const html = await res.text();
    const lowerHtml = html.toLowerCase();

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const metaDescription =
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim() ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i)?.[1]?.trim() ||
      '';
    const h1Raw = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
    const h1 = h1Raw.replace(/<[^>]+>/g, '').trim();

    const h2Matches = Array.from(html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi));
    const h2s = h2Matches.map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean).slice(0, 20);

    const hasSchema = html.includes('application/ld+json');
    const hasCanonical = /rel=["']canonical["']/.test(html);
    const hasFaq = lowerHtml.includes('faqpage') ||
      lowerHtml.includes('frequently asked') ||
      (lowerHtml.includes('<h2') && /\?<\/h2|how (do|to|can)|what is/i.test(html));
    const hasOfficialSources = /\.gov\b|\.gov\.uk|\.nhs\.uk|gov\.uk|official|legislature/i.test(html);
    const internalLinks = (html.match(/<a\s[^>]*href=["'][^"']*["'][^>]*>/gi) || []).length;
    const hasInternalLinks = internalLinks > 3;
    const images = (html.match(/<img\s/gi) || []).length;

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return { url, title, metaDescription, h1, h2s, wordCount, hasSchema, hasCanonical, hasFaq, hasOfficialSources, hasInternalLinks, images, internalLinks };
  } catch (err: any) {
    return emptyPage(url, err.message?.slice(0, 100));
  }
}

// ── STEP C: 50+ point scoring ─────────────────────────────────────────────
function scorePage(page: PageSignals, url: string): {
  score: number;
  issues: { severity: 'critical' | 'warning' | 'info'; message: string }[];
  opportunities: string[];
} {
  if (page.fetchError) {
    return {
      score: 20,
      issues: [{ severity: 'critical', message: `Page cannot be accessed: ${page.fetchError}` }],
      opportunities: ['Fix the page accessibility issue — this page scores 0 in Google'],
    };
  }

  let score = 100;
  const issues: { severity: 'critical' | 'warning' | 'info'; message: string }[] = [];
  const opportunities: string[] = [];

  // ── CRITICAL ──────────────────────────────────────────────────────────────
  if (!page.title) {
    score -= 12;
    issues.push({ severity: 'critical', message: 'No title tag (-12) — fundamental SEO requirement missing' });
    opportunities.push('Add a keyword-rich title tag under 60 characters');
  }
  if (!page.h1) {
    score -= 15;
    issues.push({ severity: 'critical', message: 'Missing H1 tag (-15) — critical for keyword targeting and rankings' });
    opportunities.push('Add a descriptive H1 tag aligned with your target keyword');
  }
  if (!page.metaDescription) {
    score -= 10;
    issues.push({ severity: 'critical', message: 'No meta description (-10) — reduces click-through rate from search' });
    opportunities.push('Write a compelling meta description under 160 characters');
  }
  if (!page.hasSchema) {
    score -= 12;
    issues.push({ severity: 'critical', message: 'No schema markup (-12) — missing rich result eligibility' });
    opportunities.push('Implement Article and FAQ schema JSON-LD for rich snippets');
  }
  if (page.wordCount < 300) {
    score -= 25;
    issues.push({ severity: 'critical', message: `Only ${page.wordCount} words (-25) — Google considers this thin content` });
    opportunities.push('Expand content to minimum 1,000 words covering the topic comprehensively');
  } else if (page.wordCount < 800) {
    score -= 15;
    issues.push({ severity: 'critical', message: `Only ${page.wordCount} words (-15) — below competitive threshold` });
    opportunities.push(`Add ${800 - page.wordCount}+ words covering related subtopics and FAQs`);
  }
  if (!url.startsWith('https')) {
    score -= 8;
    issues.push({ severity: 'critical', message: 'Page not served over HTTPS (-8) — Google penalises non-HTTPS pages' });
    opportunities.push('Migrate to HTTPS — essential for security and ranking signals');
  }

  // ── WARNINGS ──────────────────────────────────────────────────────────────
  if (!page.hasFaq) {
    score -= 8;
    issues.push({ severity: 'warning', message: 'No FAQ section (-8) — missing People Also Ask opportunity' });
    opportunities.push('Add 4-6 FAQ questions targeting People Also Ask queries for this topic');
  }
  if (!page.hasOfficialSources) {
    score -= 8;
    issues.push({ severity: 'warning', message: 'No official source citations (-8) — weak EEAT signals' });
    opportunities.push('Add citations to official sources (gov.uk, NHS, official company sites)');
  }
  if (!page.hasInternalLinks) {
    score -= 5;
    issues.push({ severity: 'warning', message: 'Few internal links (-5) — weak site architecture signals' });
    opportunities.push('Add 3-5 internal links to related pages with descriptive anchor text');
  }
  if (page.images === 0) {
    score -= 5;
    issues.push({ severity: 'warning', message: 'No images found (-5) — reduces engagement and visual search visibility' });
    opportunities.push('Add 2-3 relevant images with descriptive alt text');
  }
  if (page.metaDescription && page.metaDescription.length > 160) {
    score -= 4;
    issues.push({ severity: 'warning', message: `Meta description too long (${page.metaDescription.length} chars) (-4) — truncated in search results` });
    opportunities.push('Shorten meta description to under 160 characters');
  }
  if (page.metaDescription && page.metaDescription.length > 0 && page.metaDescription.length < 100) {
    score -= 3;
    issues.push({ severity: 'warning', message: 'Meta description too short — not utilising available space in search results' });
    opportunities.push('Expand meta description to 140-160 characters with keyword and CTA');
  }
  if (page.title && page.title.length > 65) {
    score -= 4;
    issues.push({ severity: 'warning', message: `Title too long (${page.title.length} chars) (-4) — truncated in search results` });
    opportunities.push('Shorten title to under 60 characters while keeping primary keyword');
  }
  if (page.h2s.length < 3 && page.wordCount > 500) {
    score -= 5;
    issues.push({ severity: 'warning', message: `Only ${page.h2s.length} H2 headings (-5) — poor content structure for SEO` });
    opportunities.push('Add structured H2 headings (minimum 5-6) to break content into clear sections');
  }

  // ── INFO ──────────────────────────────────────────────────────────────────
  if (page.wordCount > 300 && page.wordCount < 1200) {
    issues.push({ severity: 'info', message: `Content at ${page.wordCount} words — top pages for competitive keywords average 1,500+` });
    opportunities.push('Consider expanding to 1,500+ words to compete with top-ranking content');
  }
  if (page.images > 0) {
    issues.push({ severity: 'info', message: `${page.images} images found — verify all have descriptive alt text` });
    opportunities.push('Audit image alt text — ensure each image has a descriptive, keyword-relevant alt attribute');
  }
  if (page.h2s.length > 0 && !page.h1) {
    issues.push({ severity: 'info', message: 'Has H2 headings but no H1 — heading hierarchy is broken' });
  }

  return { score: Math.max(0, score), issues, opportunities };
}

// ── STEP D: AI — keyword detection + quick wins ────────────────────────────
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

      // If sitemap found fewer than 10 pages, crawl homepage for more internal links
      if (urlList.length < 10) {
        const base = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const baseUrl = `https://${base}`;
        const crawledUrls = await crawlHomepageForLinks(baseUrl);
        const existingSet = new Set(urlList);
        const newUrls = crawledUrls.filter(u => !existingSet.has(u));
        if (newUrls.length > 0) {
          urlList = [...urlList, ...newUrls];
          discoverySource += ` + ${newUrls.length} page${newUrls.length !== 1 ? 's' : ''} via homepage crawl`;
        }
      }
    } else if (urls && Array.isArray(urls)) {
      urlList = urls.slice(0, 20).map((u: string) => u.trim()).filter(Boolean);
    }

    if (urlList.length === 0) {
      return NextResponse.json({ error: 'No URLs found to audit' }, { status: 400 });
    }

    const auditUrls = urlList.slice(0, 20);

    // Fetch page signals in parallel batches of 5
    const pageSignals: PageSignals[] = [];
    for (let i = 0; i < auditUrls.length; i += 5) {
      const chunk = auditUrls.slice(i, i + 5);
      const chunkResults = await Promise.all(chunk.map(url => fetchPageSignals(url)));
      pageSignals.push(...chunkResults);
    }

    // AI analysis (keyword + quick wins)
    let aiData: Array<{ url: string; detectedKeyword: string; quickWins: string[] }> = [];
    try {
      aiData = await aiAnalysePages(pageSignals, market);
    } catch (err) {
      console.error('[site-audit] AI analysis failed, continuing without AI data:', err);
    }

    // Score all pages and merge
    const results = pageSignals
      .map(page => {
        const { score, issues, opportunities } = scorePage(page, page.url);
        const ai = aiData.find(r => r.url === page.url);
        return {
          url: page.url,
          title: page.title,
          metaDescription: page.metaDescription,
          h1: page.h1,
          h2s: page.h2s,
          wordCount: page.wordCount,
          hasSchema: page.hasSchema,
          hasCanonical: page.hasCanonical,
          hasFaq: page.hasFaq,
          hasOfficialSources: page.hasOfficialSources,
          images: page.images,
          score,
          issues,
          opportunities,
          aiAnalysis: ai ? { detectedKeyword: ai.detectedKeyword, quickWins: ai.quickWins } : undefined,
          fetchError: page.fetchError,
        };
      })
      .sort((a, b) => a.score - b.score); // worst first

    const scores = results.map(r => r.score);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    return NextResponse.json({
      success: true,
      discoverySource,
      discoveryError,
      summary: {
        totalPages: results.length,
        audited: results.length,
        avgScore,
        criticalIssues: results.filter(r => r.issues.some(i => i.severity === 'critical')).length,
        pagesNeedingAttention: results.filter(r => r.score < 70).length,
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
