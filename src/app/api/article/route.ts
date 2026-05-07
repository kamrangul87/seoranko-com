import { NextRequest } from "next/server";
import { streamClaude, parseJsonResponse } from "@/lib/anthropic";
import { createClient } from "@/lib/supabase/server";
import type { ArticleRequest, ArticleOutput, NlpBrief, PipelineData } from "@/types";

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

// Market-specific authoritative sources
const MARKET_SOURCES: Record<string, string> = {
  UK:     "NHS, GOV.UK, Which?, The Guardian, BBC, ONS",
  US:     "CDC, FDA, Harvard Health, Forbes, Wall Street Journal, Mayo Clinic",
  AU:     "ABC Australia, health.gov.au, ACCC, Australian Bureau of Statistics",
  CA:     "Health Canada, CBC, Statistics Canada, Globe and Mail",
  DE:     "Robert Koch Institut, Statista, Der Spiegel, Bundesministerium für Gesundheit",
  FR:     "INSEE, Le Monde, Santé publique France, service-public.fr",
  IN:     "ICMR, Times of India, Economic Times, Ministry of Health India",
  AE:     "Dubai Health Authority, Gulf News, Khaleej Times, UAE Government portal",
  SA:     "Saudi Health Ministry, Arab News, Saudi Gazette",
  SG:     "MOH Singapore, The Straits Times, Enterprise Singapore",
  ZA:     "StatsSA, Daily Maverick, South African Government, IOL",
  PK:     "Dawn, The News International, Pakistan Medical Association",
  Global: "WHO, World Bank, academic journals, Wikipedia, industry-leading publications",
};

function getMarketSources(country: string): string {
  return MARKET_SOURCES[country] ?? MARKET_SOURCES.Global;
}

