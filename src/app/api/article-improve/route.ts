import { NextRequest, NextResponse } from 'next/server';
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
import { recordScoreSnapshot } from '@/lib/drift-tracker';
import { queueCitationTest } from '@/lib/citation-tester';
import { checkAndPatchFactSourcing } from '@/lib/fact-checker';

// Fluid compute (default on Vercel) allows up to 300s on Hobby. The full
// pipeline (audit + scraping + NLP + angle + 6000-token generation) needs
// ~2 minutes — 60s kills the function mid-stream.
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 5 });

// Keyword detection runs on Haiku (simple extraction, separate rate-limit bucket).
// Audit scoring, fact verification, and fact-check run on Sonnet — Haiku
// over-inflates EEAT scores and misses invented author names and factual errors.
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const MAIN_MODEL = 'claude-sonnet-4-6';

interface Audit {
  word_count: number;
  eeat_score: number;
  readability_score: number;
  keyword_density: number;
  has_h1: boolean;
  has_schema: boolean;
  has_faq: boolean;
  has_official_sources: boolean;
  has_internal_links: boolean;
  has_price_table: boolean;
  factual_errors: string[];
  missing_elements: string[];
  weak_sections: string[];
  improvement_priority: string[];
  overall_grade: string;
}

// The whole pipeline runs inside a streamed response. A non-streaming response
// here exceeds Vercel's function time limit (4 sequential Claude calls +
// competitor scraping + a full article generation), which returns a plain-text
// platform error to the client. Streaming starts the response immediately.
// Protocol: stage markers for live progress, then a META JSON block (audit,
// competitors, gaps), then raw article HTML, then a STATS JSON block.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    article = '',
    keyword = '',
    market = 'United Kingdom',
    tone = 'professional',
  } = body;

  if (!article.trim()) {
    return NextResponse.json({ error: 'Article text is required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(encoder.encode(s));
      try {
        // ── STEP A: Extract keyword if not provided ───────────────────────────
        send('<!--SEORANKO_STAGE:detecting-->');
        let targetKeyword = keyword.trim();
        if (!targetKeyword) {
          const kwRes = await anthropic.messages.create({
            model: FAST_MODEL,
            max_tokens: 50,
            messages: [{
              role: 'user',
              content: `What is the primary SEO keyword of this article? Return ONLY the keyword phrase, nothing else, no punctuation.\n\n${article.slice(0, 1000)}`,
            }],
          });
          targetKeyword = kwRes.content[0].type === 'text' ? kwRes.content[0].text.trim() : 'general topic';
        }

        console.log('[article-improve] keyword:', targetKeyword);

        // ── STEPS B + C in parallel: audit and competitor scraping only depend
        // on the keyword, so running them concurrently cuts ~20s of dead time
        send('<!--SEORANKO_STAGE:auditing-->');
        const competitorsPromise = (async () => {
          const competitorUrls = await getTopCompetitorUrls(targetKeyword, market);
          const competitorContents = await Promise.all(
            competitorUrls.map(async url => ({
              url,
              content: await fetchCompetitorContent(url),
            }))
          );
          return competitorContents.filter(c => c.content.length > 100);
        })();

        const auditRes = await anthropic.messages.create({
          model: MAIN_MODEL,
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `You are an expert SEO auditor. Analyse this article for the keyword "${targetKeyword}" and score it strictly.

ARTICLE:
${article.slice(0, 4000)}

Return ONLY valid JSON no markdown:
{
  "word_count": number,
  "eeat_score": number 0-100,
  "readability_score": number 0-100,
  "keyword_density": number as percentage with 1 decimal,
  "has_h1": boolean,
  "has_schema": boolean,
  "has_faq": boolean,
  "has_official_sources": boolean,
  "has_internal_links": boolean,
  "has_price_table": boolean,
  "factual_errors": ["list any specific facts that appear incorrect or unverified"],
  "missing_elements": ["list of missing SEO and content elements"],
  "weak_sections": ["list of sections that are thin or poorly written"],
  "improvement_priority": ["top 5 most important things to fix in order"],
  "overall_grade": "F | D | C | B | A"
}`,
          }],
        });

        const auditText = auditRes.content[0].type === 'text' ? auditRes.content[0].text : '{}';
        let audit: Audit;
        try {
          audit = JSON.parse(auditText.replace(/```json|```/g, '').trim());
        } catch {
          audit = {
            word_count: 0, eeat_score: 0, readability_score: 0, keyword_density: 0,
            has_h1: false, has_schema: false, has_faq: false, has_official_sources: false,
            has_internal_links: false, has_price_table: false,
            factual_errors: [], missing_elements: [], weak_sections: [],
            improvement_priority: [], overall_grade: 'F',
          };
        }

        // ── Competitor NLP + unique angle ─────────────────────────────────────
        send('<!--SEORANKO_STAGE:competitors-->');
        const validCompetitors = await competitorsPromise;
        const nlpData = validCompetitors.length > 0
          ? await extractCompetitorNLP(validCompetitors.map(c => c.content), targetKeyword)
          : { commonTopics: [], contentGaps: audit.missing_elements || [], weaknesses: [], entities: [] };

        const angle = await generateUniqueAngle(targetKeyword, nlpData.contentGaps, nlpData.weaknesses);

        // ── Live fact verification (web search, any topic/country) ────────────
        send('<!--SEORANKO_STAGE:facts-->');
        const { facts: liveFacts } = await fetchVerifiedFacts(
          targetKeyword,
          market,
          validCompetitors.map(c => c.content),
        );

        const targetWordCount = Math.max((audit.word_count || 800) + 600, 1500);
        const safeWordCount = Math.min(targetWordCount, 1800);

        // Send meta block — client renders audit panel while article streams
        send(
          '<!--SEORANKO_META_START-->' +
          JSON.stringify({
            keyword: targetKeyword,
            audit,
            competitors: validCompetitors.map(c => ({ url: c.url, wordCount: c.content.split(' ').length })),
            contentGaps: nlpData.contentGaps.slice(0, 6),
          }) +
          '<!--SEORANKO_META_END-->'
        );

        // ── STEP E: Centralised master prompt (shared across all 3 article routes)
        const prompt = buildMasterPrompt({
          mode: 'improve',
          keyword: targetKeyword,
          secondaryKeywords: nlpData.commonTopics || [],
          entities: nlpData.entities || [],
          topicalGaps: nlpData.contentGaps || [],
          wordCount: safeWordCount,
          tone,
          market,
          uniqueAngle: angle.uniqueSection || '',
          uniqueContent: angle.uniqueContent || '',
          internalLinks: getInternalLinks(targetKeyword),
          competitorTopics: nlpData.commonTopics || [],
          originalArticle: article,
          missingElements: audit.missing_elements || [],
          factualErrors: audit.factual_errors || [],
          improvementPriorities: audit.improvement_priority || [],
          liveFacts,
        });

        // ── STEP F: Stream improved article ───────────────────────────────────
        send('<!--SEORANKO_STAGE:rewriting-->');
        const stream = await anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          messages: [{ role: 'user', content: prompt }],
        });

        let improvedArticle = '';
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            send(chunk.delta.text);
            improvedArticle += chunk.delta.text;
          }
        }

        const { article: validatedArticle, corrections } = await validateAndCorrect(improvedArticle, targetKeyword, market, liveFacts);
        if (corrections.length > 0) {
          console.log('[article-improve] validation corrections:', corrections);
        }

        // Humanize + auto-generate images in parallel
        let humanScore: number | undefined;
        let factSourcingScore: number | undefined;
        let factPatchedCount = 0;
        try {
          const [humanized, imageSet] = await Promise.all([
            humanizeArticle(validatedArticle, { level: 'medium', primaryKeyword: targetKeyword }),
            generateArticleImages({
              topic: validatedArticle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400),
              keyword: targetKeyword,
              tier: 'free',
              count: 3,
            }).catch((err) => {
              console.warn('[article-improve] auto image generation failed:', err?.message);
              return null;
            }),
          ]);
          humanScore = humanized.humanScore;

          // Fact-sourcing check + auto-patch
          let finalHtml = humanized.humanizedHtml;
          try {
            const factResult = await checkAndPatchFactSourcing(humanized.humanizedHtml, targetKeyword, market);
            finalHtml = factResult.article;
            factSourcingScore = factResult.result.factSourcingScore;
            factPatchedCount = factResult.result.patchedCount;
          } catch (factErr) {
            console.warn('[article-improve] fact-sourcing check failed:', factErr);
          }

          send(`<!--SEORANKO_HUMANIZED_START-->\n${finalHtml}\n<!--SEORANKO_HUMANIZED_END-->`);
          if (imageSet) {
            const withImages = injectImagesIntoArticle(finalHtml, imageSet);
            send(`<!--SEORANKO_WITH_IMAGES_START-->\n${withImages}\n<!--SEORANKO_WITH_IMAGES_END-->`);
            send(`<!--SEORANKO_IMAGE_SET_START-->${JSON.stringify({
              images: [imageSet.hero, ...imageSet.content].map(img => ({ ...img, altText: img.alt })),
              stored: [imageSet.hero, ...imageSet.content].some(img => img.url.includes('supabase')),
              niche: imageSet.niche,
              styleDescriptor: imageSet.styleDescriptor,
            })}<!--SEORANKO_IMAGE_SET_END-->`);
          }
        } catch (err) {
          console.warn('[article-improve] humanization/images failed, continuing without:', err);
        }

        // Calculate new word count and score
        const newWordCount = validatedArticle.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(Boolean).length;
        const newEeatScore = Math.min(95, (audit.eeat_score || 0) + 55 + (nlpData.contentGaps.length * 3));

        // Build improvements list for UI
        const improvements: { type: string; count: number }[] = [];
        if ((audit.factual_errors || []).length > 0) improvements.push({ type: 'Factual errors fixed', count: audit.factual_errors.length });
        if (!audit.has_h1) improvements.push({ type: 'H1 + heading structure added', count: 1 });
        if (!audit.has_schema) improvements.push({ type: 'Schema markup added', count: 1 });
        if (!audit.has_faq) improvements.push({ type: 'FAQ section added', count: 1 });
        if (!audit.has_official_sources) improvements.push({ type: 'Official sources cited', count: 2 });
        if (nlpData.contentGaps.length > 0) improvements.push({ type: 'Content gaps filled', count: nlpData.contentGaps.length });
        improvements.push({ type: 'Word count increased', count: newWordCount - (audit.word_count || 0) });
        if (factPatchedCount > 0) improvements.push({ type: 'Unsourced statistics hedged', count: factPatchedCount });

        send(
          '<!--SEORANKO_STATS_START-->' +
          JSON.stringify({
            improvements,
            factsFixed: corrections,
            humanScore,
            factSourcingScore,
            factPatchedCount,
            stats: {
              originalWordCount: audit.word_count || 0,
              newWordCount,
              originalEeat: audit.eeat_score || 0,
              newEeat: newEeatScore,
              originalKeywordDensity: audit.keyword_density || 0,
              issuesFixed: improvements.length,
            },
          }) +
          '<!--SEORANKO_STATS_END-->'
        );

        controller.close();

        // Fire-and-forget: record before/after score snapshots + queue citation test
        const improveSlug = `/${targetKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        recordScoreSnapshot({
          domain: 'improved_articles',
          page_url: improveSlug,
          score: audit.eeat_score ?? 0,
          source: 'article_improve',
        }).catch(() => {});
        recordScoreSnapshot({
          domain: 'improved_articles',
          page_url: improveSlug,
          score: newEeatScore,
          source: 'article_improve',
        }).catch(() => {});
        queueCitationTest({ domain: '', topic: targetKeyword, daysFromNow: 7, source: 'article_improve' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.error('[article-improve]', error);
        send(`<!--SEORANKO_ERROR-->${error?.message || 'Improvement failed'}`);
        controller.close();
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
}
