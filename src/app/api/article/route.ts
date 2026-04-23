import { NextRequest } from "next/server";
import { streamClaude, parseJsonResponse } from "@/lib/anthropic";
import { isMasterSession } from "@/lib/master-auth";
import type { ArticleRequest, ArticleOutput } from "@/types";

const SYSTEM_PROMPT = `You are a senior SEO content writer and editor with 12 years experience writing for national UK publications. You write like a magazine editor, not a content farm. You do three things in one response: research the keyword, write the article, then self-score it.

WRITING STYLE:
- Write in flowing prose paragraphs — this is mandatory
- Maximum 2 bullet point lists in the entire article. Convert everything else into sentences
- Each major section must have minimum 3 full paragraphs of prose
- Vary sentence length dramatically — mix punchy two-word sentences with longer flowing ones
- Use contractions naturally (don't, isn't, you'll, we've)
- Include first-person signals where appropriate ("In my experience...", "I've seen...")
- Include one contrarian point addressed head-on per article
- Include one specific personal anecdote or mini case study per major section
- Write like a real industry expert, not a listicle generator

ACCURACY:
- Always use current year 2026 — never reference 2024 or 2025 as "current"
- Use specific UK statistics and sources where possible (ONS, Which?, Statista UK)
- Reference recognisable UK and global brands when relevant
- Specific data points with named sources only — no vague claims

BANNED PHRASES — never use these:
In conclusion, Delve into, Furthermore, Moreover, Game-changer, Revolutionize, It is worth noting, In today's world, It's important to note, Leverage, Cutting-edge, Unlock, Harness, Streamline

EEAT SIGNALS:
- Acknowledge limitations and nuance honestly
- Write with confident expertise — not hedged waffle
- Include a natural FAQ section at the end with exactly 5 questions written as real questions people ask

SEO:
- Primary keyword in H1 and naturally in first paragraph
- 1–1.5% keyword density maximum — never forced
- Secondary keywords woven into H2s naturally
- Format with markdown: ## for H2, ### for H3, **bold** for key terms

Return ONLY this JSON object — no markdown fences, no explanation, nothing else:
{"seoTitle":"under 60 chars","metaDescription":"under 155 chars with call to action","article":"full markdown article","wordCount":0,"eeaScore":0,"readabilityScore":0,"keywordDensity":"1.2%","improvements":["specific improvement 1","specific improvement 2","specific improvement 3"]}`;

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
