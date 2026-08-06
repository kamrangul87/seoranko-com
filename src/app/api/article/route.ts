// DEPRECATED — superseded by /api/article-v2 (src/app/api/article-v2/route.ts).
// Confirmed unreachable from the live UI: ArticleWriter.tsx (the actual Write
// page component) calls /api/article-v2 exclusively; grepping the whole repo
// for fetch('/api/article' turns up nothing pointing at this route. This was
// the ONLY route that actually inserted generated articles into the `articles`
// table (see its "Save to Supabase" block below) — article-v2 never did,
// which is why `articles` had 0 rows in production despite Write working.
// article-v2 now has its own insert (as of the articles-persistence fix) and
// is the canonical save path going forward. Left in place rather than
// deleted — it's a real, working, more complete implementation (full
// startPage/stampStage/completePage/blockPage lifecycle, editorial-audit
// tie-in) that may be worth drawing from later, not just dead weight — but
// do not wire anything new to call this file; extend article-v2 instead.
import { NextRequest } from "next/server";
import { getAnthropicClient } from "@/lib/anthropic";
import { MODEL_FOR } from "@/lib/model-router";
import {
  classifyTopic,
  searchAndCollectFacts,
  extractAndVerifyFacts,
  editorialAudit,
} from "@/lib/fact-verifier";
import type { VerifiedFact } from "@/lib/fact-verifier";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { ArticleRequest, ArticleOutput, NlpBrief, PipelineData } from "@/types";
import { startPage, stampStage, completePage, blockPage, STAGE } from "@/lib/pages";

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
- NEVER include placeholder links like [see our guide to...] or [internal link: ...] or [keyword research strategies] — if you want to reference another topic just write it naturally in prose without any brackets

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

KEYWORD INTEGRATION RULES:
- You will be given a list of target keywords in the context below
- You MUST naturally include ALL provided keywords in the article at least once
- Never force keywords awkwardly — integrate them naturally into sentences
- Use exact match where it reads naturally; use variations where exact match sounds robotic
- Spread keywords throughout — do not cluster them in one section
- Primary keyword: appears in H1, first paragraph, at least one H2, and conclusion
- Secondary keywords: appear naturally in relevant body sections
- Long-tail keywords work best as questions in FAQ or as subheadings
- Never use any single keyword more than 3 times total
- Before finishing, mentally check: have I included every keyword from the list?

FORMATTING RULES:
- Use proper markdown heading syntax: # for H1, ## for H2, ### for H3
- H1 appears only once at the very top of the article
- Every major section must have an ## H2 heading
- Subsections use ### H3 headings
- Never use bold (**text**) as a substitute for headings
- Paragraph text should be plain prose — no unnecessary bold
- Add a blank line before and after every heading
- Add a blank line between paragraphs

HUMANISATION RULES:
- Write as if a real expert is speaking directly to the reader
- Use 'you' and 'your' frequently — make it personal
- Include specific numbers, prices, brand names, real examples
- Vary sentence length — mix short punchy sentences with longer detailed ones
- Use rhetorical questions occasionally to engage the reader
- Add personal insight phrases: 'In my experience...', 'What most guides miss...', 'The reality is...'
- Never start two consecutive paragraphs the same way
- Use British or American English based on target market