function buildSystemPrompt(country: string): string {
  const sources = getMarketSources(country);
  return `You are a senior SEO editor at a leading digital publication with 15 years experience. You produce expert, authoritative articles that rank on Google and build genuine reader trust across any market.

ARTICLE STRUCTURE RULES:
Every article must follow this exact structure:

1. SEO TITLE - Under 60 characters, primary keyword near start
2. META DESCRIPTION - Under 155 characters, includes primary keyword, compelling
3. TABLE OF CONTENTS - After intro paragraph, list all H2 headings as anchor links
   Format: ## Table of Contents\\n- [Section Name](#section-name)\\n- [Section Name](#section-name)
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
- Never use: "In conclusion", "It is worth noting", "Delve into", "Furthermore", "Moreover", "Game-changer", "Revolutionize", "In today's world", "Needless to say", "Leverage", "Robust", "Comprehensive"
- Bold text ONLY for genuinely critical terms or data points - maximum 3 per article
- Never bold entire sentences or phrases for emphasis

CITATION RULES:
- Include 3-5 external citations to authoritative sources
- Preferred sources for this market: ${sources}
- Format as inline links: [Source Name](https://real-known-url.com)
- Never fabricate URLs - if unsure of exact URL write: [Source: Organisation Name] without hyperlink
- Include 2-3 internal link suggestions in brackets: "see our guide to [keyword research strategies]"

E-E-A-T SIGNALS:
- Include specific verifiable statistics with real source organisations
- Reference recognisable brands and institutions relevant to the target market
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
}

function buildPipelineContext(pipelineData: PipelineData, targetMarket: string): string {
  const { discoveryData, nlpData, selectedKeywords } = pipelineData;
  const sources = getMarketSources(targetMarket);
  const lines: string[] = [
    "",
    "═══════════════════════════════════════════════════════════",
    "FULL PIPELINE DATA — USE EVERY PIECE OF THIS INFORMATION",
    "═══════════════════════════════════════════════════════════",
  ];

  if (discoveryData) {
    lines.push(
      "",
      "SEARCH OPPORTUNITY (from Discovery Engine):",
      `- Problem users are searching for: ${discoveryData.problem}`,
      `- Why content gap exists: ${discoveryData.whyGapExists}`,
      `- Estimated search volume: ${discoveryData.volume}/month`,
      `- Competition level: ${discoveryData.competition}`,
      `- Search intent: ${discoveryData.intent}`,
      `- Gap score: ${discoveryData.gapScore}/100 (higher = less competition)`,
    );
  }

  if (nlpData) {
    lines.push(
      "",
      "NLP ANALYSIS FROM TOP 10 SERP RESULTS:",
      `- Recommended H1: ${nlpData.recommendedH1}`,
      `- Search intent: ${nlpData.intent?.type ?? "informational"} (${nlpData.intent?.confidence ?? 50}% confidence)`,
      `- Required entities to include naturally: ${nlpData.entities?.slice(0, 20).join(", ")}`,
      `- Topical gaps to cover (each becomes an H2/H3): ${nlpData.topicalGaps?.slice(0, 15).join(", ")}`,
      `- LSI terms to use naturally throughout: ${nlpData.lsiTerms?.slice(0, 20).map(t => t.term).join(", ")}`,
      `- Article structure to follow: ${JSON.stringify(nlpData.brief?.structure ?? [])}`,
      `- Target word count: ${nlpData.brief?.wordCount ?? 1500}`,
    );
  }

  if (selectedKeywords && selectedKeywords.length > 0) {
    lines.push(
      "",
      "KEYWORD DATA:",
      `- Primary keyword: ${selectedKeywords[0]}`,
      `- Related keywords to mention naturally: ${selectedKeywords.slice(1).join(", ")}`,
    );
  }

  lines.push(
    "",
    `TARGET MARKET: ${targetMarket}`,
    `AUTHORITATIVE SOURCES TO CITE: ${sources}`,
    "",
    "MANDATORY WRITING RULES FOR THIS ARTICLE:",
    "1. Write in a natural human voice — vary sentence length, use contractions, avoid robotic phrasing",
    "2. Include ALL required entities naturally — never force them awkwardly",
    "3. Cover EVERY topical gap listed — each gap must become an H2 or H3 section",
    "4. Use LSI terms naturally throughout — never stuff or force them",
    "5. E-E-A-T: include first-person experience signals, expert quotes, statistics with sources",
    "6. Cite 3-5 authoritative sources for the target market with real working anchor text links",
    "7. FAQ section must answer real questions people ask — minimum 5 questions",
    "8. NEVER use: 'In conclusion', 'Delve into', 'Furthermore', 'Leverage', 'Robust', 'Comprehensive', 'Game changer'",
    "9. Keyword density: primary keyword 0.8-1.2% only",
    "10. Every paragraph must add genuine value — no filler sentences",
    "11. Target readability: Flesch-Kincaid grade 10-12",
    "12. Use active voice throughout",
    "13. Include real data, statistics, specific examples — never vague generalities",
    "14. Write for humans first, search engines second",
    "═══════════════════════════════════════════════════════════",
  );

  return lines.join("\n");
}

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

  const body: ArticleRequest & { nlpBrief?: NlpBrief; pipelineData?: PipelineData } = await req.json();
  const {
    keyword,
    cluster,
    tone = "professional",
    audience = "general readers",
    country = "Global",
    nlpBrief,
    pipelineData,
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

  const targetMarket = pipelineData?.targetMarket ?? country ?? "Global";
  const systemPrompt = buildSystemPrompt(targetMarket);

  // Build user message — inject full pipeline context or NLP brief
  let contextBlock = "";

  if (pipelineData && (pipelineData.discoveryData || pipelineData.nlpData)) {
    contextBlock = buildPipelineContext(pipelineData, targetMarket);
  } else if (nlpBrief) {
    contextBlock = `

You have been given a pre-analysed NLP brief. Use this data to write the article:
- H1: ${nlpBrief.recommendedH1}
- Required H2/H3 structure: ${JSON.stringify(nlpBrief.structure)}
- Must include these entities: ${nlpBrief.entities.slice(0, 20).join(", ")}
- Must cover these subtopics: ${nlpBrief.topicalGaps.slice(0, 15).join(", ")}
- LSI terms to include naturally: ${nlpBrief.lsiTerms.slice(0, 20).map(t => t.term).join(", ")}
- Target word count: ${nlpBrief.wordCount}
- Search intent: ${nlpBrief.intent}
Follow this structure exactly. Include all required entities and cover all topical gaps.`;
  }

  const userMessage = `Write a ${wordCount} word article targeting: ${keyword}
Secondary keywords: ${secondaryKeywords || "none"}
Tone: ${tone}
Audience: ${audience}
Market: ${targetMarket}${contextBlock}
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
          systemPrompt,
          userMessage,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (_delta: any, accumulated: any) => {
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
