import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMasterPrompt, validateAndCorrect, getInternalLinks, fetchVerifiedFacts } from '@/lib/article-master';
import { humanizeArticle } from '@/lib/humanizer';
import { generateArticleImages, injectImagesIntoArticle } from '@/lib/image-generator';
import { recordScoreSnapshot } from '@/lib/drift-tracker';
import { queueCitationTest } from '@/lib/citation-tester';
import { checkAndPatchFactSourcing } from '@/lib/fact-checker';
import {
  calculateEEATScore,
  calculateReadabilityScore,
  calculateKeywordDensity,
  scoreHtmlLocally,
} from '@/lib/content-scorer';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// The angle generator runs on Haiku (separate rate-limit bucket) so it doesn't
// eat the Sonnet input-token budget the main article generation needs.
const FAST_MODEL = 'claude-haiku-4-5-20251001';


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
          const keywordDensity = calculateKeywordDensity(fullArticle, keyword);
          const articleUrl = `/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          const llmsTxtEntry = generateLlmsTxtEntry(fullArticle, keyword, articleUrl);

          // Adaptive image count based on article word count
          const articleWordCount = fullArticle.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
          const adaptiveImageCount = articleWordCount > 2500 ? 5 : articleWordCount > 1500 ? 4 : 3;

          // Humanize + auto-generate images in parallel (both only need the keyword/article text)
          let humanScore: number | undefined;
          let bannedWordsRemoved: string[] = [];
          let passesDetection = false;
          let factSourcingScore: number | undefined;
          let factPatchedCount = 0;
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

            // Fact-sourcing check + auto-patch on humanized HTML
            let finalHtml = humanized.humanizedHtml;
            try {
              const factResult = await checkAndPatchFactSourcing(humanized.humanizedHtml, keyword, market);
              finalHtml = factResult.article;
              factSourcingScore = factResult.result.factSourcingScore;
              factPatchedCount = factResult.result.patchedCount;
              if (factPatchedCount > 0) {
                console.log(`[article-v2] fact-sourcing: patched ${factPatchedCount} unsourced claims, score=${factSourcingScore}`);
              }
            } catch (factErr) {
              console.warn('[article-v2] fact-sourcing check failed, continuing:', factErr);
            }

            controller.enqueue(encoder.encode(
              `\n<!--SEORANKO_HUMANIZED_START-->\n${finalHtml}\n<!--SEORANKO_HUMANIZED_END-->`
            ));

            if (imageSet) {
              const withImages = injectImagesIntoArticle(finalHtml, imageSet);
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
          const scoreMeta = JSON.stringify({ searchScore, aiScore, eeatScore, readabilityScore, keywordDensity, factSourcingScore, factPatchedCount, llmsTxtEntry, humanScore, bannedWordsRemoved, passesDetection });
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
