import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  getTopCompetitorUrls,
  fetchCompetitorContent,
  extractCompetitorNLP,
  generateUniqueAngle,
} from '@/lib/competitor';
import { buildMasterPrompt, validateAndCorrect, getInternalLinks, fetchVerifiedFacts } from '@/lib/article-master';
import { humanizeArticle } from '@/lib/humanizer';
import { generateArticleImages, injectImagesIntoArticle } from '@/lib/image-generator';
import { checkCitationOpportunity, queueCitationTest } from '@/lib/citation-tester';
import { recordScoreSnapshot } from '@/lib/drift-tracker';
import { checkAndPatchFactSourcing } from '@/lib/fact-checker';
import {
  calculateEEATScore,
  calculateReadabilityScore,
  calculateKeywordDensity,
  scoreHtmlLocally,
} from '@/lib/content-scorer';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// The fact-enrichment call runs on Haiku (separate rate-limit bucket) so it
// doesn't eat the Sonnet input-token budget the main article generation needs.
const FAST_MODEL = 'claude-haiku-4-5-20251001';

async function enrichArticleWithMissingFacts(
  article: string,
  keyword: string,
  competitorContents: { url: string; content: string }[]
): Promise<string> {
  const response = await anthropic.messages.create({
    model: FAST_MODEL,
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are a fact-checker. Compare this article against competitor content and identify up to 3 specific facts, data points, or insights that competitors mention but our article completely misses.

OUR ARTICLE:
${article.replace(/<[^>]*>/g, '').slice(0, 3000)}

COMPETITOR CONTENT:
${competitorContents.map(c => c.content.slice(0, 800)).join('\n---\n')}

Rules:
- Only identify facts that are SPECIFIC and VERIFIABLE (prices, percentages, legal rules, statistics)
- Ignore generic advice that is already covered
- Maximum 3 missing facts
- Each fact must be genuinely useful to the reader

Return ONLY valid JSON:
{
  "missing_facts": [
    {
      "fact": "exact fact statement to add",
      "where_to_add": "which section heading to add it near",
      "insert_after": "exact phrase in article after which to insert (max 10 words)"
    }
  ]
}

If no important facts are missing return: { "missing_facts": [] }`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    let enrichedArticle = article;

    for (const item of result.missing_facts || []) {
      if (item.insert_after && item.fact) {
        const insertPoint = enrichedArticle.indexOf(item.insert_after);
        if (insertPoint !== -1) {
          const paraEnd = enrichedArticle.indexOf('</p>', insertPoint);
          if (paraEnd !== -1) {
            enrichedArticle =
              enrichedArticle.slice(0, paraEnd) +
              ' ' + item.fact +
              enrichedArticle.slice(paraEnd);
          }
        }
      }
    }

    return enrichedArticle;
  } catch {
    return article;
  }
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

    console.log('[article-competitor] received:', { keyword, market });

    const safeWordCount = Math.min(wordCount, 1500);
    const kw = keyword.toLowerCase();

    // ── STEP 0: Citation opportunity check (parallel with competitor fetch) ─────
    const citationCheckPromise = checkCitationOpportunity(keyword).catch(() => null);

    // ── STEP 1: Get top competitor URLs ───────────────────────────────────────
    const competitorUrls = await getTopCompetitorUrls(keyword, market);
    console.log('[article-competitor] urls:', competitorUrls.length);

    // ── STEP 2: Fetch competitor content in parallel ───────────────────────────
    const competitorTexts = await Promise.all(
      competitorUrls.map(url => fetchCompetitorContent(url))
    );
    const validCompetitors = competitorUrls
      .map((url, i) => ({ url, content: competitorTexts[i] ?? '' }))
      .filter(c => c.content.length > 100);
    const validTexts = validCompetitors.map(c => c.content);
    console.log('[article-competitor] valid texts:', validTexts.length);

    // ── STEP 3: Extract NLP from competitors ─────────────────────────────────
    const nlp = validTexts.length > 0
      ? await extractCompetitorNLP(validTexts, keyword)
      : { commonTopics: [], contentGaps: [], weaknesses: [], entities: [] };

    // ── STEP 4: Generate unique angle from gaps ───────────────────────────────
    const allGaps = Array.from(new Set([...nlp.contentGaps, ...(topicalGaps as string[])])).slice(0, 8);
    const angle = await generateUniqueAngle(keyword, allGaps, nlp.weaknesses);

    // Merge entities
    const allEntities = Array.from(new Set([...nlp.entities, ...(entities as string[])])).slice(0, 10);

    // Automotive data section
    const isAutomotive = kw.includes('mot') || kw.includes('car') || kw.includes('vehicle') ||
      kw.includes('dvsa') || kw.includes('tyre') || kw.includes('brake') ||
      kw.includes('ev') || kw.includes('electric');

    const uniqueDataSection = isAutomotive
      ? `<h2>What MOT Failure Data Actually Reveals</h2>
<p>According to DVSA's published annual MOT statistics, lighting defects consistently account for the largest share of major failures across England, Scotland and Wales — in some years representing more than one in five of all Major-category failures recorded. Brake system defects and tyre condition issues follow closely. What's rarely reported is the regional variation: urban test centres typically record higher failure rates than rural ones, a pattern that correlates with older average vehicle age and higher annual mileage in city areas.</p>
<p>Checking your specific vehicle's historical test record — including every advisory notice ever raised — gives you a significant advantage before your next test. The <a href="https://mot.autodun.com" rel="noopener">Autodun MOT predictor</a> analyses DVSA data for your exact make, model, age, and mileage to flag the components statistically most likely to fail before your test date. It's the kind of preparation most drivers skip — and the kind that most often prevents an avoidable fail.</p>`
      : '';

    // ── STEP 4b: Live fact verification (web search, any topic/country) ───────
    const { facts: liveFacts } = await fetchVerifiedFacts(keyword, market, validTexts);

    // ── STEP 5: Centralised master prompt with competitor intelligence ────────
    const prompt = buildMasterPrompt({
      mode: 'competitor',
      keyword,
      secondaryKeywords: secondaryKeywords as string[],
      entities: allEntities,
      topicalGaps: allGaps,
      wordCount: safeWordCount,
      tone,
      market,
      uniqueAngle: angle.uniqueSection || angle.hook || '',
      uniqueContent: angle.uniqueContent || '',
      uniqueDataSection,
      internalLinks: getInternalLinks(keyword),
      competitorTopics: nlp.commonTopics,
      liveFacts,
    });

    // ── STEP 6: Stream article ────────────────────────────────────────────────
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        let fullArticle = '';
        let competitorFinalHtml = ''; // tracks the final humanized+patched article for scoring
        try {
          // Stream article to client in real-time AND collect it server-side
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              controller.enqueue(encoder.encode(chunk.delta.text));
              fullArticle += chunk.delta.text;
            }
          }

          // ── STEP 7: Post-write fact enrichment + validation + humanization ──
          if (validCompetitors.length > 0 && fullArticle.length > 200) {
            controller.enqueue(encoder.encode('\n<!--SEORANKO_ENRICHING-->'));

            const enriched = await enrichArticleWithMissingFacts(fullArticle, keyword, validCompetitors);
            const { article: validatedArticle, corrections } = await validateAndCorrect(enriched, keyword, market, liveFacts);
            if (corrections.length > 0) {
              console.log('[article-competitor] validation corrections:', corrections);
            }

            controller.enqueue(encoder.encode(
              `\n<!--SEORANKO_ENRICHED_START-->\n${validatedArticle}\n<!--SEORANKO_ENRICHED_END-->`
            ));

            // Humanize + auto-generate images in parallel after enrichment
            try {
              // Adaptive image count: same formula as article-v2
              const enrichedWordCount = validatedArticle.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
              const enrichedImageCount = enrichedWordCount > 2500 ? 5 : enrichedWordCount > 1500 ? 4 : 3;

              const [humanized, imageSet] = await Promise.all([
                humanizeArticle(validatedArticle, { level: 'medium', primaryKeyword: keyword }),
                generateArticleImages({
                  topic: validatedArticle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400),
                  keyword,
                  tier: 'free',
                  count: enrichedImageCount,
                }).catch((err) => {
                  console.warn('[article-competitor] auto image generation failed:', err?.message);
                  return null;
                }),
              ]);

              let finalHtml = humanized.humanizedHtml;
              let factSourcingScore: number | undefined;
              let factPatchedCount = 0;
              try {
                const factResult = await checkAndPatchFactSourcing(humanized.humanizedHtml, keyword, market);
                finalHtml = factResult.article;
                factSourcingScore = factResult.result.factSourcingScore;
                factPatchedCount = factResult.result.patchedCount;
              } catch (factErr) {
                console.warn('[article-competitor] fact-sourcing check failed:', factErr);
              }
              competitorFinalHtml = finalHtml;

              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_HUMANIZED_START-->\n${finalHtml}\n<!--SEORANKO_HUMANIZED_END-->`
              ));
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_FACT_SOURCING:${JSON.stringify({ factSourcingScore, factPatchedCount })}-->`
              ));
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_HUMAN_SCORE:${humanized.humanScore}-->`
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
                    imageStats: imageSet.imageStats,
                  })}<!--SEORANKO_IMAGE_SET_END-->`
                ));
              }
            } catch (err) {
              console.warn('[article-competitor] humanization failed:', err);
            }
          } else if (fullArticle.length > 200) {
            const { article: validatedArticle, corrections } = await validateAndCorrect(fullArticle, keyword, market, liveFacts);
            if (corrections.length > 0) {
              console.log('[article-competitor] validation corrections:', corrections);
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_ENRICHING-->\n<!--SEORANKO_ENRICHED_START-->\n${validatedArticle}\n<!--SEORANKO_ENRICHED_END-->`
              ));
            }

            // Humanize + auto-generate images in parallel (base article path)
            try {
              const baseArticle = validatedArticle || fullArticle;
              // Adaptive image count: same formula as article-v2
              const baseWordCount = baseArticle.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
              const baseImageCount = baseWordCount > 2500 ? 5 : baseWordCount > 1500 ? 4 : 3;

              const [humanized, imageSet] = await Promise.all([
                humanizeArticle(baseArticle, { level: 'medium', primaryKeyword: keyword }),
                generateArticleImages({
                  topic: baseArticle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400),
                  keyword,
                  tier: 'free',
                  count: baseImageCount,
                }).catch((err) => {
                  console.warn('[article-competitor] auto image generation failed (base):', err?.message);
                  return null;
                }),
              ]);

              let finalBaseHtml = humanized.humanizedHtml;
              let baseSourcingScore: number | undefined;
              let basePatchedCount = 0;
              try {
                const factResult = await checkAndPatchFactSourcing(humanized.humanizedHtml, keyword, market);
                finalBaseHtml = factResult.article;
                baseSourcingScore = factResult.result.factSourcingScore;
                basePatchedCount = factResult.result.patchedCount;
              } catch (factErr) {
                console.warn('[article-competitor] fact-sourcing check (base) failed:', factErr);
              }
              competitorFinalHtml = finalBaseHtml;

              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_HUMANIZED_START-->\n${finalBaseHtml}\n<!--SEORANKO_HUMANIZED_END-->`
              ));
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_FACT_SOURCING:${JSON.stringify({ factSourcingScore: baseSourcingScore, factPatchedCount: basePatchedCount })}-->`
              ));
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_HUMAN_SCORE:${humanized.humanScore}-->`
              ));
              if (imageSet) {
                const withImages = injectImagesIntoArticle(finalBaseHtml, imageSet);
                controller.enqueue(encoder.encode(
                  `\n<!--SEORANKO_WITH_IMAGES_START-->\n${withImages}\n<!--SEORANKO_WITH_IMAGES_END-->`
                ));
                controller.enqueue(encoder.encode(
                  `\n<!--SEORANKO_IMAGE_SET_START-->${JSON.stringify({
                    images: [imageSet.hero, ...imageSet.content].map(img => ({ ...img, altText: img.alt })),
                    stored: [imageSet.hero, ...imageSet.content].some(img => img.url.includes('supabase')),
                    niche: imageSet.niche,
                    styleDescriptor: imageSet.styleDescriptor,
                    imageStats: imageSet.imageStats,
                  })}<!--SEORANKO_IMAGE_SET_END-->`
                ));
              }
            } catch (err) {
              console.warn('[article-competitor] humanization (base) failed:', err);
            }
          }

          // Emit citation opportunity result if ready
          try {
            const citationResult = await citationCheckPromise;
            if (citationResult) {
              controller.enqueue(encoder.encode(
                `\n<!--SEORANKO_CITATION_OPPORTUNITY:${JSON.stringify({
                  topicAlreadyCited: citationResult.hasStrongCompetition,
                  competitorsCurrentlyCited: citationResult.dominantCompetitors,
                  opportunityScore: citationResult.opportunityScore,
                })}-->`
              ));
            }
          } catch { /* non-fatal */ }

          // Emit scores for dashboard — use final humanized HTML so scores reflect the delivered article
          if (competitorFinalHtml) {
            const { searchScore: cSearchScore, aiScore: cAiScore } = scoreHtmlLocally(competitorFinalHtml, keyword);
            const cEeatScore = calculateEEATScore(competitorFinalHtml);
            const cReadabilityScore = calculateReadabilityScore(competitorFinalHtml);
            const cKeywordDensity = calculateKeywordDensity(competitorFinalHtml, keyword);
            controller.enqueue(encoder.encode(
              `\n<!-- SEORANKO_SCORES:${JSON.stringify({
                searchScore: cSearchScore,
                aiScore: cAiScore,
                eeatScore: cEeatScore,
                readabilityScore: cReadabilityScore,
                keywordDensity: cKeywordDensity,
              })} -->`
            ));
          }

          controller.close();

          // Fire-and-forget: score snapshot + queue 7-day citation test
          const slug = `/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          recordScoreSnapshot({
            domain: 'competitor_articles',
            page_url: slug,
            score: 70, // baseline score for newly generated competitor article
            source: 'article_competitor',
          }).catch(() => {});
          queueCitationTest({ domain: '', topic: keyword, daysFromNow: 7, source: 'article_competitor' });

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
        'X-Competitor-Count': String(validTexts.length),
        'X-Content-Gaps': nlp.contentGaps.slice(0, 5).join('|'),
      },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[article-competitor]', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Competitor article generation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
