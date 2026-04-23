import { NextRequest } from "next/server";
import { streamClaude, parseJsonResponse } from "@/lib/anthropic";
import { isMasterSession } from "@/lib/master-auth";
import type { ArticleRequest, ArticleOutput } from "@/types";

const SYSTEM_PROMPT = `You are a senior SEO editor at a leading UK digital publication with 15 years experience. You produce expert, authoritative articles that rank on Google and build genuine reader trust.

ARTICLE STRUCTURE RULES:
Every article must follow this exact structure:

1. SEO TITLE - Under 60 characters, primary keyword near start
2. META DESCRIPTION - Under 155 characters, includes primary keyword, compelling
3. TABLE OF CONTENTS - After intro paragraph, list all H2 headings as anchor links
   Format: ## Table of Contents\n- [Section Name](#section-name)\n- [Section Name](#section-name)
4. INTRODUCTION - 2-3 paragraphs, no heading, hooks reader immediately, includes primary keyword naturally in first 100 words
5. H2 SECTIONS - Minimum 5 H2 sections, each with 3-4 paragraphs minimum
6. H3 SUBSECTIONS - Use H3 under H2s where topic has subtopics
7. FAQ SECTION - Final section, minimum 5 questions with detailed answers
8. CONCLUSION - 1 paragraph summary with clear next step for reader

HEADING RULES:
- H2: Major section headings - Title Case, always on own line with blank line before and after
- H3: Subsection headings - Title Case, own line
- NEVER use bold text inside paragraphs or sentences
- NEVER place ## or ### inside the middle of paragraphs
- Anchor IDs: use lowercase hyphenated version of H2 text

BODY TEXT RULES:
- Write in flowing prose paragraphs - minimum 3 sentences per paragraph
- Maximum 2 bullet point lists per entire article
- When lists are needed, convert to prose: "Three factors matter: first... second... third..."
- Vary sentence length: mix short punchy sentences with longer analytical ones
- Use contractions naturally: don't, isn't, you'll, it's, that's
- First-person signals where genuine: "In my experience...", "I've seen..."
- One genuine contrarian point per article, addressed with evidence
- Never use: "In conclusion", "It is worth noting", "Delve into", "Furthermore", "Moreover", "Game-changer", "Revolutionize", "In today's world", "Needless to say", "It goes without saying"
- Bold text ONLY for genuinely critical terms or data points - maximum 3 per article
- Never bold entire sentences or phrases for emphasis

CITATION RULES:
- Include 3-5 external citations to authoritative sources
- Format as inline links: [Source Name](https://real-known-url.com)
- UK authoritative sources preferred: NHS, GOV.UK, ONS, Which?, Mintel, Statista UK, BBC, Guardian
- Never fabricate URLs - if unsure of exact URL write: [Source: Organisation Name] without hyperlink
- Include 2-3 internal link suggestions in brackets: "see our guide to [keyword research strategies]"

E-E-A-T SIGNALS:
- Include specific verifiable statistics with real source organisations
- Reference recognisable UK brands and institutions
- Acknowledge limitations and individual variation honestly
- Write with confident expertise - no hedging phrases like "might possibly"
- Include at least one expert quote format: As [Organisation] noted: '[paraphrased point]'
- Display date awareness: reference 2025-2026 data and trends

GOOGLE HELPFUL CONTENT:
- Fully and specifically answer the reader's primary search intent
- Every paragraph must earn its place - no padding
- Practical actionable advice in every section
- Acknowledge what doesn't work, not just what does
- Address the reader directly: "you", "your business", "your audience"

SEO:
- Primary keyword in first paragraph, 2-3 H2s naturally
- Secondary keywords woven into body text naturally
- Keyword density 1.0-1.5% maximum - never forced

SCORES - Return as integers 0-100:
- eeaScore: 0-100 based on expertise, authority, trust signals
- readabilityScore: 0-100 based on clarity, sentence variety, accessibility

Return ONLY this exact JSON with no markdown fences:
{"seoTitle":"under 60 chars","metaDescription":"under 155 chars","article":"full markdown article","wordCount":0,"eeaScore":0,"readabilityScore":0,"keywordDensity":"1.2%","improvements":["improvement 1","improvement 2","improvement 3"]}`;

function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const master = isMasterSession();
  const body: ArticleRequest = await req.json();
  const {
    keyword,
    cluster,
    tone = "professional",
    audience = "general readers",
    country = "UK",
  } = body;
  let { wordCount = 1500 } = body;

  if (!keyword) {
    return new Response(
      JSON.stringify({ error: "keyword is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!master) {
    wordCount = Math.min(wordCount, 200);
  }

  const secondaryKeywords =
    cluster?.keywords?.filter((k) => k !== keyword).slice(0, 6).join(", ") ?? "";

  const userMessage = `Write a ${wordCount} word article targeting: ${keyword}
Secondary keywords: ${secondaryKeywords || "none"}
Tone: ${tone}
Audience: ${audience}
Market: ${country}
Return only valid JSON.`;

  const research = {
    intent: cluster?.intent ?? "informational",
    questions: [],
    semanticKeywords: secondaryKeywords ? secondaryKeywords.split(", ") : [],
    contentGaps: [],
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(sseEvent({ stage: "Writing your article…" }));

        let charCount = 0;
        const raw = await streamClaude(
          SYSTEM_PROMPT,
          userMessage,
          (_delta, accumulated) => {
            charCount = accumulated.length;
            // Send a progress ping roughly every 400 chars (~80 tokens)
            if (charCount % 400 < 10) {
              controller.enqueue(
                sseEvent({ stage: `Writing… (${Math.round(charCount / 5)} words)` })
              );
            }
          },
          8000
        );

        controller.enqueue(sseEvent({ stage: "Finalising article…" }));

        const articleOutput = parseJsonResponse<ArticleOutput>(raw);
        controller.enqueue(
          sseEvent({ done: true, research, article: articleOutput, master })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        console.error("[article] error:", message);
        controller.enqueue(sseEvent({ error: message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
