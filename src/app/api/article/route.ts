import { NextRequest } from "next/server";
import { streamClaude, parseJsonResponse } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import type { ArticleRequest, ArticleOutput } from "@/types";

// Free plan: 1 article LIFETIME (checked via articles_used_month, never reset)
// Paid plans: monthly quota
const ARTICLE_LIMITS = {
  free:    { articles: 1,        period: "lifetime" as const },
  starter: { articles: 30,       period: "month"    as const },
  pro:     { articles: 100,      period: "month"    as const },
  agency:  { articles: Infinity, period: "unlimited" as const },
};

// Word count cap per plan
const WORD_CAPS: Record<string, number> = {
  free:    500,
  starter: 5000,
  pro:     5000,
  agency:  5000,
};

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const master = user.email === process.env.MASTER_EMAIL;

  // Fetch profile once — used for limit check and post-generation DB write
  let profile: {
    plan: string;
    articles_used_today: number;
    articles_used_month: number;
  } | null = null;

  if (!master) {
    const { data } = await supabase
      .from("user_profiles")
      .select("plan, articles_used_today, articles_used_month")
      .eq("id", user.id)
      .single();
    profile = data;

    const plan = (profile?.plan ?? "free") as keyof typeof ARTICLE_LIMITS;
    const limit = ARTICLE_LIMITS[plan] ?? ARTICLE_LIMITS.free;

    if (limit.period !== "unlimited") {
      const used = profile?.articles_used_month ?? 0;
      if (used >= limit.articles) {
        const msg = plan === "free"
          ? "You've used your free article. Upgrade to Starter for 30 articles/month."
          : "Monthly limit reached. Upgrade your plan.";
        return new Response(
          JSON.stringify({ error: msg }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  }

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
    const plan = profile?.plan ?? "free";
    const cap = WORD_CAPS[plan] ?? WORD_CAPS.free;
    wordCount = Math.min(wordCount, cap);
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

        // Save article and increment usage AFTER successful generation
        if (!master && user) {
          await Promise.all([
            supabase.from("articles").insert({
              user_id: user.id,
              title: articleOutput.seoTitle,
              meta_description: articleOutput.metaDescription,
              content: articleOutput.article,
              keyword,
              word_count: articleOutput.wordCount,
              eeat_score: articleOutput.eeaScore,
              readability_score: articleOutput.readabilityScore,
              keyword_density: String(articleOutput.keywordDensity),
              status: "draft",
            }),
            supabase.from("user_profiles").update({
              articles_used_today: (profile?.articles_used_today ?? 0) + 1,
              articles_used_month: (profile?.articles_used_month ?? 0) + 1,
            }).eq("id", user.id),
          ]);
        }

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
