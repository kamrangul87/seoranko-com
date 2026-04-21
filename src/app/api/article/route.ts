import { NextRequest, NextResponse } from "next/server";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";
import type { ArticleRequest, ResearchBrief, ArticleOutput } from "@/types";

// ── Call 1: Research brief ────────────────────────────────────────────────────

async function generateResearch(keyword: string, intent: string): Promise<ResearchBrief> {
  const system = `You are an SEO research analyst. Respond ONLY with valid JSON, no markdown, no explanation.`;
  const user = `For the keyword "${keyword}" with intent "${intent}", identify:
- exact search intent
- top 5 questions this searcher has
- 8 semantic keywords to include
- what competing articles miss

Return ONLY this JSON: {"intent":"...","questions":["..."],"semanticKeywords":["..."],"contentGaps":["..."]}`;

  const raw = await callClaude(system, user, 1024);
  return parseJsonResponse<ResearchBrief>(raw);
}

// ── Call 2: Article writing ───────────────────────────────────────────────────

async function writeArticle(
  keyword: string,
  research: ResearchBrief,
  wordCount: number,
  tone: string,
  audience: string,
  country: string
): Promise<string> {
  const system = `You are a senior SEO content writer with 12 years experience. Write for humans first.

NLP RULES: Vary sentence length dramatically. Use contractions naturally. Include first-person signals where appropriate. Include one contrarian point addressed head-on. Use specific real examples only — no hypotheticals.

NEVER USE THESE PHRASES: "In conclusion", "It is worth noting", "Delve into", "Furthermore", "Moreover", "Game-changer", "Revolutionize", "In today's world", "It's important to note", "Leverage".

EEAT SIGNALS: Include specific data points with named sources. Reference recognisable brands when relevant. Acknowledge limitations honestly. Write with confident expertise — not hedged waffle.

GOOGLE HELPFUL CONTENT: Fully answer the question. Every paragraph must earn its place. Practical advice throughout. Natural FAQ section at the end.

SEO: Primary keyword in H1 and first paragraph. Secondary keywords in H2s naturally. Target 1–1.5% keyword density max.

Format with markdown headings (##, ###), bullet lists where helpful, bold for key terms.`;

  const user = `Write a ${wordCount}-word ${tone} SEO article for ${audience} in the ${country} market.

Primary keyword: "${keyword}"
Search intent: ${research.intent}
Questions to answer: ${research.questions.join("; ")}
Semantic keywords to weave in naturally: ${research.semanticKeywords.join(", ")}
Content gaps to fill: ${research.contentGaps.join("; ")}

Write the complete article now. Start directly with the H1.`;

  return callClaude(system, user, 4096);
}

// ── Call 3: Editorial review ──────────────────────────────────────────────────

async function reviewArticle(article: string, keyword: string): Promise<ArticleOutput> {
  const system = `You are a senior SEO editor. Review the provided article and return ONLY valid JSON, no markdown, no explanation.`;
  const user = `Review this article for the keyword "${keyword}" and return ONLY this JSON:
{"seoTitle":"...","metaDescription":"...","article":"...","wordCount":0,"eeaScore":0,"readabilityScore":0,"keywordDensity":0.0,"improvements":["..."]}

Rules:
- seoTitle: compelling, includes keyword, 50-60 chars
- metaDescription: includes keyword, 150-160 chars, has a call to action
- article: the full article with any copy improvements applied (keep markdown)
- wordCount: actual word count integer
- eeaScore: 0-100 EEAT quality score
- readabilityScore: 0-100 Flesch-Kincaid style score
- keywordDensity: keyword density as decimal e.g. 1.2
- improvements: array of 3-5 short, specific improvement suggestions

Article to review:
${article}`;

  const raw = await callClaude(system, user, 4096);
  return parseJsonResponse<ArticleOutput>(raw);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: ArticleRequest = await req.json();
    const { keyword, cluster, wordCount = 1500, tone = "professional", audience = "general readers", country = "UK" } = body;

    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    const intent = cluster?.intent ?? "informational";

    // Three sequential Claude calls
    const research = await generateResearch(keyword, intent);
    const articleText = await writeArticle(keyword, research, wordCount, tone, audience, country);
    const articleOutput = await reviewArticle(articleText, keyword);

    return NextResponse.json({ research, article: articleOutput });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[article] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
