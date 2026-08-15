import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { stampStage, STAGE } from '@/lib/pages';
import { buildMasterPrompt, validateAndCorrect, fetchVerifiedFacts, checkAnswerFirst, computeRankScore, extractHowToSteps, buildInternalLinksPrompt } from '@/lib/article-master';
import { getEligibleLinks } from '@/lib/internal-link-engine';
import type { InternalLink } from '@/lib/article-master';
import { scoreFactDensity } from '@/lib/fact-density';
import { parseFAQsFromArticle } from '@/lib/faq-generator';
import { generateArticleSchema, detectHowTo } from '@/lib/schema-generator';
import { getBrandSettings } from '@/lib/brand-settings';
import { buildSocialMetaTags } from '@/lib/social-meta-tags';
import { buildCanonicalTag } from '@/lib/canonical-builder';
import { pingIndexNow } from '@/lib/indexnow';
import { humanizeArticle } from '@/lib/humanizer';
import { generateArticleImages, injectImagesIntoArticle } from '@/lib/image-generator';
import { recordScoreSnapshot } from '@/lib/drift-tracker';
import { queueCitationTest } from '@/lib/citation-tester';
import { checkAndPatchFactSourcing } from '@/lib/fact-checker';
import { validateCitationLinks, type CitationLinkIssue } from '@/lib/citation-link-validator';
import {
  calculateEEATScore,
  calculateReadabilityScore,
  analyzeKeywordDensity,
  scoreHtmlLocally,
} from '@/lib/content-scorer';
import { MODEL_FOR } from '@/lib/model-router';
import { runQualityGate, type QualityIssue } from '@/lib/article-quality-gate';
import { repairAllMergeArtifacts } from '@/lib/merge-artifact-repair';
import { enforceWordCountLimit, countArticleWords } from '@/lib/word-count-enforcer';
import { checkTopicAlignment } from '@/lib/topic-alignment';
import { insertTableOfContents } from '@/lib/table-of-contents';
import { autoSplitDenseParagraphs } from '@/lib/scannability-fixer';
import { validateArticleStructure } from '@/lib/structure-validator';
import { assertSchemaCompleteness } from '@/lib/schema-validate';
import { detectDatedClaims, buildLastVerifiedLine } from '@/lib/dated-claim-detector';
import { splitDenseParagraphs } from '@/lib/paragraph-splitter';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// Service role, not anon — articles/pages/user_profiles RLS is
// auth.uid() = user_id (or = id). A server route has no forwarded user JWT
// by default, so an anon-key client here would have auth.uid() = NULL and
// every insert/update would be silently rejected by RLS. Service role
// bypasses RLS by design; this route already knows and controls which
// user_id to attribute each row to, so it doesn't need RLS to enforce that
// — RLS exists to protect direct client-side DB access, not trusted server
// code. Matches the pattern already used in image-generator.ts and
// internal-link-engine.ts for the same reason.
function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

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
      market: rawMarket = '',
      secondaryKeywords = [],
      longTailKeywords = [],
      entities = [],
      topicalGaps = [],
      gapAnalysis = undefined,
      domain: rawDomain = '',
      internalLinks: userInternalLinks = [],
      brand = '',
      userId = '',
      pageId = null,
    } = body;
    // ArticleWriter.tsx always sends a real market from its dropdown — this
    // route being called without one is a genuine upstream bug, not a
    // legitimate "no market" case, so it's logged loudly rather than
    // silently assuming a specific country (was previously 'United Kingdom'
    // unconditionally, biasing every market-less request toward UK content).
    if (!rawMarket) {
      console.warn('[article-v2] market missing from request — defaulting to Global. Check the caller: this should always be set from the Write page.');
    }
    const market = rawMarket || 'Global';
    const citationDomain = (rawDomain as string).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase().trim();

    console.log('[article-v2] received:', { keyword, wordCount, secondaryKeywords: (secondaryKeywords as string[]).length, entities: (entities as string[]).length });

    const targetWordCount = Math.min(Math.max(Number(wordCount) || 1500, 800), 3000);
    const secondaryList = (secondaryKeywords as string[]).slice(0, 12).join(', ');
    const kw = keyword.toLowerCase();

    // ── STEP A — Unique Angle Generator ──────────────────────────────────────
    const angleResponse = await anthropic.messages.create({
      model: MODEL_FOR.keywordExtraction,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are an editorial director.

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
      const { links: eligibleLinks, registryRowCount } = await getEligibleLinks(userId, brand, keyword, angle.unique_angle || keyword)
      console.log(`[internal-links] ${registryRowCount} active row(s) in registry for this user+brand, ${eligibleLinks.length} scored relevant`)
      if (eligibleLinks.length > 0) {
        const registryLinksAsInternal: InternalLink[] = eligibleLinks.map(l => ({
          url: l.pageUrl,
          anchorText: l.anchorText,
          context: l.pageDescription || l.pageTitle
        }))
        resolvedLinksStr = buildInternalLinksPrompt(registryLinksAsInternal, keyword, angle.unique_angle || keyword)
        linksRequestedFromModel = registryLinksAsInternal
      } else if (registryRowCount === 0) {
        // Distinguish from the "scored too low" case below — this is a
        // data/account problem (zero rows for this user+brand), not a
        // relevance-scoring problem. Confirmed in production: this message
        // used to be identical to the low-score case, which made a wrong-
        // Supabase-account data issue look like a scoring bug.
        linkUnavailableNote = `No internal links are registered for brand "${brand}" on this account. Add entries in Settings → Link Registry — the registry is empty for this user+brand combination.`
      } else {
        linkUnavailableNote = `${registryRowCount} link(s) are registered for brand "${brand}", but none scored relevant enough for "${keyword}". Check Settings → Link Registry — the entries may need better topic tags, or genuinely aren't close enough to this article.`
      }
    } else {
      console.warn(`[internal-links] SKIPPED — missing context. brand="${brand}" userId="${userId}". This should not happen if the caller is correctly wired — check that the client is sending both.`)
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
      gapAnalysis: gapAnalysis as { gapScore?: number; volume?: number; competitionLevel?: string; serpFeatures?: string[] } | undefined,
      wordCount: targetWordCount,
      tone,
      market,
      brandName: brand || '',
      brandDomain: citationDomain,
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
          let validated = await validateAndCorrect(fullArticle, keyword, market, liveFacts);
          fullArticle = validated.article;
          if (validated.corrections.length > 0) {
            console.log('[article-v2] validation corrections:', validated.corrections);
          }

          let topicAlignment = checkTopicAlignment(fullArticle, keyword);
          if (!topicAlignment.aligned) {
            console.error('[article-v2] topic mismatch after generation — retrying once:', topicAlignment.reason);
            const retryPrompt = `${prompt}

════════════════════════════════════════
CRITICAL RETRY — PREVIOUS OUTPUT REJECTED
════════════════════════════════════════
Your previous draft was REJECTED because: ${topicAlignment.reason}
You MUST write ONLY about "${keyword}" for the ${market} market.
- The <h1> MUST include "${keyword}" or a natural variant (e.g. "EV Charger Guide" for "ev charger")
- Every section must stay on this topic — do NOT write about cryptocurrency, unrelated industries, or other subjects
- Author MUST be Kamran Gul — never invent names like Sarah Chen
- Use ${new Date().toLocaleString('en-GB', { month: 'long' })} ${new Date().getFullYear()} dates only
Write the complete corrected article now. HTML only.`;

            const retryResponse = await anthropic.messages.create({
              model: MODEL_FOR.articleWriting,
              max_tokens: 8000,
              messages: [{ role: 'user', content: retryPrompt }],
            });
            const retryText = retryResponse.content[0].type === 'text' ? retryResponse.content[0].text : '';
            if (retryText.length > 500) {
              fullArticle = retryText;
              validated = await validateAndCorrect(fullArticle, keyword, market, liveFacts);
              fullArticle = validated.article;
              topicAlignment = checkTopicAlignment(fullArticle, keyword);
              console.log('[article-v2] topic retry result:', topicAlignment);
            }
          }

          try {
            fullArticle = await enforceWordCountLimit(fullArticle, targetWordCount);
          } catch (wcErr) {
            console.warn('[article-v2] word count enforce failed, continuing:', wcErr);
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
          // Schema generation moved below, after heroImageUrl is known —
          // real image URL is passed into generateArticleSchema directly.
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
          const articleWordCount = countArticleWords(fullArticle);
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
          // Hoisted so the IndexNow ping (fired after the Supabase save,
          // outside this function's inner try block) can reuse the same
          // full URL already computed for the schema/canonical tag, instead
          // of a third independent computation.
          let fullArticleUrl: string | undefined;
          // Hoisted so the link audit below (and anything else after this
          // try block) can check the actual final text, not the pre-
          // humanization draft — falls back to fullArticle if the try block
          // below fails before reassigning it.
          let finalHtml = fullArticle;
          // What actually gets saved/published — withImages when image
          // injection ran, else finalHtml. Set alongside finalHtml below;
          // separate variable because withImages is scoped inside the
          // `if (imageSet)` block and images are optional.
          let publishedHtml = fullArticle;
          // Hoisted alongside finalHtml/publishedHtml above — built inside
          // the try block once heroImageUrl is known, but referenced again
          // below when the API response is assembled.
          let schemaResult: ReturnType<typeof generateArticleSchema> | null = null;
          // One id for this whole generation request — used both as the
          // image storage folder's uniqueness suffix (so two articles on
          // the same keyword never overwrite each other's images, see
          // buildStoragePath) and as the Quality Gate's articleId, so the
          // two logs can be cross-referenced for the same generation.
          const articleInstanceId = crypto.randomUUID();
          // Non-empty means this generation fails a hard pre-save gate
          // (missing figures despite a generated hero image, or missing
          // Article.image/Organization.logo schema per schema-validate.ts)
          // — the Supabase persist step below skips the insert entirely
          // rather than saving a figureless/schema-incomplete article.
          const hardBlockReasons: string[] = [];
          // One instant used for BOTH schema dateModified and the visible
          // "Last verified" line, so the two always agree.
          const generatedAt = new Date().toISOString();
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

            // ── Sequential body transforms on ONE html variable ──────────
            // Each step below is independently try/caught and REASSIGNS
            // finalHtml only on its own success. This replaced a single
            // broad try/catch spanning this entire stretch: any failure
            // anywhere in it — including in steps with no real relationship
            // to imaging, like getBrandSettings or the canonical-tag
            // builder — silently reset publishedHtml back to the raw
            // pre-humanized draft and discarded the already-resolved
            // imageSet entirely. That's why articles occasionally saved
            // with images successfully generated (confirmed via
            // image_generation_logs) but zero <figure> tags in the saved
            // content: image generation succeeded, but an unrelated LATER
            // step threw, and the one shared catch swallowed everything.
            finalHtml = humanized.humanizedHtml;

            let citationLinkIssues: CitationLinkIssue[] = [];
            try {
              const citationCheck = await validateCitationLinks(finalHtml, {
                skipUrls: linksRequestedFromModel.map(l => l.url).filter(Boolean),
                skipDomains: citationDomain ? [citationDomain] : [],
              });
              finalHtml = citationCheck.html;
              citationLinkIssues = citationCheck.issues;
              if (citationLinkIssues.length > 0) {
                console.warn(
                  `[article-v2] citation link validation: stripped ${citationLinkIssues.length} broken/fake citation link(s):`,
                  citationLinkIssues.map(i => `${i.url} (${i.reason}: ${i.detail})`)
                );
              }
            } catch (citationErr) {
              console.warn('[article-v2] citation link validation failed, continuing:', citationErr);
            }

            try {
              const factResult = await checkAndPatchFactSourcing(finalHtml, keyword, market);
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

            // Dated-claim detection — global/market-agnostic pattern
            // (chrono-node temporal extraction + fact-checker.ts's named-
            // source check), runs on the humanized+fact-checked text before
            // schema/enrichment tags are appended so it only ever scans
            // real article prose. Unsourced results become blocking Quality
            // Gate issues below, alongside the citation-link issues.
            let datedClaimIssues: QualityIssue[] = [];
            try {
              const datedClaims = detectDatedClaims(finalHtml, new Date(generatedAt));
              const unsourced = datedClaims.filter(c => !c.hasSource)
              const uniqueUnsourced = Array.from(
                new Map(unsourced.map(c => [c.sentence.trim(), c])).values()
              )
              if (uniqueUnsourced.length > 0) {
                datedClaimIssues = uniqueUnsourced.map((claim, i) => ({
                  id: `dated-claim-${i}`,
                  severity: 'warning' as const,
                  category: 'dated-policy' as const,
                  title: `Dated claim — confirm still current: "${claim.text}"`,
                  description: `"${claim.sentence}" — tied to a date but no named source or link found nearby. Add a GOV.UK citation or verify the figure is still accurate. Re-check by ${claim.reviewBy.slice(0, 10)}.`,
                  location: claim.sentence.slice(0, 100),
                  autoFixable: false,
                }));
                console.warn(`[article-v2] dated-claim-detector: ${uniqueUnsourced.length} unsourced dated claim(s) found`);
              }
            } catch (datedErr) {
              console.warn('[article-v2] dated-claim detection failed, continuing:', datedErr);
            }

            if (imageSet?.hero?.url) {
              heroImageUrl = imageSet.hero.url;
            }

            // Schema must reflect the actual brand/site this article is being
            // written for — never SEORANKO itself (SEORANKO is the tool, not
            // the publisher of the client's content) and never a hardcoded
            // author name regardless of who the brand actually is.
            const schemaOrgName = brand || citationDomain || 'this site';
            // organizationUrl previously ONLY came from the separate `domain`
            // field — if that was empty (as here: brand='ev.autodun.com' but
            // domain='') it silently fell back to generateArticleSchema's own
            // default (https://seoranko.com), publishing SEORANKO itself as
            // the article's publisher. Brand is very often itself a domain
            // (e.g. 'ev.autodun.com', 'autodun.com') — use it directly when
            // it looks like one and no separate domain was supplied.
            const brandLooksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(brand.trim());
            const schemaOrgUrl = citationDomain
              ? `https://${citationDomain}`
              : brandLooksLikeDomain
                ? `https://${brand.trim()}`
                : undefined;
            // Shared by the JSON-LD schema below, the OG/Twitter tags, the
            // canonical tag, and the IndexNow ping after save — one full
            // canonical-style URL, computed once. Hoisted (see
            // `let fullArticleUrl` above) so the IndexNow ping, which fires
            // outside this try block after the Supabase save, can reuse it.
            fullArticleUrl = schemaOrgUrl ? `${schemaOrgUrl}${articleSlug}` : `https://example.com${articleSlug}`;

            // brand_settings.logo_url — feeds Organization/Article-publisher
            // schema's logo. Quality Gate gets expectOrganizationLogo below
            // so validator matches generator when logo_url is unset. Own
            // try/catch: a Supabase lookup failure here must not discard
            // already-successful humanization/images.
            let brandSettings: { configured: boolean; logoUrl: string | null } = { configured: false, logoUrl: null };
            try {
              brandSettings = brand ? await getBrandSettings(userId as string, brand) : { configured: false, logoUrl: null };
            } catch (brandErr) {
              console.warn('[article-v2] getBrandSettings failed, continuing without brand settings:', brandErr);
            }

            try {
              schemaResult = generateArticleSchema({
                title: articleTitle,
                description: articleDescription,
                keyword,
                market,
                // generateArticleSchema hardcodes author.@type to "Person" —
                // passing an org/brand name here would claim a person is
                // literally named "autodun" or a domain string. organizationName
                // below is the correctly-typed Organization field (publisher)
                // this fix is actually for; author identity is a separate,
                // deliberately-deferred question (see prior session notes on
                // the author-bio template assuming a specific person).
                authorName: 'Kamran Gul',
                publishDate: generatedAt,
                dateModified: generatedAt,
                articleUrl: fullArticleUrl,
                imageUrl: heroImageUrl || undefined,
                wordCount: factDensityResult.wordCount,
                faqs: faqs.length > 0 ? faqs : undefined,
                isHowTo,
                howToSteps: isHowTo ? extractHowToSteps(fullArticle) : undefined,
                organizationName: schemaOrgName,
                organizationUrl: schemaOrgUrl,
                organizationLogoUrl: brandSettings.logoUrl || undefined,
              });
              finalHtml = `${finalHtml}\n\n${schemaResult.combinedScriptTag}`;

              // Hard pre-save assertion (FIX 2) — Article.image and
              // Organization.logo, per Google's structured-data guidance.
              // Missing Article.image always blocks; missing
              // Organization.logo only blocks once this brand has genuinely
              // configured settings (mirrors RULE 6's existing suppression
              // for a brand that's never touched Settings at all — see
              // article-quality-gate.ts).
              const schemaCheck = assertSchemaCompleteness({
                imageUrl: schemaResult.imageUrl,
                organizationLogoUrl: schemaResult.organizationLogoUrl,
                logoOmittedReason: schemaResult.logoOmittedReason,
                hasBrandSettingsConfigured: brandSettings.configured,
              });
              if (schemaCheck.blocked) {
                hardBlockReasons.push(...schemaCheck.reasons);
                console.error('[article-v2] schema completeness check failed:', schemaCheck.reasons);
              }
            } catch (schemaErr) {
              console.warn('[article-v2] schema generation failed, continuing without schema:', schemaErr);
            }

            try {
              const socialTags = buildSocialMetaTags({
                title: articleTitle,
                description: articleDescription,
                url: fullArticleUrl,
                imageUrl: heroImageUrl,
              });
              finalHtml = `${finalHtml}\n\n${socialTags}`;
            } catch (socialErr) {
              console.warn('[article-v2] social meta tags failed, continuing without them:', socialErr);
            }

            try {
              // Same fullArticleUrl already computed above for the schema
              // and OG tags (including its https://example.com fallback
              // when brand/domain is genuinely absent), so the canonical
              // tag, schema, and OG tags always agree on the URL.
              finalHtml = `${finalHtml}\n\n${buildCanonicalTag(fullArticleUrl)}`;
            } catch (canonicalErr) {
              console.warn('[article-v2] canonical tag failed, continuing without it:', canonicalErr);
            }

            try {
              // Visible evidence of when dated claims (if any were found
              // above) were checked — same generatedAt instant schema's
              // dateModified was set from, so the visible date and the
              // schema date always agree.
              finalHtml = `${finalHtml}\n\n${buildLastVerifiedLine(generatedAt)}`;
            } catch (verifiedErr) {
              console.warn('[article-v2] "Last verified" line failed, continuing without it:', verifiedErr);
            }

            try {
              // Mechanical scannability safety net — the write prompt's
              // SCANNABILITY RULE is a request, not a guarantee. Split any
              // paragraph the model still wrote as 6+ sentences before the
              // Quality Gate's scannability check scores it.
              finalHtml = autoSplitDenseParagraphs(finalHtml);
            } catch (splitErr) {
              console.warn('[article-v2] autoSplitDenseParagraphs failed, continuing:', splitErr);
            }

            try {
              // Table of contents — only kicks in above the word threshold;
              // this template currently targets ~1,340 words, so it won't
              // fire on typical output today unless wordCount settings change.
              finalHtml = insertTableOfContents(finalHtml, articleWordCount);
            } catch (tocErr) {
              console.warn('[article-v2] insertTableOfContents failed, continuing:', tocErr);
            }

            // Quality gate — runs after humanization + fact-sourcing; auto-fixes applied to finalHtml
          try {
            const registeredDomains = citationDomain
              ? [citationDomain]
              : (brand ? [`${brand}.com`] : [])
            const qr = await runQualityGate(finalHtml, {
              brand,
              keyword,
              authorName: 'Kamran Gul',
              registeredLinkDomains: registeredDomains,
              minWordCount: Math.floor(targetWordCount * 0.85),
              maxWordCount: Math.ceil(targetWordCount * 1.12),
              maxTypically: 5,
              userId: (userId as string) || undefined,
              articleId: articleInstanceId,
              brief: (entities as string[]).length > 0 || (topicalGaps as string[]).length > 0
                ? { entities: entities as string[], topicalGaps: topicalGaps as string[] }
                : undefined,
              secondaryKeywords: secondaryKeywords as string[],
              // Dead/fake citations are stripped above — logged to console,
              // not surfaced as blocking QG issues (published HTML is clean).
              extraIssues: datedClaimIssues.length > 0 ? datedClaimIssues : undefined,
              // Matches schema-generator: omit logo warnings when no logo_url.
              expectOrganizationLogo: !!brandSettings.logoUrl,
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
          publishedHtml = finalHtml;

            // Image injection ALWAYS runs when imageSet resolved, regardless
            // of whether any enrichment step above failed — this is the
            // actual fix for the "images generated but never inserted" bug
            // (FIX 1). Previously this whole block lived inside the same
            // try/catch as every unrelated step above it, so a
            // getBrandSettings/schema/social-tag failure discarded imageSet
            // entirely even though it had already resolved successfully.
            if (imageSet) {
              try {
                const withImages = injectImagesIntoArticle(finalHtml, imageSet);

                // Hard post-condition: a hero image exists but the
                // serialized HTML has zero <figure> tags means injection
                // silently no-opped — never save a figureless article when
                // images were actually generated.
                const figureCount = (withImages.match(/<figure[\s>]/gi) || []).length;
                if (imageSet.hero?.url && figureCount === 0) {
                  throw new Error(
                    `Image hand-off post-condition failed: imageSet.hero.url is set (${imageSet.hero.url}) but the serialized article has 0 <figure> tags after injection.`
                  );
                }

                publishedHtml = withImages;

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
              } catch (imgInjectErr) {
                const msg = imgInjectErr instanceof Error ? imgInjectErr.message : String(imgInjectErr);
                console.error('[article-v2] image injection post-condition failed:', msg);
                hardBlockReasons.push(msg);
                if (articleQualityGate) {
                  const blockIssue: QualityIssue = {
                    id: 'image-figure-hand-off-failed',
                    severity: 'critical',
                    category: 'image-completeness',
                    title: 'Hero image generated but not present in article HTML',
                    description: msg,
                    autoFixable: false,
                  };
                  articleQualityGate.issues = [...articleQualityGate.issues, blockIssue];
                  articleQualityGate.criticalCount += 1;
                  articleQualityGate.passed = false;
                  articleQualityGate.readyToPublish = false;
                  articleQualityGate.blockers = [...articleQualityGate.blockers, `[IMAGE-COMPLETENESS] ${blockIssue.title}`];
                }
                // publishedHtml stays at finalHtml (pre-injection) — the
                // figureless state is what gets blocked from saving below,
                // not silently shipped.
              }
            }

            // Paragraph-splitter (FIX 3) — after image injection, right
            // before save, so figure/figcaption markup doesn't shift
            // paragraph boundaries computed earlier in the pipeline.
            try {
              publishedHtml = splitDenseParagraphs(publishedHtml);
            } catch (splitErr) {
              console.warn('[article-v2] paragraph-splitter failed, continuing:', splitErr);
            }

            // Reconcile the Quality Gate's scannability finding against the
            // FINAL html. runQualityGate's RULE 10 scored finalHtml BEFORE
            // the splitter above ran (same timing gap as the image-placement
            // check further up), so without this the stored score would
            // keep reporting a "N paragraphs are 6+ sentences" warning even
            // after those paragraphs were actually split.
            try {
              const remainingScannability = validateArticleStructure(publishedHtml).filter(i => i.category === 'scannability');
              if (articleQualityGate) {
                const hadScannabilityIssue = articleQualityGate.issues.some(i => i.category === 'scannability');
                if (hadScannabilityIssue && remainingScannability.length === 0) {
                  const removed = articleQualityGate.issues.filter(i => i.category === 'scannability');
                  articleQualityGate.issues = articleQualityGate.issues.filter(i => i.category !== 'scannability');
                  articleQualityGate.warningCount = Math.max(0, articleQualityGate.warningCount - removed.filter(i => i.severity === 'warning').length);
                  articleQualityGate.criticalCount = Math.max(0, articleQualityGate.criticalCount - removed.filter(i => i.severity === 'critical').length);
                  articleQualityGate.score = Math.min(100, articleQualityGate.score + removed.length * 5);
                  articleQualityGate.readyToPublish = articleQualityGate.criticalCount === 0 && articleQualityGate.warningCount <= 2;
                } else if (!hadScannabilityIssue && remainingScannability.length > 0) {
                  // Safety net only — shouldn't normally fire once the
                  // splitter above ran, but a paragraph that's over budget
                  // on words alone (not sentence count) could still slip
                  // through un-flagged by structure-validator's own
                  // sentence-only threshold in rare shapes.
                  const mapped: QualityIssue[] = remainingScannability.map((si, i) => ({
                    id: `structure-scannability-post-${i}`,
                    severity: si.severity,
                    category: si.category,
                    title: si.message,
                    description: si.message,
                    autoFixable: false,
                  }));
                  articleQualityGate.issues = [...articleQualityGate.issues, ...mapped];
                  articleQualityGate.warningCount += mapped.filter(m => m.severity === 'warning').length;
                  articleQualityGate.criticalCount += mapped.filter(m => m.severity === 'critical').length;
                  articleQualityGate.score = Math.max(0, articleQualityGate.score - mapped.length * 5);
                  articleQualityGate.readyToPublish = articleQualityGate.criticalCount === 0 && articleQualityGate.warningCount <= 2;
                }
              }
            } catch (reconcileErr) {
              console.warn('[article-v2] scannability reconciliation failed, continuing:', reconcileErr);
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

          // ── Persist to Supabase ──────────────────────────────────────────
          // This is the entire reason the `articles` table had 0 rows in
          // production: this route streamed the generated article back to
          // the browser and never wrote it anywhere. Every downstream reader
          // (Topical Map, Cannibalisation Detector, ROI Dashboard, RANKO
          // diagnose) was correctly showing empty — there was genuinely
          // nothing there. A save failure here must not silently produce a
          // 200 with a generated-but-unsaved article — see saveError below,
          // surfaced through SEORANKO_SCORES rather than the fatal
          // SEORANKO_ERROR marker, since the article itself is still good;
          // only persistence failed, and discarding a successful generation
          // over that would be a worse outcome than the current bug.
          let savedArticleId: string | undefined;
          let saveError: string | undefined;
          const saveTopicCheck = checkTopicAlignment(publishedHtml, keyword);
          if (!saveTopicCheck.aligned) {
            hardBlockReasons.push(`Topic mismatch — ${saveTopicCheck.reason}`);
            if (articleQualityGate) {
              articleQualityGate.passed = false;
              articleQualityGate.readyToPublish = false;
              articleQualityGate.criticalCount += 1;
              articleQualityGate.blockers = [
                ...articleQualityGate.blockers,
                `[TOPIC-ALIGNMENT] Article is not about "${keyword}"`,
              ];
            }
          }
          if (hardBlockReasons.length > 0) {
            // FIX 1 / FIX 2 hard gate: a hero image was generated but never
            // made it into the HTML, or Article.image/Organization.logo
            // schema is missing/invalid. The article is still streamed back
            // to the client above for visibility/debugging, but it is
            // deliberately never written to `articles` — do not save a
            // figureless or schema-incomplete article.
            saveError = `Blocked by hard quality gate — article was not saved: ${hardBlockReasons.join(' | ')}`;
            console.error(`[article-v2] ${saveError}`);
          } else if (userId) {
            try {
              const db = getServiceSupabase();
              const { data: savedArticle, error: insertError } = await db
                .from('articles')
                .insert({
                  user_id: userId,
                  title: articleTitle,
                  meta_description: articleDescription,
                  content: publishedHtml,
                  keyword,
                  word_count: factDensityResult.wordCount,
                  eeat_score: eeatScore,
                  readability_score: readabilityScore,
                  keyword_density: String(keywordDensity),
                  status: 'draft',
                  brand: brand || null, // never fabricate a company name in persisted data
                  article_url: articleUrl,
                  rank_score: rankScore,
                  fact_density_score: factDensityResult.score,
                  human_score: humanScore ?? null,
                  quality_score: articleQualityGate?.score ?? null,
                  quality_passed: articleQualityGate?.passed ?? null,
                  quality_issues: articleQualityGate?.issues ?? [],
                  quality_auto_fixed: articleQualityGate?.autoFixedCount ?? 0,
                  quality_ready_to_publish: articleQualityGate?.readyToPublish ?? false,
                  quality_checked_at: articleQualityGate ? new Date().toISOString() : null,
                  // entity_score/entity_count/top_entities intentionally omitted —
                  // no entity-scoring exists anywhere in this pipeline yet.
                })
                .select('id')
                .single();

              if (insertError) throw insertError;
              savedArticleId = savedArticle.id;
              console.log(`[article-v2] saved article ${savedArticleId} for user ${userId}`);

              // Fire-and-forget — never block/fail the response on IndexNow.
              // No-ops itself (see indexnow.ts) if INDEXNOW_KEY isn't
              // configured or the URL is still the example.com placeholder.
              const indexNowUrl = fullArticleUrl || `https://example.com${articleSlug}`;
              pingIndexNow(indexNowUrl)
                .then(result => {
                  if (result.fired) console.log(`[indexnow] pinged for ${indexNowUrl}: ${result.reason}`);
                  else console.log(`[indexnow] skipped for ${indexNowUrl}: ${result.reason}`);
                })
                .catch(err => console.warn('[indexnow] ping failed:', err));

              // Fire-and-forget, matches pages.ts's "instrumentation must
              // not break the pipeline" philosophy — usage counters and
              // pipeline-stage tracking should never fail the response.
              (async () => {
                try {
                  const { data: profile } = await db
                    .from('user_profiles')
                    .select('articles_used_today, articles_used_month')
                    .eq('id', userId)
                    .single();
                  await db.from('user_profiles').update({
                    articles_used_today: (profile?.articles_used_today ?? 0) + 1,
                    articles_used_month: (profile?.articles_used_month ?? 0) + 1,
                  }).eq('id', userId);
                } catch (usageErr) {
                  console.warn('[article-v2] usage counter update failed:', usageErr);
                }
              })();

              if (pageId) {
                void stampStage(db, pageId as string, STAGE.QA, { article_id: savedArticleId });
              }
            } catch (err) {
              saveError = err instanceof Error ? err.message : String(err);
              console.error('[article-v2] FAILED to save article to Supabase:', saveError);
            }
          } else {
            saveError = 'No authenticated user — article was generated but not saved. Please sign in and regenerate.';
            console.warn('[article-v2] skipped save: no userId on request');
          }

          // Append score metadata as a parseable HTML comment — client strips this
          const scoreMeta = JSON.stringify({
            searchScore, aiScore, eeatScore, readabilityScore, keywordDensity, keywordDensityScore,
            factSourcingScore, factPatchedCount, llmsTxtEntry, humanScore, bannedWordsRemoved, passesDetection,
            rankScore,
            articleId: savedArticleId,
            saveError,
            factDensity: {
              score: factDensityResult.score,
              grade: factDensityResult.grade,
              factsPerHundredWords: factDensityResult.factsPerHundredWords,
              suggestions: factDensityResult.suggestions,
            },
            faqs,
            answerFirst,
            hasSchema: !!schemaResult,
            schemaScriptTag: schemaResult?.combinedScriptTag ?? '',
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