ADVANCED HUMANISATION RULES:
1. Vary sentence length dramatically — mix 5-word sentences with 25-word sentences
2. Start some paragraphs with 'But', 'And', 'So', 'Yet' — humans do this, AI avoids it
3. Include at least 3 rhetorical questions throughout
4. Add one genuine contrarian take — something that challenges common advice
5. Use British colloquialisms where appropriate: 'rather', 'whilst', 'quite', 'fairly'
6. Include one personal anecdote or observation per major section
7. Use em dashes — like this — for natural parenthetical thoughts
8. Occasionally use incomplete sentences for emphasis. Like this.
9. Reference current events or recent data from 2025-2026
10. Add transitional phrases humans use: 'Here's the thing', 'The reality is', 'What nobody tells you'
11. Never use these AI giveaway phrases: 'It is worth noting', 'In conclusion', 'Furthermore', 'Additionally', 'It is important to', 'Comprehensive', 'Multifaceted', 'Nuanced approach'
12. Write the conclusion before the introduction — then rewrite the intro to naturally lead into it
13. Read back each paragraph — if it could appear in a textbook it needs rewriting

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
      "KEYWORD DATA — YOU MUST INCLUDE ALL OF THESE IN THE ARTICLE:",
      `- Primary keyword (use in H1, first paragraph, one H2, conclusion): ${selectedKeywords[0]}`,
      `- ALL secondary keywords (each must appear at least once naturally): ${selectedKeywords.slice(1).join(", ")}`,
      "",
      `MANDATORY KEYWORD CHECKLIST — before finishing verify each is present: ${selectedKeywords.join(" | ")}`,
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
  const cookieStore = cookies();

  // Master cookie bypass
  let master = false;
  let userId: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any = null;

  if (!master) {
    supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    userId = user.id;
    master = user.email === process.env.MASTER_EMAIL;
  }

  // Fetch profile once — used for limit check and post-generation DB write
  let profile: {
    plan: string;
    articles_used_today: number;
    articles_used_month: number;
  } | null = null;

  if (!master && supabase && userId) {
    const { data } = await supabase
      .from("user_profiles")
      .select("plan, articles_used_today, articles_used_month")
      .eq("id", userId)
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

  let body: ArticleRequest & { nlpBrief?: NlpBrief; pipelineData?: PipelineData };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
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
    cluster?.keywords?.filter((k) => k !== keyword).join(", ") ?? "";

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

  const allKeywords = [keyword, ...secondaryKeywords.split(", ").filter(Boolean)];
  const keywordChecklist = allKeywords.length > 1
    ? `\nMANDATORY: Include ALL these keywords naturally — ${allKeywords.join(" | ")}`
    : "";

  const userMessage = `Write a ${wordCount} word article targeting: ${keyword}
Secondary keywords (ALL must appear at least once): ${secondaryKeywords || "none"}
Tone: ${tone}
Audience: ${audience}
Market: ${targetMarket}${contextBlock}${keywordChecklist}
Return only valid JSON.`;

  const research = {
    intent: cluster?.intent ?? "informational",
    questions: [],
    semanticKeywords: secondaryKeywords ? secondaryKeywords.split(", ") : [],
    contentGaps: [],
  };

  // §10 item 8 — stamp the pages shadow record as this (already-existing)
  // generation flow moves through stations. This route collapses Plan (2)
  // into whatever `cluster` the caller already computed client-side (nothing
  // persists a Plan stage today — Station 2 has no durable record to stamp
  // through yet), so it goes straight from Keywords (1) to Brief (3).
  const pageId = (!master && supabase && userId)
    ? await startPage(supabase, { userId, primaryKeyword: keyword, intent: research.intent })
    : null;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const pipelineLog: string[] = [];
        const log = (msg: string) => {
          pipelineLog.push(msg);
          controller.enqueue(sseEvent({ stage: msg }));
        };

        await stampStage(supabase, pageId, STAGE.BRIEF);

        // ── STEP 1: Classify topic risk ──────────────────────────
        log("Step 1/5: Classifying topic and risk level...");
        const classification = await classifyTopic(keyword);
        log(`Topic: ${classification.topic_category} | Risk: ${classification.risk_level} — ${classification.risk_reason}`);

        // ── STEPS 2 & 3: Web search + fact verification ──────────
        let verifiedFacts: VerifiedFact[] = [];
        let unverifiableClaims: string[] = [];

        if (classification.requires_live_verification || classification.risk_level !== "low") {
          log("Step 2/5: Searching for verified facts...");
          const rawFacts = await searchAndCollectFacts(
            keyword,
            classification.verification_queries,
            classification.risk_level,
          );
          log("Web search complete — facts collected");

          log("Step 3/5: Verifying facts...");
          const factResult = await extractAndVerifyFacts(keyword, rawFacts);
          verifiedFacts = factResult.verified_facts;
          unverifiableClaims = factResult.unverifiable_claims;

          if (!factResult.safe_to_proceed) {
            controller.enqueue(sseEvent({ error: factResult.blocker_reason ?? "Could not verify enough facts to write safely." }));
            return;
          }
          log(`${verifiedFacts.length} facts verified, ${unverifiableClaims.length} flagged`);
        } else {
          log("Steps 2–3/5: Skipped — low-risk evergreen topic");
        }

        // ── STEP 4: Write article ────────────────────────────────
        await stampStage(supabase, pageId, STAGE.WRITE);
        log("Step 4/5: Writing article with verified facts...");

        const factsInjection = verifiedFacts.length > 0
          ? `\n\nVERIFIED FACTS — You MUST only use facts from this list. Do not invent statistics, dates, prices, or rules:\n${JSON.stringify(verifiedFacts, null, 2)}\n\nCLAIMS TO NEVER INCLUDE — These could not be verified. Omit them entirely:\n${unverifiableClaims.join("\n")}`
          : "";

        const finalUserMessage = userMessage + factsInjection;

        const client = getAnthropicClient();
        const articleStream = client.messages.stream({
          model: MODEL_FOR.articleWriting,
          max_tokens: 8000,
          system: [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }],
          messages: [{ role: "user", content: finalUserMessage }],
        });

        let rawArticle = "";
        let lastMilestone = 0;
        for await (const event of articleStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            rawArticle += event.delta.text;
            const words = Math.round(rawArticle.length / 5);
            if (words - lastMilestone >= 100) {
              lastMilestone = words;
              controller.enqueue(sseEvent({ stage: `Writing… (${words} words)` }));
            }
          }
        }

        // Parse JSON article output
        const cleaned = rawArticle.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
        let articleOutput: ArticleOutput;
        try {
          articleOutput = JSON.parse(cleaned) as ArticleOutput;
        } catch {
          const obj = cleaned.match(/\{[\s\S]*\}/);
          if (!obj) throw new Error("Article JSON parse failed");
          articleOutput = JSON.parse(obj[0]) as ArticleOutput;
        }
        log(`Article written — ${articleOutput.wordCount ?? 0} words`);

        // ── STEP 5: Editorial audit ──────────────────────────────
        await stampStage(supabase, pageId, STAGE.QA);
        log("Step 5/5: Running editorial and fact audit...");

        let publishedPages: string[] = [];
        if (supabase) {
          try {
            const { data: pages } = await supabase
              .from("articles")
              .select("title")
              .eq("status", "published");
            publishedPages = (pages ?? []).map((p: { title: string }) => p.title).filter(Boolean);
          } catch { /* ignore — published pages are optional */ }
        }

        if (verifiedFacts.length > 0) {
          const audit = await editorialAudit(
            articleOutput.article,
            verifiedFacts,
            unverifiableClaims,
            publishedPages,
          );
          articleOutput = { ...articleOutput, article: audit.final_article || articleOutput.article };
          log(`Audit done. Broken links removed: ${audit.broken_links.length}. Article clean: ${audit.article_clean}`);
        } else {
          log("Editorial audit skipped — no facts to verify");
        }

        // ── Save to Supabase ─────────────────────────────────────
        if (!master && supabase && userId) {
          const [{ data: savedArticle }] = await Promise.all([
            supabase.from("articles").insert({
              user_id: userId,
              title: articleOutput.seoTitle,
              meta_description: articleOutput.metaDescription,
              content: articleOutput.article,
              keyword,
              word_count: articleOutput.wordCount,
              eeat_score: articleOutput.eeaScore,
              readability_score: articleOutput.readabilityScore,
              keyword_density: String(articleOutput.keywordDensity),
              status: "draft",
            }).select("id").single(),
            supabase.from("user_profiles").update({
              articles_used_today: (profile?.articles_used_today ?? 0) + 1,
              articles_used_month: (profile?.articles_used_month ?? 0) + 1,
            }).eq("id", userId),
          ]);

          // The flow stops here today — there is no Station 6 Publish step in
          // this route (nothing sets a live url/published_at). completePage()
          // marks the QA stage done rather than claiming Publish was reached.
          await completePage(supabase, pageId, {
            article_id: savedArticle?.id ?? null,
            content: articleOutput.article,
            eeat_score: articleOutput.eeaScore ?? null,
            last_action: "generated",
          });
        }

        controller.enqueue(
          sseEvent({ done: true, research, article: articleOutput, master, pipelineLog })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Generation failed";
        console.error("[article] error:", message);
        await blockPage(supabase, pageId, message);
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
