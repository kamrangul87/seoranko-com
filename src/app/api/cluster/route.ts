import { NextRequest, NextResponse } from "next/server";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";
import type { Cluster, KeywordResult } from "@/types";

const SYSTEM_PROMPT = `You are an SEO strategist. Group these keywords by search intent into 3 clusters: informational, commercial, transactional. Score each cluster opportunity 0-100. Return ONLY a valid JSON array with no markdown, no explanation, no code block: [{"name":"...","intent":"...","keywords":["..."],"opportunity":0,"color":"..."}]`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keywords }: { keywords: KeywordResult[] } = body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: "keywords array is required" }, { status: 400 });
    }

    const keywordList = keywords.map((k) => `${k.keyword} (vol: ${k.volume}, kd: ${k.kd}, intent: ${k.intent})`).join("\n");

    const raw = await callClaude(
      SYSTEM_PROMPT,
      `Cluster these ${keywords.length} keywords:\n${keywordList}`,
      1024
    );

    const clusters = parseJsonResponse<Cluster[]>(raw);
    return NextResponse.json({ clusters });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[cluster] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
