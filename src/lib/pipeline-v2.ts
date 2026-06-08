// src/lib/pipeline-v2.ts
// SEORANKO Article Pipeline v2 — 5-call fact-verified pipeline

import { getAnthropicClient } from './anthropic';
import {
  classifyTopic,
  searchAndCollectFacts,
  extractAndVerifyFacts,
  editorialAudit,
} from './fact-verifier';
import type { ArticleOutput } from '@/types';

export interface PipelineInput {
  keyword: string;
  systemPrompt: string;
  userMessage: string;
  publishedPages: string[];
  onStage?: (msg: string) => void;
}

export interface PipelineOutput {
  article: ArticleOutput;
  success: boolean;
  blockerReason?: string;
  pipelineLog: string[];
}

async function writeArticle(
  systemPrompt: string,
  userMessage: string,
  confirmedFacts: string,
  onProgress?: (chars: number) => void,
): Promise<ArticleOutput> {
  const client = getAnthropicClient();
  const enhancedMessage = confirmedFacts
    ? `${userMessage}\n\nVERIFIED FACTS — incorporate these exact facts (checked against live sources):\n${confirmedFacts}`
    : userMessage;

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: enhancedMessage }],
  });

  let accumulated = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      accumulated += event.delta.text;
      onProgress?.(accumulated.length);
    }
  }

  const cleaned = accumulated.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
  try { return JSON.parse(cleaned) as ArticleOutput; } catch { /* continue */ }
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) try { return JSON.parse(obj[0]) as ArticleOutput; } catch { /* continue */ }
  throw new Error(`Article JSON parse failed. First 200 chars: ${accumulated.slice(0, 200)}`);
}

export async function runArticlePipeline(input: PipelineInput): Promise<PipelineOutput> {
  const { keyword, systemPrompt, userMessage, publishedPages, onStage } = input;
  const log: string[] = [];

  const emit = (msg: string) => {
    log.push(msg);
    onStage?.(msg);
  };

  // ── CALL 1: Topic Classification ──────────────────────────
  emit('Step 1/5: Classifying topic and risk level...');
  const classification = await classifyTopic(keyword);
  emit(`Topic: ${classification.topic_category} | Risk: ${classification.risk_level} — ${classification.risk_reason}`);

  // ── CALL 2: Web Search ────────────────────────────────────
  emit('Step 2/5: Searching the web for up-to-date facts...');
  const rawFacts = await searchAndCollectFacts(
    keyword,
    classification.verification_queries,
    classification.risk_level,
  );
  emit('Web search complete — facts collected');

  // ── CALL 3: Fact Extraction & Verification ────────────────
  emit('Step 3/5: Extracting and verifying facts...');
  const factResult = await extractAndVerifyFacts(keyword, rawFacts);

  if (!factResult.safe_to_proceed) {
    emit(`BLOCKER: ${factResult.blocker_reason}`);
    return {
      article: {} as ArticleOutput,
      success: false,
      blockerReason: factResult.blocker_reason,
      pipelineLog: log,
    };
  }

  const confirmedFacts = factResult.verified_facts
    .filter(f => f.confidence === 'confirmed' || f.confidence === 'likely')
    .map(f => `- ${f.fact} [Source: ${f.source}]`)
    .join('\n');

  emit(`${factResult.verified_facts.length} facts verified, ${factResult.unverifiable_claims.length} flagged`);

  // ── CALL 4: Write Article ─────────────────────────────────
  emit('Step 4/5: Writing article with verified facts...');
  let lastMilestone = 0;
  const articleOutput = await writeArticle(
    systemPrompt,
    userMessage,
    confirmedFacts,
    (chars) => {
      const words = Math.round(chars / 5);
      if (words - lastMilestone >= 100) {
        lastMilestone = words;
        onStage?.(`Writing… (${words} words)`);
      }
    },
  );
  emit(`Article written — ${articleOutput.wordCount ?? 0} words`);

  // ── CALL 5: Editorial Audit ───────────────────────────────
  emit('Step 5/5: Running editorial and fact audit...');
  const audit = await editorialAudit(
    articleOutput.article,
    factResult.verified_facts,
    factResult.unverifiable_claims,
    publishedPages,
  );

  if (audit.broken_links.length > 0) {
    emit(`Removed ${audit.broken_links.length} broken internal link(s)`);
  }
  if (audit.schema_issues.length > 0) {
    emit(`Schema issues: ${audit.schema_issues.join(', ')}`);
  }
  emit(`Editorial audit complete — article ${audit.article_clean ? 'clean' : 'reviewed'}`);

  return {
    article: {
      ...articleOutput,
      article: audit.final_article || articleOutput.article,
    },
    success: true,
    pipelineLog: log,
  };
}
