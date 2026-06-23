/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { upsertAuditResults, getAuditResults } from '@/lib/supabase/audit-db';

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

// ── STEP B: Page signals ──────────────────────────────────────────────────────

interface AuditIssue {
  severity: 'critical' | 'warning' | 'notice';
  category: 'crawlability' | 'onpage' | 'technical' | 'content' | 'schema';
  message: string;
  deduction: number;
}

interface PageSignals {
  url: string;
  fetchTimeMs: number;
  httpStatus: number;
  htmlSizeKb: number;
  noindex: boolean;
  xRobotsNoindex: boolean;
  hasCanonical: boolean;
  canonicalUrl: string;
  title: string;
  metaDescription: string;
  h1: string;
  h1Count: number;
  h2s: string[];
  imagesWithoutAlt: number;
  isHttps: boolean;
  hasViewport: boolean;
  hasOgTitle: boolean;
  hasOgDescription: boolean;
  hasOgImage: boolean;
  hasTwitterCard: boolean;
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  hasOfficialSources: boolean;
  hasSchema: boolean;
  hasArticleSchema: boolean;
  hasFaqSchema: boolean;
  hasBreadcrumbSchema: boolean;
  hasOrgSchema: boolean;
  images: number;
  hasFaq: boolean;
  hasInternalLinks: boolean;
  fetchError?: string;
}

function emptyPage(url: string, extra: Partial<PageSignals> = {}): PageSignals {
  return {
    url, fetchTimeMs: 0, httpStatus: 0, htmlSizeKb: 0,
    noindex: false, xRobotsNoindex: false, hasCanonical: false, canonicalUrl: '',
    title: '', metaDescription: '', h1: '', h1Count: 0, h2s: [], imagesWithoutAlt: 0,
    isHttps: url.startsWith('https'), hasViewport: false,
    hasOgTitle: false, hasOgDescription: false, hasOgImage: false, hasTwitterCard: false,
    wordCount: 0, internalLinks: 0, externalLinks: 0, hasOfficialSources: false,
    hasSchema: false, hasArticleSchema: false, hasFaqSchema: false,
    hasBreadcrumbSchema: false, hasOrgSchema: false,
    images: 0, hasFaq: false, hasInternalLinks: false,
    ...extra,
  };
}

