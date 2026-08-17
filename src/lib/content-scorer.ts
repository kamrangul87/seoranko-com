// Shared article scoring utilities — imported by all three article routes.
// Centralised here so logic doesn't drift between article-v2, article-improve, and article-competitor.

import Anthropic from '@anthropic-ai/sdk';
import { MODEL_FOR } from '@/lib/model-router';
import { extractMetaComment } from '@/lib/extract-meta-description';

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

export interface KeywordDensityDetail {
  density: number;            // percentage, e.g. 1.2 meaning 1.2%
  occurrences: number;        // raw match count for the keyword/phrase
  totalWords: number;
  score: number;              // 0-100 quality score derived from density (NOT the raw percentage)
  possibleScoringBug: boolean; // score looks broken given how often the keyword actually appears
}

function countKeywordOccurrences(text: string, keyword: string): number {
  const kw = keyword.toLowerCase().trim();
  const kwWords = kw.split(/\s+/);
  if (kwWords.length === 1) {
    // Single-word keyword: whole-word boundary match
    const wordRe = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    return (text.match(wordRe) || []).length;
  }
  // Multi-word phrase: substring match across words
  const phraseRe = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return (text.match(phraseRe) || []).length;
}

// Density itself isn't a 0-100 "quality" number — 0.5%-2.5% is the
// industry-standard healthy range, so it needs its own scoring curve
// rather than being displayed as-is against a /100 ring (that mismatch
// was the "7/100" bug: a healthy 0.7% density rendered as if it were a
// near-zero score).
export function keywordDensityScore(densityPct: number): number {
  if (densityPct <= 0) return 0;
  const IDEAL_MIN = 0.5;
  const IDEAL_MAX = 2.5;
  if (densityPct >= IDEAL_MIN && densityPct <= IDEAL_MAX) return 100;
  if (densityPct < IDEAL_MIN) {
    return Math.round((densityPct / IDEAL_MIN) * 100);
  }
  // Above ideal — over-optimisation risk, taper down but don't collapse to 0
  const over = densityPct - IDEAL_MAX;
  return Math.max(20, Math.round(100 - over * 15));
}

export function analyzeKeywordDensity(html: string, keyword: string): KeywordDensityDetail {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  if (totalWords === 0 || !keyword) {
    return { density: 0, occurrences: 0, totalWords, score: 0, possibleScoringBug: false };
  }

  const occurrences = countKeywordOccurrences(text, keyword);
  const density = Math.round((occurrences / totalWords) * 1000) / 10; // one decimal, as a percentage
  const score = keywordDensityScore(density);
  const possibleScoringBug = score < 30 && occurrences >= 5;

  return { density, occurrences, totalWords, score, possibleScoringBug };
}

