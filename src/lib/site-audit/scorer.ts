/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AuditIssue {
  severity: 'critical' | 'warning' | 'notice';
  category: 'crawlability' | 'onpage' | 'technical' | 'content' | 'schema' | 'security' | 'speed' | 'ai' | 'links' | 'mobile' | 'depth';
  message: string;
  deduction: number;
}

export interface PageSignals {
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
  // Security headers
  hasHsts: boolean;
  hasXFrameOptions: boolean;
  hasXContentTypeOptions: boolean;
  hasCSP: boolean;
  isCompressed: boolean;
  // Speed
  renderBlockingScripts: number;
  imagesWithoutLazy: number;
  imagesWithoutDimensions: number;
  // Mobile/UX
  hasLangAttribute: boolean;
  // Content depth
  paragraphCount: number;
  avgSentenceLength: number;
  hasHeadingHierarchyIssue: boolean;
  // AI / schema
  hasSpeakableSchema: boolean;
  hasPersonSchema: boolean;
  hasHowToSchema: boolean;
  hasQAStructure: boolean;
  // Link health
  poorAnchorTextCount: number;
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
    hasHsts: false, hasXFrameOptions: false, hasXContentTypeOptions: false, hasCSP: false, isCompressed: false,
    renderBlockingScripts: 0, imagesWithoutLazy: 0, imagesWithoutDimensions: 0,
    hasLangAttribute: false,
    paragraphCount: 0, avgSentenceLength: 0, hasHeadingHierarchyIssue: false,
    hasSpeakableSchema: false, hasPersonSchema: false, hasHowToSchema: false, hasQAStructure: false,
    poorAnchorTextCount: 0,
    ...extra,
  };
}

