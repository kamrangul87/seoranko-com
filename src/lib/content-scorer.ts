// Shared article scoring utilities — imported by all three article routes.
// Centralised here so logic doesn't drift between article-v2, article-improve, and article-competitor.

export function calculateEEATScore(html: string): number {
  let score = 0;
  const text = html.replace(/<[^>]+>/g, ' ');

  // Author byline present (+20)
  if (
    /Written by|By\s+[A-Z][a-z]+\s+[A-Z]|class=["'][^"']*byline|name=["']author/i.test(html) ||
    /"author"\s*:\s*\{/i.test(html)
  ) {
    score += 20;
  }
  // Author bio section (+20)
  if (/author-bio|About the Author|About [A-Z][a-z]+/i.test(html)) {
    score += 20;
  }
  // Person schema (+15)
  if (/"@type"\s*:\s*"Person"/i.test(html)) {
    score += 15;
  }
  // First-person experience language (+15)
  if (/\b(I've|I have|in my experience|what I'd|when I|my recommendation|I tested|I found|I use)\b/i.test(text)) {
    score += 15;
  }
  // Official source citations: gov.uk, .gov, .edu, named authorities (+15)
  if (
    /href=["'][^"']*(gov\.uk|\.gov|\.edu|nhs\.uk|who\.int|ons\.gov)[^"']*["']/i.test(html) ||
    /\b(according to|NHS|DVSA|HMRC|OFGEM|DVLA|ONS|GOV\.UK|BBC|Which\?|official)\b/i.test(text)
  ) {
    score += 15;
  }
  // dateModified or freshness signal (+15)
  if (/"dateModified"/i.test(html) || /last.?updated|updated\s+\w+\s+202[456]/i.test(text)) {
    score += 15;
  }

  return Math.min(100, score);
}

export function calculateReadabilityScore(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let score = 100;

  // Average sentence length — target 15-20 words
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length > 3) {
    const avgSentLen =
      sentences.reduce((s, sen) => s + sen.trim().split(/\s+/).length, 0) / sentences.length;
    if (avgSentLen > 30) score -= 20;
    else if (avgSentLen > 25) score -= 12;
    else if (avgSentLen > 20) score -= 5;
    else if (avgSentLen < 8) score -= 10;
  }

  // Paragraphs: penalise walls of text > 150 words in one <p>
  const pTags = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  const longParas = pTags.filter(
    m => m[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length > 150,
  ).length;
  if (longParas > 0) score -= Math.min(25, longParas * 8);

  // Heading distribution — H2 every 150-300 words is good
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
  if (wordCount > 200 && h2Count > 0) {
    const wordsPerH2 = wordCount / h2Count;
    if (wordsPerH2 > 500) score -= 15;
    else if (wordsPerH2 > 350) score -= 8;
  } else if (wordCount > 400 && h2Count === 0) {
    score -= 20;
  }

  // Flesch approximation: penalise avg syllables > 2 per word
  const words = text.split(/\s+/).filter(Boolean).slice(0, 500);
  if (words.length > 50) {
    const totalSyllables = words.reduce((s, w) => {
      const vowelGroups = w.toLowerCase().match(/[aeiouy]+/g) || [];
      return s + Math.max(1, vowelGroups.length);
    }, 0);
    const avgSyllables = totalSyllables / words.length;
    if (avgSyllables > 2.5) score -= 15;
    else if (avgSyllables > 2.0) score -= 8;
  }

  return Math.max(0, Math.min(100, score));
}

export function calculateKeywordDensity(html: string, keyword: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  if (totalWords === 0 || !keyword) return 0;

  const kw = keyword.toLowerCase().trim();
  const kwWords = kw.split(/\s+/);
  let count = 0;

  if (kwWords.length === 1) {
    // Single-word keyword: whole-word boundary match
    const wordRe = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    count = (text.match(wordRe) || []).length;
  } else {
    // Multi-word phrase: substring match across words
    const phraseRe = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    count = (text.match(phraseRe) || []).length;
  }

  return Math.round((count / totalWords) * 1000) / 10; // one decimal, as a percentage
}

export function scoreHtmlLocally(
  html: string,
  keyword: string,
): { searchScore: number; aiScore: number } {
  let search = 100;
  let ai = 100;

  // Search signals
  if (!/<h1/i.test(html)) search -= 15;
  if (!/<h2/i.test(html)) search -= 5;
  const metaMatch = html.match(/<!-- META:\s*([^-]+?)\s*-->/i);
  const metaLen = metaMatch ? metaMatch[1].trim().length : 0;
  if (metaLen < 70) search -= 10;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < 400) search -= 15;
  else if (wordCount < 700) search -= 5;
  if (!/"@type"\s*:\s*"Article"/i.test(html) && !/"@type"\s*:\s*"BlogPosting"/i.test(html)) search -= 10;
  if (!/application\/ld\+json/i.test(html)) search -= 10;

  // AI-optimisation signals
  if (!/"dateModified"/i.test(html)) ai -= 10;
  if (!/"datePublished"/i.test(html)) ai -= 5;

  const hasAuthor =
    /Written by|class=["'][^"']*byline|name=["']author/i.test(html) ||
    /"author"\s*:\s*\{/i.test(html);
  if (!hasAuthor) ai -= 10;
  if (!/"@type"\s*:\s*"Person"/i.test(html)) ai -= 5;
  if (!/author-bio|About the Author/i.test(html)) ai -= 5;
  if (!/"@type"\s*:\s*"FAQPage"/i.test(html)) ai -= 5;

  const headings = Array.from(html.matchAll(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/gi));
  const questionHeadings = headings.filter(m =>
    m[1].replace(/<[^>]+>/g, '').trim().endsWith('?'),
  ).length;
  if (questionHeadings < 2) ai -= 5;

  const pTags = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  const answerBlocks = pTags.filter(m => {
    const wc = m[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    return wc >= 134 && wc <= 167;
  }).length;
  if (answerBlocks < 2) ai -= 5;

  const sentences = text.slice(0, 8000).match(/[^.!?]+[.!?]+/g) || [];
  const factSentences = sentences.filter(s =>
    /\d+%|\$\d+|£\d+|\b\d{2,}\b|\d+,\d+/.test(s),
  ).length;
  const factDensity =
    sentences.length > 5 ? Math.round((factSentences / sentences.length) * 100) : 0;
  if (factDensity < 15) ai -= 5;

  if (/"@type"\s*:\s*"HowTo"/i.test(html) && !keyword.toLowerCase().includes('how')) ai -= 5;
  if (!/max-snippet:-1/i.test(html)) ai -= 3;

  return {
    searchScore: Math.max(0, Math.min(100, search)),
    aiScore: Math.max(0, Math.min(100, ai)),
  };
}
