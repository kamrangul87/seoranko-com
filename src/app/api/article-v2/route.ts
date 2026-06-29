import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMasterPrompt, validateAndCorrect, getInternalLinks, fetchVerifiedFacts } from '@/lib/article-master';
import { humanizeArticle } from '@/lib/humanizer';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// The angle generator runs on Haiku (separate rate-limit bucket) so it doesn't
// eat the Sonnet input-token budget the main article generation needs.
const FAST_MODEL = 'claude-haiku-4-5-20251001';

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
          const articleUrl = `/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          const llmsTxtEntry = generateLlmsTxtEntry(fullArticle, keyword, articleUrl);

          // Humanize the article — runs after stream so user sees generation in real-time
          let humanScore: number | undefined;
          let bannedWordsRemoved: string[] = [];
          let passesDetection = false;
          try {
            const humanized = await humanizeArticle(fullArticle, { level: 'medium', primaryKeyword: keyword });
            humanScore = humanized.humanScore;
            bannedWordsRemoved = humanized.bannedWordsRemoved;
            passesDetection = humanized.passesDetection;
            controller.enqueue(encoder.encode(
              `\n<!--SEORANKO_HUMANIZED_START-->\n${humanized.humanizedHtml}\n<!--SEORANKO_HUMANIZED_END-->`
            ));
          } catch (err) {
            console.warn('[article-v2] humanization failed, continuing without:', err);
          }

          // Append score metadata as a parseable HTML comment — client strips this
          const scoreMeta = JSON.stringify({ searchScore, aiScore, llmsTxtEntry, humanScore, bannedWordsRemoved, passesDetection });
          controller.enqueue(encoder.encode(`\n<!-- SEORANKO_SCORES:${scoreMeta} -->`));

          controller.close();
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