async function fetchPageSignals(url: string): Promise<PageSignals> {
  const startTime = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    const fetchTimeMs = Date.now() - startTime;
    const httpStatus = res.status;
    if (!res.ok) return emptyPage(url, { fetchTimeMs, httpStatus, fetchError: `HTTP ${res.status}` });

    const xRobotsTag = res.headers.get('x-robots-tag') || '';
    const xRobotsNoindex = /noindex/i.test(xRobotsTag);

    const html = await res.text();
    const htmlSizeKb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
    const lowerHtml = html.toLowerCase();

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const metaDescription =
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim() ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i)?.[1]?.trim() ||
      '';

    const noindex =
      /name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html) ||
      /content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/i.test(html);

    const canonicalMatch =
      html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    const hasCanonical = Boolean(canonicalMatch);
    const canonicalUrl = canonicalMatch?.[1]?.trim() || '';

    const h1Matches = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi));
    const h1Count = h1Matches.length;
    const h1 = h1Count > 0 ? h1Matches[0][1].replace(/<[^>]+>/g, '').trim() : '';

    const h2Matches = Array.from(html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi));
    const h2s = h2Matches.map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean).slice(0, 20);

    const imgMatches = Array.from(html.matchAll(/<img\s[^>]*/gi));
    const images = imgMatches.length;
    const imagesWithoutAlt = imgMatches.filter(m => !/alt=["'][^"']+["']/.test(m[0])).length;

    const hasSchema = html.includes('application/ld+json');
    const hasArticleSchema = /"@type"\s*:\s*"Article"/i.test(html);
    const hasFaqSchema = /"@type"\s*:\s*"FAQPage"/i.test(html);
    const hasBreadcrumbSchema = /"@type"\s*:\s*"BreadcrumbList"/i.test(html);
    const hasOrgSchema = /"@type"\s*:\s*"Organization"/i.test(html);

    const hasFaq = hasFaqSchema || lowerHtml.includes('frequently asked') ||
      (lowerHtml.includes('<h2') && /\?<\/h2|how (do|to|can)|what is/i.test(html));

    let baseHost = '';
    try { baseHost = new URL(url).hostname; } catch { /* skip */ }

    const allLinks = Array.from(html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi));
    let internalLinks = 0;
    let externalLinks = 0;
    for (const link of allLinks) {
      const href = link[1];
      if (href.startsWith('/') || (baseHost && href.includes(baseHost))) {
        internalLinks++;
      } else if (href.startsWith('http')) {
        externalLinks++;
      }
    }
    const hasInternalLinks = internalLinks > 3;

    const isHttps = url.startsWith('https');
    const hasViewport = /name=["']viewport["']/i.test(html);
    const hasOgTitle = /property=["']og:title["']/i.test(html);
    const hasOgDescription = /property=["']og:description["']/i.test(html);
    const hasOgImage = /property=["']og:image["']/i.test(html);
    const hasTwitterCard = /name=["']twitter:card["']/i.test(html);
    const hasOfficialSources = /\.gov\b|\.gov\.uk|\.nhs\.uk|gov\.uk|official|legislature/i.test(html);

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    return {
      url, fetchTimeMs, httpStatus, htmlSizeKb,
      noindex, xRobotsNoindex, hasCanonical, canonicalUrl,
      title, metaDescription, h1, h1Count, h2s, imagesWithoutAlt,
      isHttps, hasViewport, hasOgTitle, hasOgDescription, hasOgImage, hasTwitterCard,
      wordCount, internalLinks, externalLinks, hasOfficialSources,
      hasSchema, hasArticleSchema, hasFaqSchema, hasBreadcrumbSchema, hasOrgSchema,
      images, hasFaq, hasInternalLinks,
    };
  } catch (err: any) {
    return emptyPage(url, { fetchTimeMs: Date.now() - startTime, fetchError: err.message?.slice(0, 100) });
  }
}

// ── STEP C: Technical SEO scoring ─────────────────────────────────────────────

function scorePage(page: PageSignals, allPages: PageSignals[]): {
  score: number;
  issues: AuditIssue[];
  opportunities: string[];
} {
  if (page.fetchError && page.wordCount === 0) {
    const is404 = page.httpStatus === 404;
    return {
      score: is404 ? 30 : 20,
      issues: [{
        severity: 'critical' as const,
        category: 'crawlability' as const,
        message: is404
          ? 'Page not found (404) — this route does not exist yet'
          : `Page cannot be accessed: ${page.fetchError}`,
        deduction: 15,
      }],
      opportunities: is404
        ? [
            'Create this page in your Next.js app at app/[slug]/page.tsx',
            'Add metadata export with title, description, and Open Graph tags',
            'Include Article + FAQPage JSON-LD schema for rich results',
            'Target keyword: ' + (page.title || 'detect from URL path'),
          ]
        : ['Fix the page accessibility issue — Google cannot crawl or index this page'],
    };
  }

  let score = 100;
  const issues: AuditIssue[] = [];
  const opportunities: string[] = [];

  const crit = (category: AuditIssue['category'], message: string) => {
    score -= 15; issues.push({ severity: 'critical', category, message, deduction: 15 });
  };
  const warn = (category: AuditIssue['category'], message: string) => {
    score -= 5; issues.push({ severity: 'warning', category, message, deduction: 5 });
  };
  const note = (category: AuditIssue['category'], message: string) => {
    score -= 2; issues.push({ severity: 'notice', category, message, deduction: 2 });
  };

  // ── CRAWLABILITY ─────────────────────────────────────────────────────────
  if (page.noindex) {
    crit('crawlability', 'Noindex meta tag — page is blocked from Google\'s index');
    opportunities.push('Remove noindex if this page should rank');
  }
  if (page.xRobotsNoindex) {
    crit('crawlability', 'X-Robots-Tag: noindex in HTTP headers — Google cannot index this page');
    opportunities.push('Remove X-Robots-Tag noindex from server headers');
  }
  if (!page.isHttps) {
    crit('crawlability', 'Served over HTTP — Google demotes non-HTTPS pages');
    opportunities.push('Migrate to HTTPS — required for ranking and security');
  }
  if (!page.hasCanonical) {
    warn('crawlability', 'No canonical tag — Google may consolidate wrong URL variants');
    opportunities.push('Add <link rel="canonical"> pointing to the preferred URL');
  } else if (page.canonicalUrl) {
    let canonHost = '';
    try { canonHost = new URL(page.canonicalUrl).hostname; } catch { /* skip */ }
    let pageHost = '';
    try { pageHost = new URL(page.url).hostname; } catch { /* skip */ }
    if (canonHost && pageHost && canonHost !== pageHost) {
      warn('crawlability', `Canonical points off-site to ${page.canonicalUrl.slice(0, 60)}`);
      opportunities.push('Verify canonical URL is correct — currently points to a different domain');
    }
  }

  // ── ON-PAGE SEO ──────────────────────────────────────────────────────────
  if (!page.title) {
    crit('onpage', 'Missing title tag — fundamental SEO requirement');
    opportunities.push('Add a keyword-rich title tag under 60 characters');
  } else {
    const tl = page.title.length;
    if (tl < 30) {
      warn('onpage', `Title too short (${tl} chars) — add more context and keyword`);
      opportunities.push('Expand title to 50-60 characters with your primary keyword');
    } else if (tl > 60) {
      warn('onpage', `Title too long (${tl} chars) — will be truncated in Google results`);
      opportunities.push('Shorten title to under 60 characters');
    }
  }

  if (!page.metaDescription) {
    crit('onpage', 'Missing meta description — reduces click-through rate from search results');
    opportunities.push('Write a compelling meta description of 140-160 characters');
  } else {
    const ml = page.metaDescription.length;
    if (ml < 70) {
      warn('onpage', `Meta description too short (${ml} chars)`);
      opportunities.push('Expand meta description to 140-160 characters with keyword and CTA');
    } else if (ml > 160) {
      warn('onpage', `Meta description too long (${ml} chars) — will be truncated`);
      opportunities.push('Shorten meta description to under 160 characters');
    }
  }

  if (!page.h1) {
    crit('onpage', 'Missing H1 — critical for keyword targeting');
    opportunities.push('Add a descriptive H1 tag that includes your target keyword');
  } else if (page.h1Count > 1) {
    warn('onpage', `Multiple H1 tags (${page.h1Count}) — confuses Google's understanding of the primary topic`);
    opportunities.push('Keep only one H1 per page — use H2s for sub-sections');
  }

  if (page.h2s.length === 0 && page.wordCount > 200) {
    warn('onpage', 'No H2 headings — poor content structure for SEO');
    opportunities.push('Add at least 4-5 H2 headings to structure your content');
  } else if (page.h2s.length < 3 && page.wordCount > 600) {
    note('onpage', `Only ${page.h2s.length} H2 heading${page.h2s.length !== 1 ? 's' : ''} for a ${page.wordCount}-word page`);
    opportunities.push('Add more H2 sections for comprehensive topic coverage');
  }

  if (page.imagesWithoutAlt > 0) {
    warn('onpage', `${page.imagesWithoutAlt} image${page.imagesWithoutAlt !== 1 ? 's' : ''} missing alt text`);
    opportunities.push('Add descriptive alt text to all images for accessibility and image SEO');
  }

  // Duplicate title/meta detection
  const dupTitles = allPages.filter(p => p.url !== page.url && p.title && p.title === page.title);
  if (dupTitles.length > 0) {
    warn('onpage', `Duplicate title — identical to ${dupTitles.length} other page${dupTitles.length > 1 ? 's' : ''}`);
    opportunities.push('Write a unique title for every page');
  }
  const dupMetas = allPages.filter(p => p.url !== page.url && p.metaDescription && p.metaDescription === page.metaDescription);
  if (dupMetas.length > 0) {
    warn('onpage', `Duplicate meta description — identical to ${dupMetas.length} other page${dupMetas.length > 1 ? 's' : ''}`);
    opportunities.push('Write a unique meta description for every page');
  }

  // ── TECHNICAL ────────────────────────────────────────────────────────────
  if (!page.hasViewport) {
    warn('technical', 'Missing viewport meta tag — Google uses mobile-first indexing');
    opportunities.push('Add <meta name="viewport" content="width=device-width, initial-scale=1">');
  }

  if (page.fetchTimeMs > 3000) {
    warn('technical', `Slow server response: ${(page.fetchTimeMs / 1000).toFixed(1)}s — page speed is a ranking factor`);
    opportunities.push('Improve server response time — target under 1 second');
  } else if (page.fetchTimeMs > 1500) {
    note('technical', `Server response: ${(page.fetchTimeMs / 1000).toFixed(1)}s — room for improvement`);
    opportunities.push('Optimise server response time to improve Core Web Vitals');
  }

  if (page.htmlSizeKb > 100) {
    note('technical', `Large HTML document (${page.htmlSizeKb}KB) — consider moving inline assets to external files`);
    opportunities.push('Move inline CSS/JS to external files to reduce HTML document size');
  }

  if (!page.hasOgTitle || !page.hasOgDescription) {
    warn('technical', 'Missing Open Graph tags — poor appearance when shared on social media');
    opportunities.push('Add og:title, og:description and og:image meta tags');
  } else if (!page.hasOgImage) {
    note('technical', 'Missing og:image — social share previews will show no image');
    opportunities.push('Add <meta property="og:image"> with a 1200×630px image URL');
  }

  if (!page.hasTwitterCard) {
    note('technical', 'No Twitter Card tags — no rich preview on X/Twitter');
    opportunities.push('Add <meta name="twitter:card" content="summary_large_image">');
  }

  // ── CONTENT ──────────────────────────────────────────────────────────────
  if (page.wordCount < 150) {
    crit('content', `Thin content: only ${page.wordCount} words — Google actively demotes thin pages`);
    opportunities.push('Expand this page to at least 800 words of substantive content');
  } else if (page.wordCount < 300) {
    warn('content', `Low word count: ${page.wordCount} words — below minimum for competitive ranking`);
    opportunities.push('Expand content to at least 800 words with comprehensive coverage');
  } else if (page.wordCount < 800) {
    note('content', `${page.wordCount} words — top-ranking pages for competitive keywords average 1,500+`);
    opportunities.push('Consider expanding to 1,200+ words to beat competitors');
  }

  if (page.internalLinks < 2) {
    warn('content', 'No internal links — weak site architecture and no link equity flow');
    opportunities.push('Add 3-5 internal links to related pages with descriptive anchor text');
  }

  if (page.externalLinks === 0 && page.wordCount > 300) {
    note('content', 'No external links — missed opportunity to cite authoritative sources');
    opportunities.push('Add 2-3 outbound links to authoritative sources');
  }

  if (!page.hasOfficialSources && page.wordCount > 300) {
    warn('content', 'No official source citations — weak EEAT trust signals');
    opportunities.push('Cite at least 2 official sources (gov.uk, NHS, authoritative bodies)');
  }

  if (page.images === 0 && page.wordCount > 300) {
    warn('content', 'No images — reduces engagement and visual search visibility');
    opportunities.push('Add 2-3 relevant images with descriptive alt text');
  }

  // ── SCHEMA ───────────────────────────────────────────────────────────────
  if (!page.hasSchema) {
    crit('schema', 'No structured data — missing rich result eligibility');
    opportunities.push('Add Article and FAQ JSON-LD schema to unlock rich snippets');
  } else {
    if (!page.hasFaqSchema && page.hasFaq) {
      note('schema', 'FAQ content found but no FAQPage schema — missing People Also Ask opportunity');
      opportunities.push('Add FAQPage JSON-LD schema to target People Also Ask');
    }
    if (!page.hasArticleSchema && page.wordCount > 500) {
      note('schema', 'Long-form content lacks Article schema');
      opportunities.push('Add Article JSON-LD with author, datePublished, dateModified');
    }
    if (!page.hasBreadcrumbSchema) {
      note('schema', 'No BreadcrumbList schema — missing breadcrumb in SERPs');
      opportunities.push('Add BreadcrumbList schema to show site navigation in Google results');
    }
  }

  return { score: Math.max(0, score), issues, opportunities };
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

    // ── CACHED MODE: load from Supabase instead of re-scraping ──────────────
    if (mode === 'cached' && domain) {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
      const { rows, found } = await getAuditResults(cleanDomain);
      if (found && rows.length > 0) {
        const results = rows.map(rowToResult).sort((a, b) => a.score - b.score);
        const scores = results.map(r => r.score);
        const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        return NextResponse.json({
          success: true,
          fromCache: true,
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

      urlList = Array.from(new Set(urlList)).slice(0, 50);
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

    // Score all pages — pass full list for duplicate detection
    const results = pageSignals
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

    const scores = results.map(r => r.score);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    // Save to Supabase in background (don't await — don't block response)
    const cleanDomain = domain
      ? domain.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '')
      : (() => { try { return new URL(results[0]?.url ?? '').hostname.replace(/^www\./, ''); } catch { return ''; } })();
    if (cleanDomain) {
      upsertAuditResults(cleanDomain, results).catch(e =>
        console.error('[site-audit] background upsert failed:', e)
      );
    }

    return NextResponse.json({
      success: true,
      fromCache: false,
      discoverySource,
      discoveryError,
      summary: {
        totalPages: urlList.length,
        audited: results.length,
        avgScore,
        criticalIssues: results.filter(r => r.issues.some((i: AuditIssue) => i.severity === 'critical')).length,
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
