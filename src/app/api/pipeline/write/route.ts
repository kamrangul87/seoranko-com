import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildPipelineContext } from "@/lib/article-system-prompt";
import type { ArticleOutput, NlpBrief, PipelineData } from "@/types";
import type { VerifiedFact } from "@/lib/fact-verifier";

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      keyword,
      cluster,
      verified_facts = [],
      unverifiable_claims = [],
      word_count = 1500,
      tone = "professional",
      audience = "general readers",
      market = "Global",
      pipeline_data,
      nlp_brief,
    }: {
      keyword: string;
      cluster?: { keywords: string[]; intent?: string } | null;
      verified_facts?: VerifiedFact[];
      unverifiable_claims?: string[];
      word_count?: number;
      tone?: string;
      audience?: string;
      market?: string;
      pipeline_data?: PipelineData | null;
      nlp_brief?: NlpBrief | null;
    } = body;

    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    const targetMarket = (pipeline_data?.targetMarket ?? market) || "Global";
    const systemPrompt = buildSystemPrompt(targetMarket);

    const secondaryKeywords =
      cluster?.keywords?.filter((k) => k !== keyword).join(", ") ?? "";

    // Build pipeline or NLP context block
    let contextBlock = "";
    if (pipeline_data && (pipeline_data.discoveryData || pipeline_data.nlpData)) {
      contextBlock = buildPipelineContext(pipeline_data, targetMarket);
    } else if (nlp_brief) {
      contextBlock = `

You have been given a pre-analysed NLP brief. Use this data to write the article:
- H1: ${nlp_brief.recommendedH1}
- Required H2/H3 structure: ${JSON.stringify(nlp_brief.structure)}
- Must include these entities: ${nlp_brief.entities.slice(0, 20).join(", ")}
- Must cover these subtopics: ${nlp_brief.topicalGaps.slice(0, 15).join(", ")}
- LSI terms to include naturally: ${nlp_brief.lsiTerms.slice(0, 20).map((t: { term: string }) => t.term).join(", ")}
- Target word count: ${nlp_brief.wordCount}
- Search intent: ${nlp_brief.intent}
Follow this structure exactly. Include all required entities and cover all topical gaps.`;
    }

    // Verified facts injection
    const factsInjection = verified_facts.length > 0
      ? `\n\nVERIFIED FACTS — You MUST only use facts from this list. Do not invent statistics, dates, prices, or rules:\n${JSON.stringify(verified_facts, null, 2)}\n\nCLAIMS TO NEVER INCLUDE — These could not be verified. Omit them entirely:\n${unverifiable_claims.join("\n")}`
      : "";

    const allKeywords = [keyword, ...secondaryKeywords.split(", ").filter(Boolean)];
    const keywordChecklist = allKeywords.length > 1
      ? `\nMANDATORY: Include ALL these keywords naturally — ${allKeywords.join(" | ")}`
      : "";

    const userMessage = `Write a ${word_count} word article targeting: ${keyword}
Secondary keywords (ALL must appear at least once): ${secondaryKeywords || "none"}
Tone: ${tone}
Audience: ${audience}
Market: ${targetMarket}${contextBlock}${keywordChecklist}${factsInjection}
Return only valid JSON.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const rawText = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = rawText.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();

    let articleOutput: ArticleOutput;
    try {
      articleOutput = JSON.parse(cleaned) as ArticleOutput;
    } catch {
      const obj = cleaned.match(/\{[\s\S]*\}/);
      if (!obj) {
        console.error("[pipeline/write] JSON parse failed. Raw:", cleaned.slice(0, 300));
        return NextResponse.json({ error: "Article generation produced invalid JSON — please retry" }, { status: 500 });
      }
      articleOutput = JSON.parse(obj[0]) as ArticleOutput;
    }

    return NextResponse.json(articleOutput);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("[pipeline/write] unhandled error:", error);
    return NextResponse.json(
      { error: error?.message || "Unknown error in write step" },
      { status: 500 }
    );
  }
}
