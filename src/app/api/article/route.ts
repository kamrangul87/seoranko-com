import { NextRequest, NextResponse } from "next/server";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";
import { isMasterSession } from "@/lib/master-auth";
import type { ArticleRequest, ArticleOutput } from "@/types";

const SYSTEM_PROMPT = `You are a senior SEO content writer and editor with 12 years experience. You do three things in one response:
1. Research the keyword intent and semantic coverage
2. Write a complete humanised EEAT-compliant article
3. Self-review and score your own article

NLP RULES: Vary sentence length. Use contractions. First-person signals. One contrarian point. Specific examples only.
NEVER USE: In conclusion, Delve into, Furthermore, Moreover, Game-changer, Revolutionize, It is worth noting.
EEAT: Specific data points, real brand references, acknowledge limitations, confident expertise.
HELPFUL CONTENT: Fully answer the question, practical advice, natural FAQ at end with 5 questions.
SEO: Primary keyword in H1 and first paragraph naturally, 1-1.5% keyword density maximum.

Return ONLY this JSON (no markdown fences, no explanation):
{
  "seoTitle": "string under 60 chars",
  "metaDescription": "string under 155 chars",
  "article": "full markdown article",
  "wordCount": 0,
  "eeaScore": 0,
  "readabilityScore": 0,
  "keywordDensity": "1.2%",
  "improvements": ["string"]
}`;

export async function POST(req: NextRequest) {
  try {
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
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    // Rate-limit enforcement goes here — master session bypasses all limits.
    // if (!master && monthlyArticleUsageExceeded()) {
    //   return NextResponse.json({ error: "Monthly article limit reached" }, { status: 429 });
    // }

    // Free plan caps word count at 200 — master account has no cap.
    if (!master) {
      wordCount = Math.min(wordCount, 200);
    }

    const secondaryKeywords = cluster?.keywords?.filter((k) => k !== keyword).slice(0, 6).join(", ") ?? "";

    const userMessage = `Write a ${wordCount} word article targeting: ${keyword}
Secondary keywords: ${secondaryKeywords || "none"}
Tone: ${tone}
Audience: ${audience}
Market: ${country}
Return only valid JSON.`;

    const raw = await callClaude(SYSTEM_PROMPT, userMessage, 8000);
    const articleOutput = parseJsonResponse<ArticleOutput>(raw);

    // Stub research so existing dashboard types stay compatible
    const research = {
      intent: cluster?.intent ?? "informational",
      questions: [],
      semanticKeywords: secondaryKeywords ? secondaryKeywords.split(", ") : [],
      contentGaps: [],
    };

    return NextResponse.json({ research, article: articleOutput, master });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[article] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
