/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AuditIssue {
  severity: 'critical' | 'warning' | 'notice';
  category: 'crawlability' | 'onpage' | 'technical' | 'content' | 'schema' | 'security' | 'speed' | 'ai' | 'links' | 'mobile' | 'depth';
  message: string;
  deduction: number;
  fix_type?: string;
  current_value?: string;
  fix_value?: string;
  fix_preview?: string;
  effort?: '2min' | '30min' | '1hour';
  auto_fixable?: boolean;
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
  // AI citability signals
  answerBlockCount: number;
  questionHeadingCount: number;
  factDensityScore: number;
  dateModifiedAge: number | null;
  hasAuthorByline: boolean;
  hasAuthorBio: boolean;
  deprecatedSchemas: string[];
  fetchError?: string;
}

export interface DomainSignals {
  blockedAiCrawlers: string[];
  hasLlmsTxt: boolean;
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
    answerBlockCount: 0, questionHeadingCount: 0, factDensityScore: 0,
    dateModifiedAge: null, hasAuthorByline: false, hasAuthorBio: false, deprecatedSchemas: [],
    ...extra,
  };
}

export async function fetchPageSignals(url: string): Promise<PageSignals> {
  const startTime = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEORANKO-Audit/1.0)' },
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
    const hasArticleSchema = /"@type"\s*:\s*"Article"/i.test(html) || /"@type"\s*:\s*"BlogPosting"/i.test(html) || /"@type"\s*:\s*"NewsArticle"/i.test(html);
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

    // ── AI CITABILITY SIGNALS ─────────────────────────────────────────────────

    // Answer blocks: <p> tags with 134-167 words
    const pTags = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
    let answerBlockCount = 0;
    for (const pm of pTags) {
      const pText = pm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const wc = pText.split(/\s+/).filter(Boolean).length;
      if (wc >= 134 && wc <= 167) answerBlockCount++;
    }

    // Question headings (h1-h6 ending with ?)
    const allHeadings = Array.from(html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi));
    const questionHeadingCount = allHeadings.filter(m =>
      m[1].replace(/<[^>]+>/g, '').trim().endsWith('?')
    ).length;

    // Fact density — % of sentences containing numbers/stats
    const sentencesAll = text.slice(0, 8000).match(/[^.!?]+[.!?]+/g) || [];
    const sentencesWithFacts = sentencesAll.filter(s =>
      /\d+%|\$\d+|£\d+|€\d+|\b\d{2,}\b|\d+,\d+/.test(s)
    );
    const factDensityScore = sentencesAll.length > 5
      ? Math.round((sentencesWithFacts.length / sentencesAll.length) * 100)
      : 0;

    // DateModified age from JSON-LD Article/BlogPosting/NewsArticle
    let dateModifiedAge: number | null = null;
    const jsonLdBlocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
    outer: for (const block of jsonLdBlocks) {
      try {
        const obj = JSON.parse(block[1]);
        const items = Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
        for (const item of items) {
          if (['Article', 'BlogPosting', 'NewsArticle', 'WebPage'].includes(item['@type'])) {
            const ds = item.dateModified || item.datePublished;
            if (ds) {
              const d = new Date(ds);
              if (!isNaN(d.getTime())) {
                dateModifiedAge = Math.floor((Date.now() - d.getTime()) / 86400000);
                break outer;
              }
            }
          }
        }
      } catch { /* skip */ }
    }

    // Author byline signals
    const hasAuthorByline =
      /name=["']author["'][^>]*content=["'][^"']+["']/i.test(html) ||
      /content=["'][^"']+["'][^>]*name=["']author["']/i.test(html) ||
      /class=["'][^"']*\b(?:byline|author-?name|post-?author|entry-?author)\b[^"']*["']/i.test(html) ||
      /rel=["']author["']/i.test(html) ||
      /"author"\s*:\s*\{/i.test(html) ||
      /"author"\s*:\s*"[^"]+"/i.test(html);

    const hasAuthorBio =
      /about the author/i.test(html) ||
      /class=["'][^"']*\b(?:author-?bio|author-?description|author-?box|author-?card|author-?info)\b[^"']*["']/i.test(html);

    // Deprecated schema types (as of 2026)
    const DEPRECATED_TYPES = ['HowTo', 'FAQPage', 'SpecialAnnouncement', 'ClaimReview'];
    const deprecatedSchemas = DEPRECATED_TYPES.filter(t =>
      new RegExp(`"@type"\\s*:\\s*"${t}"`, 'i').test(html)
    );

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
      answerBlockCount, questionHeadingCount, factDensityScore,
      dateModifiedAge, hasAuthorByline, hasAuthorBio, deprecatedSchemas,
    };
  } catch (err: any) {
    return emptyPage(url, { fetchTimeMs: Date.now() - startTime, fetchError: err.message?.slice(0, 100) });
  }
}

function attachFixes(issues: AuditIssue[], page: PageSignals): AuditIssue[] {
  const domain = (() => {
    try { return new URL(page.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  })();

  // Smart fix values derived from page signals
  const fixedTitle = (() => {
    if (!page.title) return page.h1?.slice(0, 55) || domain;
    // Trim to 55 chars at a word boundary
    const words = page.title.replace(/\s*[\|—\-]\s*.{10,}$/, '').trim().split(' ');
    let out = '';
    for (const w of words) {
      if ((out + ' ' + w).trim().length <= 55) out = (out + ' ' + w).trim();
      else break;
    }
    return out || page.title.slice(0, 55);
  })();

  const generatedMeta = (() => {
    const base = page.h1 || page.title || domain;
    return `${base.slice(0, 80)} — comprehensive guide covering everything you need to know. Read now.`.slice(0, 140);
  })();

  const fixedMeta = (() => {
    if (!page.metaDescription) return generatedMeta;
    if (page.metaDescription.length > 160) return page.metaDescription.slice(0, 157) + '...';
    if (page.metaDescription.length < 70) {
      const expanded = page.metaDescription + ' ' + (page.h1 || domain);
      return expanded.slice(0, 140);
    }
    return page.metaDescription;
  })();

  const h1Derived = page.title
    ? page.title.replace(/\s*[\|—\-]\s*.{5,}$/, '').trim().slice(0, 70)
    : (page.h2s?.[0] || domain);

  const canonicalFixed = page.url
    .replace(/^http:\/\//, 'https://')
    .replace(/\/\/www\./, '//')
    .replace(/\/$/, '');

  const minimalSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title || page.h1 || domain,
    url: page.url,
    datePublished: new Date().toISOString().slice(0, 10),
    dateModified: new Date().toISOString().slice(0, 10),
    author: { '@type': 'Person', name: 'Author' },
    publisher: { '@type': 'Organization', name: domain },
  }, null, 2);

  return issues.map(issue => {
    const msg = issue.message;
    let fix_type: string | undefined;
    let current_value: string | undefined;
    let fix_value: string | undefined;
    let fix_preview: string | undefined;
    let effort: '2min' | '30min' | '1hour';
    let auto_fixable = false;

    // ── Title issues ──────────────────────────────────────────────────────────
    if (msg.startsWith('Missing title tag')) {
      fix_type = 'meta_title'; effort = '2min'; auto_fixable = true;
      current_value = ''; fix_value = h1Derived || domain;
      fix_preview = `Set title to "${fix_value}"`;
    } else if (msg.startsWith('Title too long')) {
      fix_type = 'meta_title'; effort = '2min'; auto_fixable = true;
      current_value = page.title;
      fix_value = fixedTitle;
      fix_preview = `Change from "${page.title.slice(0, 35)}..." to "${fixedTitle}"`;
    } else if (msg.startsWith('Title too short')) {
      fix_type = 'meta_title'; effort = '2min'; auto_fixable = true;
      current_value = page.title;
      fix_value = (page.title + (page.h2s?.[0] ? ` — ${page.h2s[0].slice(0, 20)}` : '')).slice(0, 60);
      fix_preview = `Expand to "${fix_value}"`;
    }
    // ── Meta description issues ───────────────────────────────────────────────
    else if (msg.startsWith('Missing meta description')) {
      fix_type = 'meta_description'; effort = '2min'; auto_fixable = true;
      current_value = ''; fix_value = generatedMeta;
      fix_preview = `Add: "${generatedMeta.slice(0, 60)}..."`;
    } else if (msg.startsWith('Meta description too long')) {
      fix_type = 'meta_description'; effort = '2min'; auto_fixable = true;
      current_value = page.metaDescription;
      fix_value = page.metaDescription.slice(0, 157) + '...';
      fix_preview = `Trim to "${fix_value.slice(0, 50)}..."`;
    } else if (msg.startsWith('Meta description too short')) {
      fix_type = 'meta_description'; effort = '2min'; auto_fixable = true;
      current_value = page.metaDescription;
      fix_value = fixedMeta;
      fix_preview = `Expand to "${fixedMeta.slice(0, 60)}..."`;
    }
    // ── Canonical ─────────────────────────────────────────────────────────────
    else if (msg.startsWith('No canonical tag')) {
      fix_type = 'canonical'; effort = '2min'; auto_fixable = true;
      current_value = ''; fix_value = canonicalFixed;
      fix_preview = `Add canonical: "${canonicalFixed}"`;
    } else if (msg.startsWith('Canonical points off-site')) {
      fix_type = 'canonical'; effort = '2min'; auto_fixable = true;
      current_value = page.canonicalUrl;
      fix_value = canonicalFixed;
      fix_preview = `Change canonical to "${canonicalFixed}"`;
    }
    // ── H1 ───────────────────────────────────────────────────────────────────
    else if (msg.startsWith('Missing H1')) {
      fix_type = 'h1'; effort = '30min'; auto_fixable = true;
      current_value = ''; fix_value = h1Derived;
      fix_preview = `Add H1: "${h1Derived}"`;
    } else if (msg.startsWith('Multiple H1')) {
      fix_type = 'h1'; effort = '30min'; auto_fixable = false;
      effort = '30min';
    }
    // ── Open Graph ───────────────────────────────────────────────────────────
    else if (msg.includes('Open Graph')) {
      fix_type = 'og_title'; effort = '2min'; auto_fixable = true;
      current_value = ''; fix_value = fixedTitle || page.title;
      fix_preview = `Add og:title="${fix_value}" and og:description`;
    } else if (msg.includes('og:image')) {
      fix_type = 'og_image'; effort = '2min'; auto_fixable = false;
    }
    // ── Twitter ───────────────────────────────────────────────────────────────
    else if (msg.includes('Twitter Card')) {
      effort = '2min'; auto_fixable = false;
    }
    // ── Schema ───────────────────────────────────────────────────────────────
    else if (msg.startsWith('No structured data')) {
      fix_type = 'schema'; effort = '30min'; auto_fixable = true;
      current_value = ''; fix_value = minimalSchema;
      fix_preview = 'Add Article JSON-LD schema with datePublished and author';
    } else if (msg.includes('BreadcrumbList schema') || msg.includes('breadcrumb')) {
      effort = '30min'; auto_fixable = false;
    } else if (msg.includes('FAQPage schema') || msg.startsWith('FAQ content')) {
      effort = '30min'; auto_fixable = false;
    }
    // ── Technical / speed ────────────────────────────────────────────────────
    else if (msg.includes('viewport')) {
      effort = '2min'; auto_fixable = false;
    } else if (msg.includes('lang attribute')) {
      effort = '2min'; auto_fixable = false;
    } else if (msg.includes('noindex') || msg.includes('Noindex') || msg.includes('X-Robots-Tag')) {
      effort = '2min'; auto_fixable = false;
    } else if (msg.includes('HSTS') || msg.includes('X-Frame') || msg.includes('X-Content-Type') || msg.includes('Content-Security-Policy')) {
      effort = '1hour'; auto_fixable = false;
    } else if (msg.includes('render-blocking') || msg.includes('GZIP') || msg.includes('Brotli')) {
      effort = '1hour'; auto_fixable = false;
    } else if (msg.includes('slow') || msg.includes('TTFB') || msg.includes('page size') || msg.includes('large page') || msg.includes('Large page')) {
      effort = '1hour'; auto_fixable = false;
    } else if (msg.includes('lazy loaded') || msg.includes('width/height') || msg.includes('layout shift')) {
      effort = '1hour'; auto_fixable = false;
    }
    // ── Content ───────────────────────────────────────────────────────────────
    else if (msg.startsWith('Thin content') || msg.startsWith('Low word count')) {
      effort = '1hour'; auto_fixable = false;
    } else if (msg.includes('No images') || msg.includes('images missing')) {
      effort = '1hour'; auto_fixable = false;
    } else if (msg.includes('official source') || msg.includes('EEAT')) {
      effort = '1hour'; auto_fixable = false;
    }
    // ── Links ────────────────────────────────────────────────────────────────
    else if (msg.includes('internal link') || msg.includes('outbound link') || msg.includes('anchor text')) {
      effort = '30min'; auto_fixable = false;
    }
    // ── AI / GEO issues ──────────────────────────────────────────────────────
    else if (msg.includes('blocked in robots.txt')) {
      effort = '30min'; auto_fixable = false;
    } else if (msg.includes('llms.txt')) {
      effort = '2min'; auto_fixable = false;
    } else if (msg.includes('Article schema') || msg.includes('dateModified') || msg.includes('author byline') || msg.includes('Person schema')) {
      effort = '30min'; auto_fixable = false;
    } else if (msg.includes('answer-length') || msg.includes('fact density') || msg.includes('question heading')) {
      effort = '1hour'; auto_fixable = false;
    } else if (msg.includes('Deprecated schema')) {
      effort = '30min'; auto_fixable = false;
    }
    // ── Default ───────────────────────────────────────────────────────────────
    else {
      effort = '30min'; auto_fixable = false;
    }

    return {
      ...issue,
      ...(fix_type !== undefined ? { fix_type } : {}),
      ...(current_value !== undefined ? { current_value } : {}),
      ...(fix_value !== undefined ? { fix_value } : {}),
      ...(fix_preview !== undefined ? { fix_preview } : {}),
      effort,
      auto_fixable,
    };
  });
}

export function scorePage(
  page: PageSignals,
  allPages: PageSignals[],
  domainSignals: DomainSignals = { blockedAiCrawlers: [], hasLlmsTxt: false }
): {
  score: number;
  searchScore: number;
  aiScore: number;
  issues: AuditIssue[];
  opportunities: string[];
} {
  if (page.fetchError && page.wordCount === 0) {
    const is404 = page.httpStatus === 404;
    return {
      score: is404 ? 30 : 20,
      searchScore: is404 ? 30 : 20,
      aiScore: is404 ? 20 : 10,
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

  let searchScore = 100;
  let aiScore = 100;
  const issues: AuditIssue[] = [];
  const opportunities: string[] = [];

  // Search-score deductions
  const sCrit = (category: AuditIssue['category'], message: string, ded = 15) => {
    searchScore = Math.max(0, searchScore - ded);
    issues.push({ severity: 'critical', category, message, deduction: ded });
  };
  const sWarn = (category: AuditIssue['category'], message: string, ded = 5) => {
    searchScore = Math.max(0, searchScore - ded);
    issues.push({ severity: 'warning', category, message, deduction: ded });
  };
  const sNote = (category: AuditIssue['category'], message: string, ded = 2) => {
    searchScore = Math.max(0, searchScore - ded);
    issues.push({ severity: 'notice', category, message, deduction: ded });
  };

  // AI-score deductions
  const aCrit = (message: string, ded = 15) => {
    aiScore = Math.max(0, aiScore - ded);
    issues.push({ severity: 'critical', category: 'ai', message, deduction: ded });
  };
  const aWarn = (message: string, ded = 5) => {
    aiScore = Math.max(0, aiScore - ded);
    issues.push({ severity: 'warning', category: 'ai', message, deduction: ded });
  };
  const aNote = (message: string, ded = 2) => {
    aiScore = Math.max(0, aiScore - ded);
    issues.push({ severity: 'notice', category: 'ai', message, deduction: ded });
  };

  // ── CRAWLABILITY ─────────────────────────────────────────────────────────
  if (page.noindex) {
    sCrit('crawlability', 'Noindex meta tag — page is blocked from Google\'s index');
    opportunities.push('Remove noindex if this page should rank');
  }
  if (page.xRobotsNoindex) {
    sCrit('crawlability', 'X-Robots-Tag: noindex in HTTP headers — Google cannot index this page');
    opportunities.push('Remove X-Robots-Tag noindex from server headers');
  }
  if (!page.isHttps) {
    sCrit('crawlability', 'Served over HTTP — Google demotes non-HTTPS pages');
    opportunities.push('Migrate to HTTPS — required for ranking and security');
  }
  if (!page.hasCanonical) {
    sWarn('crawlability', 'No canonical tag — Google may consolidate wrong URL variants');
    opportunities.push('Add <link rel="canonical"> pointing to the preferred URL');
  } else if (page.canonicalUrl) {
    let canonHost = '';
    try { canonHost = new URL(page.canonicalUrl).hostname; } catch { /* skip */ }
    let pageHost = '';
    try { pageHost = new URL(page.url).hostname; } catch { /* skip */ }
    if (canonHost && pageHost && canonHost !== pageHost) {
      sWarn('crawlability', `Canonical points off-site to ${page.canonicalUrl.slice(0, 60)}`);
      opportunities.push('Verify canonical URL is correct — currently points to a different domain');
    }
  }

  // ── ON-PAGE SEO ──────────────────────────────────────────────────────────
  if (!page.title) {
    sCrit('onpage', 'Missing title tag — fundamental SEO requirement');
    opportunities.push('Add a keyword-rich title tag under 60 characters');
  } else {
    const tl = page.title.length;
    if (tl < 30) {
      sWarn('onpage', `Title too short (${tl} chars) — add more context and keyword`);
      opportunities.push('Expand title to 50-60 characters with your primary keyword');
    } else if (tl > 60) {
      sWarn('onpage', `Title too long (${tl} chars) — will be truncated in Google results`);
      opportunities.push('Shorten title to under 60 characters');
    }
  }

  if (!page.metaDescription) {
    sCrit('onpage', 'Missing meta description — reduces click-through rate from search results');
    opportunities.push('Write a compelling meta description of 140-160 characters');
  } else {
    const ml = page.metaDescription.length;
    if (ml < 70) {
      sWarn('onpage', `Meta description too short (${ml} chars)`);
      opportunities.push('Expand meta description to 140-160 characters with keyword and CTA');
    } else if (ml > 160) {
      sWarn('onpage', `Meta description too long (${ml} chars) — will be truncated`);
      opportunities.push('Shorten meta description to under 160 characters');
    }
  }

  if (!page.h1) {
    sCrit('onpage', 'Missing H1 — critical for keyword targeting');
    opportunities.push('Add a descriptive H1 tag that includes your target keyword');
  } else if (page.h1Count > 1) {
    sWarn('onpage', `Multiple H1 tags (${page.h1Count}) — confuses Google's understanding of the primary topic`);
    opportunities.push('Keep only one H1 per page — use H2s for sub-sections');
  }

  if (page.h2s.length === 0 && page.wordCount > 200) {
    sWarn('onpage', 'No H2 headings — poor content structure for SEO');
    opportunities.push('Add at least 4-5 H2 headings to structure your content');
  } else if (page.h2s.length < 3 && page.wordCount > 600) {
    sNote('onpage', `Only ${page.h2s.length} H2 heading${page.h2s.length !== 1 ? 's' : ''} for a ${page.wordCount}-word page`);
    opportunities.push('Add more H2 sections for comprehensive topic coverage');
  }

  if (page.imagesWithoutAlt > 0) {
    sWarn('onpage', `${page.imagesWithoutAlt} image${page.imagesWithoutAlt !== 1 ? 's' : ''} missing alt text`);
    opportunities.push('Add descriptive alt text to all images for accessibility and image SEO');
  }

  // Duplicate title/meta detection
  const dupTitles = allPages.filter(p => p.url !== page.url && p.title && p.title === page.title);
  if (dupTitles.length > 0) {
    sWarn('onpage', `Duplicate title — identical to ${dupTitles.length} other page${dupTitles.length > 1 ? 's' : ''}`);
    opportunities.push('Write a unique title for every page');
  }
  const dupMetas = allPages.filter(p => p.url !== page.url && p.metaDescription && p.metaDescription === page.metaDescription);
  if (dupMetas.length > 0) {
    sWarn('onpage', `Duplicate meta description — identical to ${dupMetas.length} other page${dupMetas.length > 1 ? 's' : ''}`);
    opportunities.push('Write a unique meta description for every page');
  }

  // ── CONTENT ──────────────────────────────────────────────────────────────
  if (page.wordCount < 150) {
    sCrit('content', `Thin content: only ${page.wordCount} words — Google actively demotes thin pages`);
    opportunities.push('Expand this page to at least 800 words of substantive content');
  } else if (page.wordCount < 300) {
    sWarn('content', `Low word count: ${page.wordCount} words — below minimum for competitive ranking`);
    opportunities.push('Expand content to at least 800 words with comprehensive coverage');
  } else if (page.wordCount < 800) {
    sNote('content', `${page.wordCount} words — top-ranking pages for competitive keywords average 1,500+`);
    opportunities.push('Consider expanding to 1,200+ words to beat competitors');
  }

  if (!page.hasOfficialSources && page.wordCount > 300) {
    sWarn('content', 'No official source citations — weak EEAT trust signals');
    opportunities.push('Cite at least 2 official sources (gov.uk, NHS, authoritative bodies)');
  }

  if (page.images === 0 && page.wordCount > 300) {
    sWarn('content', 'No images — reduces engagement and visual search visibility');
    opportunities.push('Add 2-3 relevant images with descriptive alt text');
  }

  // ── SCHEMA ───────────────────────────────────────────────────────────────
  if (!page.hasSchema) {
    sCrit('schema', 'No structured data — missing rich result eligibility');
    opportunities.push('Add Article and FAQ JSON-LD schema to unlock rich snippets');
  } else {
    if (!page.hasBreadcrumbSchema) {
      sNote('schema', 'No BreadcrumbList schema — missing breadcrumb in SERPs');
      opportunities.push('Add BreadcrumbList schema to show site navigation in Google results');
    }
  }

  // ── SECURITY ─────────────────────────────────────────────────────────────
  if (page.isHttps && !page.hasHsts) {
    searchScore = Math.max(0, searchScore - 15);
    issues.push({ severity: 'critical', category: 'security', message: 'No HSTS header — site vulnerable to downgrade attacks', deduction: 15 });
  }
  if (!page.hasXFrameOptions) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'security', message: 'No X-Frame-Options header — clickjacking protection missing', deduction: 5 });
  }
  if (!page.hasXContentTypeOptions) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'security', message: 'Missing X-Content-Type-Options header — browsers may sniff MIME types', deduction: 5 });
  }
  if (!page.hasCSP) {
    searchScore = Math.max(0, searchScore - 2);
    issues.push({ severity: 'notice', category: 'security', message: 'No Content-Security-Policy header — adds XSS protection layer', deduction: 2 });
  }

  // ── PAGE SPEED ────────────────────────────────────────────────────────────
  if (page.fetchTimeMs > 2000) {
    searchScore = Math.max(0, searchScore - 15);
    issues.push({ severity: 'critical', category: 'speed', message: `Very slow TTFB: ${(page.fetchTimeMs / 1000).toFixed(1)}s — users and Google both penalise this`, deduction: 15 });
  } else if (page.fetchTimeMs > 800) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'speed', message: `Slow server response: ${(page.fetchTimeMs / 1000).toFixed(1)}s — target under 800ms`, deduction: 5 });
  }
  if (page.htmlSizeKb > 200) {
    searchScore = Math.max(0, searchScore - 15);
    issues.push({ severity: 'critical', category: 'speed', message: `Extremely large page (${page.htmlSizeKb}KB) — significant speed impact`, deduction: 15 });
  } else if (page.htmlSizeKb > 100) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'speed', message: `Large page size (${page.htmlSizeKb}KB) — compress and minify HTML`, deduction: 5 });
  }
  if (page.renderBlockingScripts >= 3) {
    searchScore = Math.max(0, searchScore - 15);
    issues.push({ severity: 'critical', category: 'speed', message: `${page.renderBlockingScripts} render-blocking scripts in <head> — seriously impacts load speed`, deduction: 15 });
  } else if (page.renderBlockingScripts >= 1) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'speed', message: `${page.renderBlockingScripts} render-blocking script${page.renderBlockingScripts > 1 ? 's' : ''} slow page display`, deduction: 5 });
  }
  if (page.images > 0 && page.imagesWithoutLazy > 0) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'speed', message: `${page.imagesWithoutLazy} image${page.imagesWithoutLazy !== 1 ? 's' : ''} not lazy loaded — slows initial page render`, deduction: 5 });
  }
  if (!page.hasViewport) {
    searchScore = Math.max(0, searchScore - 15);
    issues.push({ severity: 'critical', category: 'speed', message: 'No viewport meta tag — site broken on mobile and demoted by Google', deduction: 15 });
  }
  if (!page.isCompressed) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'speed', message: 'No GZIP/Brotli compression — enable to reduce transfer size', deduction: 5 });
  }

  // ── LINK HEALTH ───────────────────────────────────────────────────────────
  if (page.internalLinks === 0) {
    sCrit('links', 'No internal links — page is orphaned, Google cannot distribute authority');
  } else if (page.internalLinks <= 2) {
    sWarn('links', `Only ${page.internalLinks} internal link${page.internalLinks !== 1 ? 's' : ''} — add more to improve crawlability`);
  }
  if (page.externalLinks === 0 && page.wordCount > 300) {
    sWarn('links', 'No outbound links — citing sources builds EEAT trust');
  }
  if (page.poorAnchorTextCount > 0) {
    sWarn('links', `${page.poorAnchorTextCount} link${page.poorAnchorTextCount !== 1 ? 's' : ''} with generic anchor text — use descriptive keywords`);
  }

  // ── MOBILE & UX ───────────────────────────────────────────────────────────
  if (page.imagesWithoutDimensions > 0 && page.images > 0) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'mobile', message: `${page.imagesWithoutDimensions} image${page.imagesWithoutDimensions !== 1 ? 's' : ''} missing width/height — causes layout shift (CLS)`, deduction: 5 });
  }
  if (!page.hasOgImage) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'mobile', message: 'No og:image — poor appearance when shared on social media', deduction: 5 });
  }
  if (!page.hasOgTitle || !page.hasOgDescription) {
    searchScore = Math.max(0, searchScore - 5);
    issues.push({ severity: 'warning', category: 'mobile', message: 'Open Graph tags missing — pages look broken when shared on social media', deduction: 5 });
  }
  if (!page.hasTwitterCard) {
    searchScore = Math.max(0, searchScore - 2);
    issues.push({ severity: 'notice', category: 'mobile', message: 'No Twitter Card tags — no rich preview on X/Twitter', deduction: 2 });
  }
  if (!page.hasLangAttribute) {
    searchScore = Math.max(0, searchScore - 2);
    issues.push({ severity: 'notice', category: 'mobile', message: 'No lang attribute on <html> — search engines uncertain about target language', deduction: 2 });
  }

  // ── CONTENT DEPTH ─────────────────────────────────────────────────────────
  if (page.avgSentenceLength > 20 && page.wordCount > 200) {
    sNote('depth', `Long sentences (avg ${page.avgSentenceLength} words) — aim for under 20 words per sentence`);
  }
  if (page.hasHeadingHierarchyIssue) {
    sWarn('depth', 'Broken heading hierarchy — H3 used without H2, use H1 → H2 → H3 in order');
  }
  if (page.paragraphCount < 3 && page.wordCount > 150) {
    sWarn('depth', 'Very little paragraph structure — thin content formatting ranks poorly');
  }

  // ── AI SEARCH VISIBILITY ──────────────────────────────────────────────────

  // 1. AI crawler access (robots.txt)
  for (const bot of domainSignals.blockedAiCrawlers) {
    aCrit(`${bot} blocked in robots.txt — AI engine cannot crawl or cite this site`, 15);
    opportunities.push(`Remove Disallow: / for ${bot} in robots.txt to allow AI citation`);
  }

  // 2. llms.txt
  if (!domainSignals.hasLlmsTxt) {
    aNote('No llms.txt file — AI models lack a structured content guide for this site', 5);
    opportunities.push('Create /llms.txt with site overview and key content sections (use the Generate button)');
  }

  // 3. Article schema with dateModified (content freshness for AI)
  if (!page.hasArticleSchema && page.wordCount > 300) {
    aWarn('Missing Article schema with dateModified — AI models deprioritise undated or unstructured content', 10);
    opportunities.push('Add Article JSON-LD with author, datePublished, dateModified fields');
  } else if (page.hasArticleSchema && page.dateModifiedAge !== null) {
    if (page.dateModifiedAge > 90) {
      aWarn(`Content not updated in ${page.dateModifiedAge} days — AI engines prioritise fresh content`, 10);
      opportunities.push('Update dateModified in your Article schema and refresh the content');
    } else if (page.dateModifiedAge > 30) {
      aNote(`Content updated ${page.dateModifiedAge} days ago — aim for updates within 30 days`, 5);
      opportunities.push('Refresh article content and update dateModified in schema');
    }
  } else if (page.hasArticleSchema && page.dateModifiedAge === null) {
    aNote('Article schema missing dateModified — AI models prefer explicitly dated content', 3);
    opportunities.push('Add dateModified to your Article JSON-LD schema');
  }

  // 4. Passage citability — answer blocks
  if (page.wordCount > 300 && page.answerBlockCount < 2) {
    aWarn(`Only ${page.answerBlockCount} answer-length passage${page.answerBlockCount !== 1 ? 's' : ''} (134-167 words) — AI engines extract citable passages from this range`, 5);
    opportunities.push('Write 2+ focused paragraphs of 134-167 words that directly answer user questions');
  }

  // 5. Passage citability — question headings
  if (page.wordCount > 300 && page.questionHeadingCount < 2) {
    aWarn(`Only ${page.questionHeadingCount} question heading${page.questionHeadingCount !== 1 ? 's' : ''} (ending with ?) — AI engines prefer Q&A structure`, 5);
    opportunities.push('Add 2+ headings phrased as questions (e.g. "How does X work?") to improve AI citation');
  }

  // 6. Fact density
  if (page.wordCount > 300 && page.factDensityScore < 20) {
    aWarn(`Low fact density (${page.factDensityScore}% of sentences contain data) — AI engines favour evidence-based content`, 5);
    opportunities.push('Add statistics, percentages, and specific numbers to strengthen factual credibility');
  }

  // 7. E-E-A-T: Author byline
  if (!page.hasAuthorByline && page.wordCount > 300) {
    aWarn('No author byline detected — E-E-A-T signal missing for AI citation ranking', 10);
    opportunities.push('Add a visible author name with <meta name="author"> and a Person schema block');
  }

  // 8. E-E-A-T: Author bio
  if (page.hasAuthorByline && !page.hasAuthorBio) {
    aNote('Author credited but no bio section found — add credentials to strengthen E-E-A-T', 3);
    opportunities.push('Add an "About the Author" section with qualifications and expertise');
  }

  // 9. Person schema
  if (!page.hasPersonSchema && page.wordCount > 300) {
    aWarn('No Person schema — AI systems cannot verify author expertise (E-E-A-T)', 5);
    opportunities.push('Add Person JSON-LD schema with author name, jobTitle, and sameAs links');
  }

  // 10. Deprecated schema warnings
  for (const schemaType of page.deprecatedSchemas) {
    const deprecationNote = schemaType === 'HowTo'
      ? 'HowTo rich results removed Sept 2023'
      : schemaType === 'FAQPage'
      ? 'FAQPage rich results removed May 2026'
      : `${schemaType} deprecated`;
    aWarn(`Deprecated schema type "${schemaType}" (${deprecationNote}) — may signal outdated SEO practices to AI crawlers`, 5);
    opportunities.push(`Remove or replace ${schemaType} schema — use Article + Q&A headings instead`);
  }

  // 11. FAQ schema
  if (!page.hasFaqSchema && page.hasFaq) {
    aNote('FAQ content found but no FAQPage schema — missing structured Q&A signal for AI', 3);
    opportunities.push('Add FAQPage JSON-LD schema to target People Also Ask and AI answer boxes');
  }

  // 12. Q&A heading structure
  if (!page.hasQAStructure && page.wordCount > 200) {
    aNote('No Q&A heading structure — AI models prefer pages that directly answer questions', 2);
    opportunities.push('Add H2/H3 headings phrased as questions to improve AI overview inclusion');
  }

  // 13. Speakable schema
  if (!page.hasSpeakableSchema) {
    aNote('No speakable schema — missed opportunity for voice search and AI audio responses', 2);
    opportunities.push('Add SpeakableSpecification schema to key answer paragraphs');
  }

  // 14. Breadcrumb schema for AI context
  if (!page.hasBreadcrumbSchema) {
    aNote('Missing breadcrumb schema — reduces site structure clarity for AI crawlers', 2);
  }

  // 15. HowTo page schema (deprecated, warn if still present is handled above, flag if missing old way)
  const isHowToPage = /how[-\s]?to/i.test(`${page.url} ${page.title} ${page.h1}`);
  if (isHowToPage && !page.hasHowToSchema && !page.deprecatedSchemas.includes('HowTo')) {
    aNote('How-to page — use numbered steps in content and Article schema instead of deprecated HowTo schema', 2);
    opportunities.push('Structure how-to content as numbered steps within Article schema (HowTo rich results removed Sept 2023)');
  }

  return {
    score: Math.max(0, searchScore),
    searchScore: Math.max(0, searchScore),
    aiScore: Math.max(0, aiScore),
    issues: attachFixes(issues, page),
    opportunities,
  };
}
