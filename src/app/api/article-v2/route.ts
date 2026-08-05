import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMasterPrompt, validateAndCorrect, fetchVerifiedFacts, checkAnswerFirst, computeRankScore, extractHowToSteps, buildInternalLinksPrompt } from '@/lib/article-master';
import { getEligibleLinks } from '@/lib/internal-link-engine';
import type { InternalLink } from '@/lib/article-master';
import { scoreFactDensity } from '@/lib/fact-density';
import { parseFAQsFromArticle } from '@/lib/faq-generator';
import { generateArticleSchema, detectHowTo } from '@/lib/schema-generator';
import { humanizeArticle } from '@/lib/humanizer';
import { generateArticleImages, injectImagesIntoArticle } from '@/lib/image-generator';
import { recordScoreSnapshot } from '@/lib/drift-tracker';
import { queueCitationTest } from '@/lib/citation-tester';
import { checkAndPatchFactSourcing } from '@/lib/fact-checker';
import {
  calculateEEATScore,
  calculateReadabilityScore,
  analyzeKeywordDensity,
  scoreHtmlLocally,
} from '@/lib/content-scorer';
import { MODEL_FOR } from '@/lib/model-router';
import { runQualityGate, type QualityIssue } from '@/lib/article-quality-gate';
import { injectMissingArticleImage } from '@/lib/schema-validator';
import { repairAllMergeArtifacts } from '@/lib/merge-artifact-repair';
import { insertTableOfContents } from '@/lib/table-of-contents';
import { autoSplitDenseParagraphs } from '@/lib/scannability-fixer';
import { validateArticleStructure } from '@/lib/structure-validator';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });


function auditPlacedLinks(
  articleContent: string,
  requestedLinks: InternalLink[]
): { placed: string[]; skipped: string[] } {
  const placed: string[] = []
  const skipped: string[] = []
  for (const link of requestedLinks) {
    if (!link.url) continue
    const isInArticle = articleContent.includes(link.url)
    if (isInArticle) {
      placed.push(link.url)
    } else {
      skipped.push(link.url)
    }
  }
  return { placed, skipped }
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
      longTailKeywords = [],
      entities = [],
      topicalGaps = [],
      domain: rawDomain = '',
      internalLinks: userInternalLinks = [],
      brand = '',
      userId = '',
    } = body;
    const citationDomain = (rawDomain as string).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase().trim();

    console.log('[article-v2] received:', { keyword, secondaryKeywords: (secondaryKeywords as string[]).length, entities: (entities as string[]).length });

    const safeWordCount = Math.min(wordCount, 1500);
    const secondaryList = (secondaryKeywords as string[]).slice(0, 12).join(', ');
    const kw = keyword.toLowerCase();

    // ── STEP A — Unique Angle Generator ──────────────────────────────────────
    const angleResponse = await anthropic.messages.create({
      model: MODEL_FOR.keywordExtraction,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const angleCacheHit = ((angleResponse.usage as any).cache_read_input_tokens ?? 0) > 0;
    console.log(`[model-router] task=keywordExtraction model=${MODEL_FOR.keywordExtraction} inputTokens=${angleResponse.usage.input_tokens} cacheHit=${angleCacheHit}`);
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
    // Brand-aware link registry takes priority over user-provided panel links.
    // Only links that match the article brand AND score relevant are eligible.
    //
    // linksRequestedFromModel tracks whichever list actually got fed into the
    // write prompt, so the post-write audit checks placement against the
    // REAL request — it used to unconditionally audit userInternalLinks even
    // when the registry path was the one actually used, which made a
    // successful registry-link placement report as if nothing had happened.
    let resolvedLinksStr = ''
    let linksRequestedFromModel: InternalLink[] = []
    let linkUnavailableNote = ''
    if (brand && userId) {
      console.log(`[internal-links] brand="${brand}" userId="${userId}" keyword="${keyword}"`)
      const eligibleLinks = await getEligibleLinks(userId, brand, keyword, angle.unique_angle || keyword)
      console.log(`[internal-links] ${eligibleLinks.length} eligible link(s) from registry after scoring`)
      if (eligibleLinks.length > 0) {
        const registryLinksAsInternal: InternalLink[] = eligibleLinks.map(l => ({
          url: l.pageUrl,
          anchorText: l.anchorText,
          context: l.pageDescription || l.pageTitle
        }))
        resolvedLinksStr = buildInternalLinksPrompt(registryLinksAsInternal, keyword, angle.unique_angle || keyword)
        linksRequestedFromModel = registryLinksAsInternal
      } else {
        linkUnavailableNote = `No links in the registry scored relevant enough for brand "${brand}" on "${keyword}". Check Settings → Link Registry — either it's empty for this brand, or no entries are topically close enough to this article.`
      }
    } else {
      linkUnavailableNote = 'No brand or user context for this generation — internal linking from the registry was skipped.'
    }
    // Fall back to user-provided links from InternalLinksPanel only if no registry links found
    if (linksRequestedFromModel.length === 0 && (userInternalLinks as InternalLink[]).length > 0) {
      resolvedLinksStr = buildInternalLinksPrompt(userInternalLinks as InternalLink[], keyword, angle.unique_angle || keyword)
      linksRequestedFromModel = userInternalLinks as InternalLink[]
      linkUnavailableNote = ''
    }
    if (linksRequestedFromModel.length === 0 && !linkUnavailableNote) {
      linkUnavailableNote = 'No internal links were available for this article — neither the registry nor the manual link panel had any entries.'
    }
    const prompt = buildMasterPrompt({
      mode: 'generate',
      keyword,
      secondaryKeywords: secondaryKeywords as string[],
      longTailKeywords: longTailKeywords as string[],
      entities: entities as string[],
      topicalGaps: topicalGaps as string[],
      wordCount: safeWordCount,
      tone,
      market,
      uniqueAngle: angle.unique_angle || angle.hook_opening || '',
      uniqueContent: angle.unique_section_content || '',
      uniqueDataSection,
      internalLinks: resolvedLinksStr,
      liveFacts,
    });

    // ── STEP D — Stream article with angle injected ───────────────────────────
    const stream = await anthropic.messages.stream({
      model: MODEL_FOR.articleWriting,
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
          const articleFinalMsg = await stream.finalMessage();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const articleCacheHit = ((articleFinalMsg.usage as any).cache_read_input_tokens ?? 0) > 0;
          console.log(`[model-router] task=articleWriting model=${MODEL_FOR.articleWriting} inputTokens=${articleFinalMsg.usage.input_tokens} cacheHit=${articleCacheHit}`);

          // Validate and correct the article
          const { corrections } = await validateAndCorrect(fullArticle, keyword, market, liveFacts);
          if (corrections.length > 0) {
            console.log('[article-v2] validation corrections:', corrections);
          }

          // === POST-PROCESSING: AEO/GEO enrichment ===
          const { faqs } = parseFAQsFromArticle(fullArticle);
          const factDensityResult = scoreFactDensity(fullArticle);
          const isHowTo = detectHowTo(keyword, keyword);
          const titleMatch = fullArticle.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          const articleTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : keyword;
          const metaMatch = fullArticle.match(/<!-- META:\s*([^-]+?)\s*-->/i);
          const articleDescription = metaMatch ? metaMatch[1].trim().slice(0, 160) : `Article about ${keyword}`;
          const articleSlug = `/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          const schemaResult = generateArticleSchema({
            title: articleTitle,
            description: articleDescription,
            keyword,
            authorName: 'Kamran Gul',
            publishDate: new Date().toISOString(),
            articleUrl: `https://seoranko.com/blog${articleSlug}`,
            wordCount: factDensityResult.wordCount,
            faqs: faqs.length > 0 ? faqs : undefined,
            isHowTo,
            howToSteps: isHowTo ? extractHowToSteps(fullArticle) : undefined,
          });
          const answerFirst = checkAnswerFirst(fullArticle);

          // Score the article and generate llms.txt entry
          const { searchScore, aiScore } = scoreHtmlLocally(fullArticle, keyword);
          const eeatScore = calculateEEATScore(fullArticle);
          const readabilityScore = calculateReadabilityScore(fullArticle);
          const keywordDensityDetail = analyzeKeywordDensity(fullArticle, keyword);
          const keywordDensity = keywordDensityDetail.density;
          const keywordDensityScore = keywordDensityDetail.score;
          if (keywordDensityDetail.possibleScoringBug) {
            console.warn(
              `[article-v2] keyword density score (${keywordDensityScore}/100) looks too low given ` +
              `${keywordDensityDetail.occurrences} occurrences of "${keyword}" in ${keywordDensityDetail.totalWords} words — check content-scorer.ts for a scoring bug.`
            );
          }
          const rankScore = computeRankScore({
            eeat: eeatScore,
            readability: readabilityScore,
            factDensity: factDensityResult.score,
            hasFAQ: faqs.length >= 4,
            hasSchema: true,
            answerFirst,
          });
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
          let articleQualityGate: {
            passed: boolean; score: number; criticalCount: number; warningCount: number;
            autoFixedCount: number; issues: QualityIssue[]; blockers: string[]; readyToPublish: boolean;
          } | undefined;
          let heroImageUrl: string | undefined;
          // Hoisted so the link audit below (and anything else after this
          // try block) can check the actual final text, not the pre-
          // humanization draft — falls back to fullArticle if the try block
          // below fails before reassigning it.
          let finalHtml = fullArticle;
          // One id for this whole generation request — used both as the
          // image storage folder's uniqueness suffix (so two articles on
          // the same keyword never overwrite each other's images, see
          // buildStoragePath) and as the Quality Gate's articleId, so the
          // two logs can be cross-referenced for the same generation.
          const articleInstanceId = crypto.randomUUID();
          try {
            const [humanized, imageSet] = await Promise.all([
              // 'light' reuses humanizer.ts's existing cost path: skip Claude
              // entirely if the article already scores >=72 with no banned
              // words, otherwise rewrite with Haiku instead of Sonnet. The
              // automatic pipeline previously hardcoded 'medium' (always a
              // full Sonnet rewrite) even though this cheaper path already
              // existed for exactly this purpose — never wired in here.
              humanizeArticle(fullArticle, { level: 'light', primaryKeyword: keyword }),
              generateArticleImages({
                topic: fullArticle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400),
                keyword,
                tier: 'free',
                count: adaptiveImageCount,
                articleInstanceId,
              }).catch((err) => {
                console.warn('[article-v2] auto image generation failed:', err?.message);
                return null;
              }),
            ]);

            humanScore = humanized.humanScore;
            bannedWordsRemoved = humanized.bannedWordsRemoved;
            passesDetection = humanized.passesDetection;

            // Fact-sourcing check + auto-patch on humanized HTML
            finalHtml = humanized.humanizedHtml;
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

            // Fact-sourcing patches can introduce their own merge artifacts —
            // repair before the Quality Gate scores the article. humanizeArticle
            // already ran its own repair pass on humanized.humanizedHtml; this
            // catches anything the fact-sourcing patch introduced afterward.
            try {
              const repairResult = await repairAllMergeArtifacts(finalHtml);
              finalHtml = repairResult.content;
              if (repairResult.repairsMade > 0) {
                console.log(`[article-v2] merge-artifact repair: fixed ${repairResult.repairsMade} broken sentence(s)`);
              }
            } catch (repairErr) {
              console.warn('[article-v2] merge-artifact repair failed, continuing:', repairErr);
            }

            // The model wrote its own Article schema during generation, before
            // any hero image existed — patch the real URL in now, before the
            // Quality Gate scores the schema, so it isn't flagged every time.
            if (imageSet?.hero?.url) {
              heroImageUrl = imageSet.hero.url;
              finalHtml = injectMissingArticleImage(finalHtml, heroImageUrl);
            }

            // Mechanical scannability safety net — the write prompt's
            // SCANNABILITY RULE is a request, not a guarantee. Split any
            // paragraph the model still wrote as 7+ sentences before the
            // Quality Gate's scannability check scores it.
            finalHtml = autoSplitDenseParagraphs(finalHtml);

            // Table of contents — only kicks in above the word threshold;
            // this template currently targets ~1,340 words, so it won't
            // fire on typical output today unless wordCount settings change.
            finalHtml = insertTableOfContents(finalHtml, articleWordCount);

            // Quality gate — runs after humanization + fact-sourcing; auto-fixes applied to finalHtml
          try {
            const brandDomains: Record<string, string[]> = {
              autodun: ['autodun.com'], seoranko: ['seoranko.com'], fitford: ['fitford.com'],
            }
            const qr = await runQualityGate(finalHtml, {
              brand: brand || 'autodun',
              keyword,
              authorName: 'Kamran Gul',
              registeredLinkDomains: brandDomains[brand] || ['autodun.com'],
              minWordCount: 800,
              maxTypically: 5,
              userId: (userId as string) || undefined,
              articleId: articleInstanceId,
            })
            finalHtml = qr.articleAfterAutoFix
            articleQualityGate = {
              passed: qr.passed, score: qr.score, criticalCount: qr.criticalCount,
              warningCount: qr.warningCount, autoFixedCount: qr.autoFixedCount,
              issues: qr.issues, blockers: qr.blockers, readyToPublish: qr.readyToPublish,
            }
            if (qr.autoFixedCount > 0) console.log(`[article-v2] quality-gate: auto-fixed ${qr.autoFixedCount} issues, score=${qr.score}`)
          } catch (qErr) {
            console.warn('[article-v2] quality gate failed, continuing:', qErr)
          }

          controller.enqueue(encoder.encode(
              `\n<!--SEORANKO_HUMANIZED_START-->\n${finalHtml}\n<!--SEORANKO_HUMANIZED_END-->`
            ));

            if (imageSet) {
              const withImages = injectImagesIntoArticle(finalHtml, imageSet);

              // Images are injected AFTER the Quality Gate already ran (finalHtml
              // never has <img> tags at that point — they're streamed separately
              // for progressive UX), so image completeness is checked here instead.
              // imageSet.imageStats.failures is the authoritative signal for "every
              // provider failed this slot" — counting <img> tags in the final HTML
              // wouldn't catch it, because a failed slot still gets a pollinations.ai
              // fallback URL injected (existing behaviour, unrelated to this change)
              // rather than being left empty.
              if (imageSet.imageStats.failures.length > 0 && articleQualityGate) {
                const imageIssue: QualityIssue = {
                  id: 'image-count-mismatch',
                  severity: 'warning',
                  category: 'image-completeness',
                  title: `${imageSet.imageStats.failures.length} image(s) failed to generate`,
                  description: `This article was supposed to have ${imageSet.imageStats.requested} images but only ${imageSet.imageStats.generated} generated successfully. Every image provider (Gemini, Pexels, pollinations.ai) failed for at least one slot — check API keys and daily rate limits: ${imageSet.imageStats.failures.join('; ')}`,
                  autoFixable: false,
                };
                articleQualityGate.issues = [...articleQualityGate.issues, imageIssue];
                articleQualityGate.warningCount += 1;
                articleQualityGate.score = Math.max(0, articleQualityGate.score - 5);
                articleQualityGate.readyToPublish = articleQualityGate.criticalCount === 0 && articleQualityGate.warningCount <= 2;
              }

              // image-placement structure issues (figure right after a heading,
              // no lead-in text) can only be checked now that images actually
              // exist in the HTML — runQualityGate's RULE 10 ran on finalHtml
              // before injection, so that category is always trivially empty
              // there. Same timing pattern as the imageStats merge above.
              const placementIssues = validateArticleStructure(withImages).filter(i => i.category === 'image-placement');
              if (placementIssues.length > 0 && articleQualityGate) {
                const mapped: QualityIssue[] = placementIssues.map((si, i) => ({
                  id: `structure-image-placement-post-${i}`,
                  severity: si.severity,
                  category: si.category,
                  title: si.message,
                  description: si.message,
                  autoFixable: false,
                }));
                articleQualityGate.issues = [...articleQualityGate.issues, ...mapped];
                articleQualityGate.warningCount += mapped.length;
                articleQualityGate.score = Math.max(0, articleQualityGate.score - mapped.length * 5);
                articleQualityGate.readyToPublish = articleQualityGate.criticalCount === 0 && articleQualityGate.warningCount <= 2;
              }

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
            console.warn('[article-v2] humanization/images failed, continuing without:', err);
          }

          // Audit against whichever list was actually requested from the
          // model (registry-sourced links take priority — see STEP C), not
          // unconditionally the user-provided panel list, and against the
          // final processed text so placement reflects what's really shipping.
          const placementResult = auditPlacedLinks(finalHtml, linksRequestedFromModel);
          const linkAudit = {
            ...placementResult,
            totalPlaced: placementResult.placed.length,
            note: placementResult.placed.length === 0
              ? (linkUnavailableNote || 'Links were requested but none were placed naturally in the article text — check the skipped list for reasons.')
              : undefined,
          };
          console.log(`[internal-links] placed=${linkAudit.totalPlaced} skipped=${placementResult.skipped.length}${linkAudit.note ? ` note="${linkAudit.note}"` : ''}`);

          // Append score metadata as a parseable HTML comment — client strips this
          const scoreMeta = JSON.stringify({
            searchScore, aiScore, eeatScore, readabilityScore, keywordDensity, keywordDensityScore,
            factSourcingScore, factPatchedCount, llmsTxtEntry, humanScore, bannedWordsRemoved, passesDetection,
            rankScore,
            factDensity: {
              score: factDensityResult.score,
              grade: factDensityResult.grade,
              factsPerHundredWords: factDensityResult.factsPerHundredWords,
              suggestions: factDensityResult.suggestions,
            },
            faqs,
            answerFirst,
            hasSchema: true,
            schemaScriptTag: injectMissingArticleImage(schemaResult.combinedScriptTag, heroImageUrl),
            linkAudit,
            qualityGate: articleQualityGate,
          });
          controller.enqueue(encoder.encode(`\n<!-- SEORANKO_SCORES:${scoreMeta} -->`));

          controller.close();

          // Fire-and-forget: record score snapshot + queue 7-day citation test
          recordScoreSnapshot({
            domain: 'generated_articles',
            page_url: articleSlug,
            score: searchScore,
            ai_score: aiScore,
            source: 'article_v2',
          }).catch(() => {});
          if (citationDomain) queueCitationTest({ domain: citationDomain, topic: keyword, daysFromNow: 7, source: 'article_v2' });

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error('[article-v2] stream error:', errMsg)
          controller.enqueue(encoder.encode(
            `\n<!--SEORANKO_ERROR:${encodeURIComponent(errMsg)}-->`
          ))
          controller.close()
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
