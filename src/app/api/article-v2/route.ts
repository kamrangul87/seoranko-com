import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMasterPrompt, validateAndCorrect, getInternalLinks, fetchVerifiedFacts } from '@/lib/article-master';
import { humanizeArticle } from '@/lib/humanizer';
import { generateArticleImages, injectImagesIntoArticle } from '@/lib/image-generator';
import { recordScoreSnapshot } from '@/lib/drift-tracker';
import { queueCitationTest } from '@/lib/citation-tester';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// The angle generator runs on Haiku (separate rate-limit bucket) so it doesn't
// eat the Sonnet input-token budget the main article generation needs.
const FAST_MODEL = 'claude-haiku-4-5-20251001';

function calculateEEATScore(html: string): number {
  let score = 0;
  const text = html.replace(/<[^>]+>/g, ' ');

  // Author byline present (+20)
  if (/Written by|By\s+[A-Z][a-z]+\s+[A-Z]|class=["'][^"']*byline|name=["']author/i.test(html) || /"author"\s*:\s*\{/i.test(html)) {
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
  // Official source citations: gov.uk, .org, .edu links (+15)
  if (/href=["'][^"']*(gov\.uk|\.gov|\.edu|nhs\.uk|who\.int|ons\.gov)[^"']*["']/i.test(html)) {
    score += 15;
  }
  // dateModified or last-updated within any timeframe signals freshness (+15)
  if (/"dateModified"/i.test(html) || /last.?updated|updated\s+\w+\s+202[456]/i.test(text)) {
    score += 15;
  }

  return Math.min(100, score);
}

function calculateReadabilityScore(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let score = 100;

  // Average sentence length (target 15-20 words)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length > 3) {
    const avgSentLen = sentences.reduce((s, sen) => s + sen.trim().split(/\s+/).length, 0) / sentences.length;
    if (avgSentLen > 30) score -= 20;
    else if (avgSentLen > 25) score -= 12;
    else if (avgSentLen > 20) score -= 5;
    else if (avgSentLen < 8) score -= 10;
  }

  // Paragraphs: penalize walls of text (> 150 words in one <p>)
  const pTags = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  const longParas = pTags.filter(m => m[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length > 150).length;
  if (longParas > 0) score -= Math.min(25, longParas * 8);

  // Heading distribution: H2 every 150-300 words is good
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const h2Count = (html.match(/<h2[\s>]/gi) || []).length;
  if (wordCount > 200 && h2Count > 0) {
    const wordsPerH2 = wordCount / h2Count;
    if (wordsPerH2 > 500) score -= 15;
    else if (wordsPerH2 > 350) score -= 8;
  } else if (wordCount > 400 && h2Count === 0) {
    score -= 20;
  }

  // Flesch approximation: penalize avg syllables > 2 per word (complex vocabulary)
  const words = text.split(/\s+/).filter(Boolean).slice(0, 500);
  if (words.length > 50) {
    const totalSyllables = words.reduce((s, w) => {
      // Simple syllable count: count vowel groups
      const vowelGroups = w.toLowerCase().match(/[aeiouy]+/g) || [];
      return s + Math.max(1, vowelGroups.length);
    }, 0);
    const avgSyllables = totalSyllables / words.length;
    if (avgSyllables > 2.5) score -= 15;
    else if (avgSyllables > 2.0) score -= 8;
  }

  return Math.max(0, Math.min(100, score));
}

function scoreHtmlLocally(html: string, keyword: string): { searchScore: number; aiScore: number } {
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

  // AI signals
  // dateModified in schema
  if (!/"dateModified"/i.test(html)) ai -= 10;
  if (!/"datePublished"/i.test(html)) ai -= 5;

  // Author byline
  const hasAuthor = /Written by|class=["'][^"']*byline|name=["']author/i.test(html) || /"author"\s*:\s*\{/i.test(html);
  if (!hasAuthor) ai -= 10;

  // Person schema
  if (!/"@type"\s*:\s*"Person"/i.test(html)) ai -= 5;

  // Author bio section
  if (!/author-bio|About the Author/i.test(html)) ai -= 5;

  // FAQ schema
  if (!/"@type"\s*:\s*"FAQPage"/i.test(html)) ai -= 5;

  // Question headings (h2/h3 ending with ?)
  const headings = Array.from(html.matchAll(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/gi));
  const questionHeadings = headings.filter(m => m[1].replace(/<[^>]+>/g, '').trim().endsWith('?')).length;
  if (questionHeadings < 2) ai -= 5;

  // Answer blocks 134-167 words
  const pTags = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  const answerBlocks = pTags.filter(m => {
    const wc = m[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    return wc >= 134 && wc <= 167;
  }).length;
  if (answerBlocks < 2) ai -= 5;

  // Fact density
  const sentences = text.slice(0, 8000).match(/[^.!?]+[.!?]+/g) || [];
  const factSentences = sentences.filter(s => /\d+%|\$\d+|£\d+|\b\d{2,}\b|\d+,\d+/.test(s)).length;
  const factDensity = sentences.length > 5 ? Math.round((factSentences / sentences.length) * 100) : 0;
  if (factDensity < 15) ai -= 5;

  // Deprecated schemas (HowTo) — deduct only if HowTo found
  if (/"@type"\s*:\s*"HowTo"/i.test(html) && !keyword.toLowerCase().includes('how')) ai -= 5;

  // AI meta robots tag
  if (!/max-snippet:-1/i.test(html)) ai -= 3;

  return {
    searchScore: Math.max(0, Math.min(100, search)),
    aiScore: Math.max(0, Math.min(100, ai)),
  };
}

function generateLlmsTxtEntry(html: string, keyword: string, url: string): string {
  const isoDate = new Date().toISOString().split('T')[0];
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : keyword;
  const metaMatch = html.match(/<!-- META:\s*([^-]+?)\s*-->/i);
  const summary = metaMatch ? metaMatch[1].trim().slice(0, 160) : `Article about ${keyword}`;
  const h2Matches = Array.from(html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi));
  const topics = h2Matches.map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean).slice(0, 6).join(', ');
  return `\n# ${title}\n> ${summary}\nURL: ${url || '/'}\nTopics: ${topics || keyword}\nLast-Updated: ${isoDate}\n`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      keyword = '',
      wordCount = 1500,
      tone = 'professional',
      market = 'United Kingdom',
      secondaryKeywords = [],
      entities = [],
      topicalGaps = [],
    } = body;

    console.log('[article-v2] received:', { keyword, secondaryKeywords: (secondaryKeywords as string[]).length, entities: (entities as string[]).length });

    const safeWordCount = Math.min(wordCount, 1500);
    const secondaryList = (secondaryKeywords as string[]).slice(0, 12).join(', ');
    const kw = keyword.toLowerCase();

    // ── STEP A — Unique Angle Generator ──────────────────────────────────────
    const angleResponse = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are an editorial director at a top UK publication.

For the keyword: "${keyword}"
Secondary keywords: ${secondaryList}
Market: ${market}

Most articles on this topic cover: basic definitions, general advice, obvious facts.

Your job: identify ONE specific unique angle that:
1. Most existing articles completely miss
2. Answers a real question people have but can't find answered
3. Contains a surprising insight, counterintuitive fact, or data-driven observation
4. Cannot be easily replicated by AI Overview summaries

Respond in JSON only:
{
  "unique_angle": "one sentence description of the angle",
  "hook_opening": "one surprising opening sentence that grabs attention immediately",
  "unique_section_title": "H2 heading for the unique section nobody else covers",
  "unique_section_content": "150 words of genuinely unique insight for this section"
}

Do not write generic angles. Be specific and surprising.`
      }]
    });

    const angleText = angleResponse.content[0].type === 'text' ? angleResponse.content[0].text : '{}';
    let angle = { unique_angle: '', hook_opening: '', unique_section_title: '', unique_section_content: '' };
    try {
      angle = JSON.parse(angleText.replace(/```json|```/g, '').trim());
    } catch {
      console.error('[article-v2] angle parse failed, continuing without angle');
    }

    // ── STEP B — Data-Driven Unique Section (automotive) ─────────────────────
    const isAutomotive = kw.includes('mot') || kw.includes('car') || kw.includes('vehicle') ||
      kw.includes('dvsa') || kw.includes('tyre') || kw.includes('brake') ||
      kw.includes('ev') || kw.includes('electric');

    const uniqueDataSection = isAutomotive
      ? `<h2>What MOT Failure Data Actually Reveals</h2>
<p>According to DVSA's published annual MOT statistics, lighting defects consistently account for the largest share of major failures across England, Scotland and Wales — in some years representing more than one in five of all Major-category failures recorded. Brake system defects and tyre condition issues follow closely. What's rarely reported is the regional variation: urban test centres typically record higher failure rates than rural ones, a pattern that correlates with older average vehicle age and higher annual mileage in city areas.</p>
<p>Checking your specific vehicle's historical test record — including every advisory notice ever raised — gives you a significant advantage before your next test. The <a href="https://mot.autodun.com" rel="noopener">Autodun MOT predictor</a> analyses DVSA data for your exact make, model, age, and mileage to flag the components statistically most likely to fail before your test date. It's the kind of preparation most drivers skip — and the kind that most often prevents an avoidable fail.</p>`
      : '';

    // ── STEP B2 — Live fact verification (web search, any topic/country) ──────
    const { facts: liveFacts } = await fetchVerifiedFacts(keyword, market);

    // ── STEP C — Centralised master prompt (shared across all 3 article routes)
    const prompt = buildMasterPrompt({
      mode: 'generate',
      keyword,
      secondaryKeywords: secondaryKeywords as string[],
      entities: entities as string[],
      topicalGaps: topicalGaps as string[],
      wordCount: safeWordCount,
      tone,
      market,
      uniqueAngle: angle.unique_angle || angle.hook_opening || '',
      uniqueContent: angle.unique_section_content || '',
      uniqueDataSection,
      internalLinks: getInternalLinks(keyword),
      liveFacts,
    });

    // ── STEP D — Stream article with angle injected ───────────────────────────
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullArticle = '';
        try {
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              controller.enqueue(encoder.encode(chunk.delta.text));
              fullArticle += chunk.delta.text;
            }
          }

          // Validate and correct the article
          const { corrections } = await validateAndCorrect(fullArticle, keyword, market, liveFacts);
          if (corrections.length > 0) {
            console.log('[article-v2] validation corrections:', corrections);
          }

          // Score the article and generate llms.txt entry
          const { searchScore, aiScore } = scoreHtmlLocally(fullArticle, keyword);
          const eeatScore = calculateEEATScore(fullArticle);
          const readabilityScore = calculateReadabilityScore(fullArticle);
          const articleUrl = `/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          const llmsTxtEntry = generateLlmsTxtEntry(fullArticle, keyword, articleUrl);

          // Adaptive image count based on article word count
          const articleWordCount = fullArticle.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
          const adaptiveImageCount = articleWordCount > 2500 ? 5 : articleWordCount > 1500 ? 4 : 3;

          // Humanize + auto-generate images in parallel (both only need the keyword/article text)
          let humanScore: number | undefined;
          let bannedWordsRemoved: string[] = [];
          let passesDetection = false;
          try {
            const [humanized, imageSet] = await Promise.all([
              humanizeArticle(fullArticle, { level: 'medium', primaryKeyword: keyword }),
              generateArticleImages({
                topic: fullArticle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400),
                keyword,
                tier: 'free',
                count: adaptiveImageCount,
              }).catch((err) => {
                console.warn('[article-v2] auto image generation failed:', err?.message);
                return null;
              }),
            ]);

            humanScore = humanized.humanScore;
            bannedWordsRemoved = humanized.bannedWordsRemoved;
            passesDetection = humanized.passesDetection;

            controller.enqueue(encoder.encode(
              `\n<!--SEORANKO_HUMANIZED_START-->\n${humanized.humanizedHtml}\n<!--SEORANKO_HUMANIZED_END-->`
            ));

            if (imageSet) {
              const withImages = injectImagesIntoArticle(humanized.humanizedHtml, imageSet);
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_WITH_IMAGES_START-->\n${withImages}\n<!--SEORANKO_WITH_IMAGES_END-->`
              ));
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_IMAGE_SET_START-->${JSON.stringify({
                  images: [imageSet.hero, ...imageSet.content].map(img => ({ ...img, altText: img.alt })),
                  stored: [imageSet.hero, ...imageSet.content].some(img => img.url.includes('supabase')),
                  niche: imageSet.niche,
                  styleDescriptor: imageSet.styleDescriptor,
                })}<!--SEORANKO_IMAGE_SET_END-->`
              ));
            }
          } catch (err) {
            console.warn('[article-v2] humanization/images failed, continuing without:', err);
          }

          // Append score metadata as a parseable HTML comment — client strips this
          const scoreMeta = JSON.stringify({ searchScore, aiScore, eeatScore, readabilityScore, llmsTxtEntry, humanScore, bannedWordsRemoved, passesDetection });
          controller.enqueue(encoder.encode(`\n<!-- SEORANKO_SCORES:${scoreMeta} -->`));

          controller.close();

          // Fire-and-forget: record score snapshot + queue 7-day citation test
          const articleSlug = `/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          recordScoreSnapshot({
            domain: 'generated_articles',
            page_url: articleSlug,
            score: searchScore,
            ai_score: aiScore,
            source: 'article_v2',
          }).catch(() => {});
          queueCitationTest({ domain: '', topic: keyword, daysFromNow: 7, source: 'article_v2' });

        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-v2]', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Article generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