export function calculateKeywordDensity(html: string, keyword: string): number {
  return analyzeKeywordDensity(html, keyword).density;
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
  const metaText = extractMetaComment(html) || '';
  const metaLen = metaText.length;
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

// ── Score improvement functions ────────────────────────────────────────────────

export async function improveEEAT(
  html: string,
  currentScore: number,
): Promise<{ html: string; score: number; summary: string }> {
  const text = html.replace(/<[^>]+>/g, ' ');
  const missingSignals: string[] = [];

  const hasAuthorByline =
    /Written by|By\s+[A-Z][a-z]+\s+[A-Z]|class=["'][^"']*byline|name=["']author/i.test(html) ||
    /"author"\s*:\s*\{/i.test(html);
  const hasAuthorBio = /author-bio|About the Author|About [A-Z][a-z]+/i.test(html);
  const hasPersonSchema = /"@type"\s*:\s*"Person"/i.test(html);
  const hasFirstPerson = /\b(I've|I have|in my experience|what I'd|when I|my recommendation|I tested|I found|I use)\b/i.test(text);
  const hasOfficialSources =
    /href=["'][^"']*(gov\.uk|\.gov|\.edu|nhs\.uk|who\.int|ons\.gov)[^"']*["']/i.test(html) ||
    /\b(according to|NHS|DVSA|HMRC|OFGEM|DVLA|ONS|GOV\.UK|BBC|Which\?|official)\b/i.test(text);
  const hasFreshness = /"dateModified"/i.test(html) || /last.?updated|updated\s+\w+\s+202[456]/i.test(text);

  if (!hasAuthorByline) missingSignals.push('author byline — add "Written by [Expert Name], [Credential]" after the H1');
  if (!hasAuthorBio) missingSignals.push('author bio section — add <div class="author-bio"> with credentials at end of article');
  if (!hasPersonSchema) missingSignals.push('Person schema — add "@type":"Person" with name and credentials inside the JSON-LD script block');
  if (!hasFirstPerson) missingSignals.push('first-person experience language — insert 1-2 sentences like "In my experience..." or "I\'ve found that..."');
  if (!hasOfficialSources) missingSignals.push('official source citation — add a sentence referencing GOV.UK, NHS, or similar authority with a hyperlink');
  if (!hasFreshness) missingSignals.push('freshness signal — add "Last updated: [current month and year]" near the top');

  if (missingSignals.length === 0 || currentScore >= 90) {
    return { html, score: currentScore, summary: 'All EEAT signals already present' };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const res = await anthropic.messages.create({
    model: MODEL_FOR.scoreImprovement,
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `You are an SEO expert improving EEAT (Experience, Expertise, Authority, Trust) signals in an article.

Add ONLY the following missing signals to the article HTML below. Do not rewrite existing content.

MISSING SIGNALS TO ADD:
${missingSignals.map((s, i) => `${i + 1}. ${s}`).join('\n')}

ARTICLE HTML:
${html.slice(0, 7000)}

Return ONLY the complete updated HTML, no explanation.`,
    }],
  });

  const updatedHtml = res.content[0].type === 'text' ? res.content[0].text.trim() : html;
  const newScore = calculateEEATScore(updatedHtml);
  const added = missingSignals.slice(0, 3).map(s => s.split(' — ')[0]).join(', ');

  return { html: updatedHtml, score: newScore, summary: `Added: ${added}` };
}

export async function improveReadability(
  html: string,
  currentScore: number,
): Promise<{ html: string; score: number; summary: string }> {
  if (currentScore >= 90) {
    return { html, score: currentScore, summary: 'Readability already excellent' };
  }

  // Find long paragraphs (> 100 words) — these are the main readability killer
  const pTags = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  const longParas = pTags
    .map(m => ({ full: m[0], text: m[1].replace(/<[^>]+>/g, ' ').trim() }))
    .filter(p => p.text.split(/\s+/).filter(Boolean).length > 100)
    .slice(0, 3);

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const avgSentLen = sentences.length > 3
    ? sentences.reduce((s, sen) => s + sen.trim().split(/\s+/).length, 0) / sentences.length
    : 0;

  if (longParas.length === 0 && avgSentLen < 25) {
    return { html, score: currentScore, summary: 'No long paragraphs or run-on sentences found' };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const issues: string[] = [];
  if (longParas.length > 0) issues.push(`${longParas.length} paragraphs over 100 words — split each into 2-3 shorter paragraphs`);
  if (avgSentLen > 25) issues.push(`Average sentence length is ${Math.round(avgSentLen)} words — aim for under 20 words`);

  const res = await anthropic.messages.create({
    model: MODEL_FOR.scoreImprovement,
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Improve the readability of this article HTML by fixing these specific issues:

${issues.join('\n')}

${longParas.length > 0 ? `LONG PARAGRAPHS TO SPLIT:\n${longParas.map(p => p.text.slice(0, 200)).join('\n---\n')}` : ''}

ARTICLE HTML:
${html.slice(0, 7000)}

Rules:
- Only fix the readability issues listed above
- Do not change headings, lists, images, or schema markup
- Keep all keywords and links intact
- Return ONLY the complete updated HTML`,
    }],
  });

  const updatedHtml = res.content[0].type === 'text' ? res.content[0].text.trim() : html;
  const newScore = calculateReadabilityScore(updatedHtml);

  return { html: updatedHtml, score: newScore, summary: issues.join('; ') };
}

export async function improveHumanScore(
  html: string,
): Promise<{ html: string; score: number; summary: string }> {
  // Dynamically import to avoid circular deps if humanizer ever imports scorer
  const { humanizeArticle } = await import('@/lib/humanizer');
  const result = await humanizeArticle(html, { level: 'aggressive' });

  return {
    html: result.humanizedHtml,
    score: result.humanScore,
    summary: `Aggressive humanization applied — ${result.bannedWordsRemoved.length} AI phrases removed`,
  };
}

export async function improveKeywordDensity(
  html: string,
  keyword: string,
  currentDensity: number,
): Promise<{ html: string; score: number; summary: string }> {
  const tooLow = currentDensity < 0.5;
  const tooHigh = currentDensity > 3;

  if (!tooLow && !tooHigh) {
    return {
      html,
      score: currentDensity,
      summary: `Keyword density ${currentDensity}% is already within the 0.5–3% target range`,
    };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const instruction = tooLow
    ? `The keyword "${keyword}" appears too rarely (${currentDensity}%). Naturally add it to 3-5 more paragraphs (in the opening sentence, a subheading, and the conclusion if possible). Target density: 0.8–1.5%.`
    : `The keyword "${keyword}" is overused (${currentDensity}%). Replace some exact-match occurrences with natural synonyms or related phrases to bring density below 2.5%.`;

  const res = await anthropic.messages.create({
    model: MODEL_FOR.scoreImprovement,
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `${instruction}

ARTICLE HTML:
${html.slice(0, 7000)}

Rules:
- Only adjust keyword usage — do not change headings, structure, or other content
- Maintain natural language — never stuff keywords awkwardly
- Return ONLY the complete updated HTML`,
    }],
  });

  const updatedHtml = res.content[0].type === 'text' ? res.content[0].text.trim() : html;
  const newDensity = calculateKeywordDensity(updatedHtml, keyword);

  return {
    html: updatedHtml,
    score: newDensity,
    summary: tooLow
      ? `Density increased from ${currentDensity}% to ${newDensity}%`
      : `Density reduced from ${currentDensity}% to ${newDensity}%`,
  };
}