export async function fetchPageSignals(url: string): Promise<PageSignals> {
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

    // Security & compression headers
    const hasHsts = !!res.headers.get('strict-transport-security');
    const hasXFrameOptions = !!res.headers.get('x-frame-options');
    const hasXContentTypeOptions = !!res.headers.get('x-content-type-options');
    const hasCSP = !!res.headers.get('content-security-policy');
    const isCompressed = /gzip|br|deflate/i.test(res.headers.get('content-encoding') || '');

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

    // Render-blocking scripts in <head>
    const headSection = html.match(/<head[\s\S]*?<\/head>/i)?.[0] || '';
    const headScriptTags = Array.from(headSection.matchAll(/<script\b([^>]*)>/gi));
    const renderBlockingScripts = headScriptTags.filter(m => !/\basync\b|\bdefer\b/i.test(m[1])).length;

    // Images without lazy loading / dimensions
    const imgTagsRaw = Array.from(html.matchAll(/<img\s[^>]*/gi));
    const imagesWithoutLazy = imgTagsRaw.filter(m => !/\bloading\s*=\s*["']?lazy/i.test(m[0])).length;
    const imagesWithoutDimensions = imgTagsRaw.filter(m =>
      !/\bwidth\s*=\s*["']?\d/i.test(m[0]) || !/\bheight\s*=\s*["']?\d/i.test(m[0])
    ).length;

    // Language attribute on <html>
    const hasLangAttribute = /<html[^>]+\slang\s*=/i.test(html);

    // Schema: speakable, person, howto
    const hasSpeakableSchema = /"@type"\s*:\s*"SpeakableSpecification"/i.test(html);
    const hasPersonSchema = /"@type"\s*:\s*"Person"/i.test(html);
    const hasHowToSchema = /"@type"\s*:\s*"HowTo"/i.test(html);

    // Q&A structure: any H2 ending with '?'
    const hasQAStructure = h2Matches.some(m => m[1].replace(/<[^>]+>/g, '').trim().endsWith('?'));

    // Paragraph count (rough)
    const paragraphCount = (html.match(/<p[\s>]/gi) || []).length;

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

    // Average sentence length (analyse first 5000 chars of text)
    const sentenceList = text.slice(0, 5000).match(/[^.!?]+[.!?]+/g) || [];
    const avgSentenceLength = sentenceList.length > 5
      ? Math.round(sentenceList.reduce((s, sent) => s + sent.trim().split(/\s+/).length, 0) / sentenceList.length)
      : 0;

    // Heading hierarchy: H3 used without H2
    const h3Count = (html.match(/<h3\b/gi) || []).length;
    const hasHeadingHierarchyIssue = h3Count > 0 && h2s.length === 0;

    // Poor anchor text (generic link text)
    const anchorTextMatches = Array.from(html.matchAll(/<a[^>]*>([^<]*)<\/a>/gi));
    const poorAnchorRe = /^\s*$|^(click here|read more|here|learn more|this|link|more|see more|view more)\s*$/i;
    const poorAnchorTextCount = anchorTextMatches.filter(m => poorAnchorRe.test(m[1])).length;

    return {
      url, fetchTimeMs, httpStatus, htmlSizeKb,
      noindex, xRobotsNoindex, hasCanonical, canonicalUrl,
      title, metaDescription, h1, h1Count, h2s, imagesWithoutAlt,
      isHttps, hasViewport, hasOgTitle, hasOgDescription, hasOgImage, hasTwitterCard,
      wordCount, internalLinks, externalLinks, hasOfficialSources,
      hasSchema, hasArticleSchema, hasFaqSchema, hasBreadcrumbSchema, hasOrgSchema,
      images, hasFaq, hasInternalLinks,
      hasHsts, hasXFrameOptions, hasXContentTypeOptions, hasCSP, isCompressed,
      renderBlockingScripts, imagesWithoutLazy, imagesWithoutDimensions,
      hasLangAttribute,
      paragraphCount, avgSentenceLength, hasHeadingHierarchyIssue,
      hasSpeakableSchema, hasPersonSchema, hasHowToSchema, hasQAStructure,
      poorAnchorTextCount,
    };
  } catch (err: any) {
    return emptyPage(url, { fetchTimeMs: Date.now() - startTime, fetchError: err.message?.slice(0, 100) });
  }
}

export function scorePage(page: PageSignals, allPages: PageSignals[]): {
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
  // (viewport, fetch time, html size, OG tags, twitter card have moved to speed/mobile categories)

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

  // ── SECURITY ─────────────────────────────────────────────────────────────
  if (page.isHttps) {
    if (!page.hasHsts) {
      score -= 15; issues.push({ severity: 'critical', category: 'security', message: 'No HSTS header — site vulnerable to downgrade attacks', deduction: 15 });
    }
  }
  if (!page.hasXFrameOptions) {
    score -= 5; issues.push({ severity: 'warning', category: 'security', message: 'No X-Frame-Options header — clickjacking protection missing', deduction: 5 });
  }
  if (!page.hasXContentTypeOptions) {
    score -= 5; issues.push({ severity: 'warning', category: 'security', message: 'Missing X-Content-Type-Options header — browsers may sniff MIME types', deduction: 5 });
  }
  if (!page.hasCSP) {
    score -= 2; issues.push({ severity: 'notice', category: 'security', message: 'No Content-Security-Policy header — adds XSS protection layer', deduction: 2 });
  }

  // ── PAGE SPEED ────────────────────────────────────────────────────────────
  if (page.fetchTimeMs > 2000) {
    score -= 15; issues.push({ severity: 'critical', category: 'speed', message: `Very slow TTFB: ${(page.fetchTimeMs / 1000).toFixed(1)}s — users and Google both penalise this`, deduction: 15 });
  } else if (page.fetchTimeMs > 800) {
    score -= 5; issues.push({ severity: 'warning', category: 'speed', message: `Slow server response: ${(page.fetchTimeMs / 1000).toFixed(1)}s — target under 800ms`, deduction: 5 });
  }
  if (page.htmlSizeKb > 200) {
    score -= 15; issues.push({ severity: 'critical', category: 'speed', message: `Extremely large page (${page.htmlSizeKb}KB) — significant speed impact`, deduction: 15 });
  } else if (page.htmlSizeKb > 100) {
    score -= 5; issues.push({ severity: 'warning', category: 'speed', message: `Large page size (${page.htmlSizeKb}KB) — compress and minify HTML`, deduction: 5 });
  }
  if (page.renderBlockingScripts >= 3) {
    score -= 15; issues.push({ severity: 'critical', category: 'speed', message: `${page.renderBlockingScripts} render-blocking scripts in <head> — seriously impacts load speed`, deduction: 15 });
  } else if (page.renderBlockingScripts >= 1) {
    score -= 5; issues.push({ severity: 'warning', category: 'speed', message: `${page.renderBlockingScripts} render-blocking script${page.renderBlockingScripts > 1 ? 's' : ''} slow page display`, deduction: 5 });
  }
  if (page.images > 0 && page.imagesWithoutLazy > 0) {
    score -= 5; issues.push({ severity: 'warning', category: 'speed', message: `${page.imagesWithoutLazy} image${page.imagesWithoutLazy !== 1 ? 's' : ''} not lazy loaded — slows initial page render`, deduction: 5 });
  }
  if (!page.hasViewport) {
    score -= 15; issues.push({ severity: 'critical', category: 'speed', message: 'No viewport meta tag — site broken on mobile and demoted by Google', deduction: 15 });
  }
  if (!page.isCompressed) {
    score -= 5; issues.push({ severity: 'warning', category: 'speed', message: 'No GZIP/Brotli compression — enable to reduce transfer size', deduction: 5 });
  }

  // ── AI SEARCH VISIBILITY ──────────────────────────────────────────────────
  if (!page.hasFaqSchema) {
    score -= 5; issues.push({ severity: 'warning', category: 'ai', message: 'Missing FAQ schema — reduces chance of AI Overview and People Also Ask inclusion', deduction: 5 });
  }
  if (!page.hasArticleSchema && page.wordCount > 300) {
    score -= 5; issues.push({ severity: 'warning', category: 'ai', message: 'Missing Article schema with datePublished — AI models deprioritise undated content', deduction: 5 });
  }
  if (!page.hasPersonSchema) {
    score -= 5; issues.push({ severity: 'warning', category: 'ai', message: 'No author schema (Person) — EEAT signal missing for AI citations', deduction: 5 });
  }
  if (!page.hasQAStructure && page.wordCount > 200) {
    score -= 2; issues.push({ severity: 'notice', category: 'ai', message: 'No Q&A heading structure — AI models prefer pages that directly answer questions', deduction: 2 });
  }
  if (!page.hasSpeakableSchema) {
    score -= 2; issues.push({ severity: 'notice', category: 'ai', message: 'No speakable schema — missed opportunity for voice search and AI audio responses', deduction: 2 });
  }
  if (!page.hasBreadcrumbSchema) {
    score -= 2; issues.push({ severity: 'notice', category: 'ai', message: 'Missing breadcrumb schema — reduces site structure clarity for AI crawlers', deduction: 2 });
  }
  const isHowToPage = /how[-\s]?to/i.test(`${page.url} ${page.title} ${page.h1}`);
  if (isHowToPage && !page.hasHowToSchema) {
    score -= 2; issues.push({ severity: 'notice', category: 'ai', message: 'HowTo page without HowTo schema — AI search engines prioritise structured how-to answers', deduction: 2 });
  }

  // ── LINK HEALTH ───────────────────────────────────────────────────────────
  if (page.internalLinks === 0) {
    score -= 15; issues.push({ severity: 'critical', category: 'links', message: 'No internal links — page is orphaned, Google cannot distribute authority', deduction: 15 });
  } else if (page.internalLinks <= 2) {
    score -= 5; issues.push({ severity: 'warning', category: 'links', message: `Only ${page.internalLinks} internal link${page.internalLinks !== 1 ? 's' : ''} — add more to improve crawlability`, deduction: 5 });
  }
  if (page.externalLinks === 0 && page.wordCount > 300) {
    score -= 5; issues.push({ severity: 'warning', category: 'links', message: 'No outbound links — citing sources builds EEAT trust', deduction: 5 });
  }
  if (page.poorAnchorTextCount > 0) {
    score -= 5; issues.push({ severity: 'warning', category: 'links', message: `${page.poorAnchorTextCount} link${page.poorAnchorTextCount !== 1 ? 's' : ''} with generic anchor text — use descriptive keywords`, deduction: 5 });
  }

  // ── MOBILE & UX ───────────────────────────────────────────────────────────
  if (page.imagesWithoutDimensions > 0 && page.images > 0) {
    score -= 5; issues.push({ severity: 'warning', category: 'mobile', message: `${page.imagesWithoutDimensions} image${page.imagesWithoutDimensions !== 1 ? 's' : ''} missing width/height — causes layout shift (CLS)`, deduction: 5 });
  }
  if (!page.hasOgImage) {
    score -= 5; issues.push({ severity: 'warning', category: 'mobile', message: 'No og:image — poor appearance when shared on social media', deduction: 5 });
  }
  if (!page.hasOgTitle || !page.hasOgDescription) {
    score -= 5; issues.push({ severity: 'warning', category: 'mobile', message: 'Open Graph tags missing — pages look broken when shared on social media', deduction: 5 });
  }
  if (!page.hasTwitterCard) {
    score -= 2; issues.push({ severity: 'notice', category: 'mobile', message: 'No Twitter Card tags — no rich preview on X/Twitter', deduction: 2 });
  }
  if (!page.hasLangAttribute) {
    score -= 2; issues.push({ severity: 'notice', category: 'mobile', message: 'No lang attribute on <html> — search engines uncertain about target language', deduction: 2 });
  }

  // ── CONTENT DEPTH ─────────────────────────────────────────────────────────
  if (page.avgSentenceLength > 20 && page.wordCount > 200) {
    score -= 2; issues.push({ severity: 'notice', category: 'depth', message: `Long sentences (avg ${page.avgSentenceLength} words) — aim for under 20 words per sentence`, deduction: 2 });
  }
  if (page.hasHeadingHierarchyIssue) {
    score -= 5; issues.push({ severity: 'warning', category: 'depth', message: 'Broken heading hierarchy — H3 used without H2, use H1 → H2 → H3 in order', deduction: 5 });
  }
  if (page.paragraphCount < 3 && page.wordCount > 150) {
    score -= 5; issues.push({ severity: 'warning', category: 'depth', message: 'Very little paragraph structure — thin content formatting ranks poorly', deduction: 5 });
  }

  return { score: Math.max(0, score), issues, opportunities };
}
