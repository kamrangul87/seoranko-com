import { NextRequest, NextResponse } from "next/server";
import { callClaude } from "@/lib/anthropic";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import type { Cluster, KeywordResult } from "@/types";

const SYSTEM_PROMPT = `You are an SEO strategist. Group these keywords by search intent into exactly 3 clusters: informational, commercial, transactional. Score each cluster opportunity 0-100.

CRITICAL: Return ONLY a valid JSON array. No markdown. No code blocks. No explanation before or after. No trailing commas. No comments inside JSON. Ensure all strings are properly escaped. Maximum 3 clusters.

Format: [{"name":"...","intent":"informational","keywords":["keyword1","keyword2"],"opportunity":75,"color":"blue"},{"name":"...","intent":"commercial","keywords":["..."],"opportunity":80,"color":"purple"},{"name":"...","intent":"transactional","keywords":["..."],"opportunity":85,"color":"green"}]`;

function extractClusters(raw: string): Cluster[] {
  // Strip markdown code fences
  const cleaned = raw
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/gi, '')
    .trim();

  // Direct parse
  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  // Extract JSON array from anywhere in the text
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]);
    } catch { /* continue */ }

    // Remove trailing commas before ] or } and retry
    try {
      const fixed = arrMatch[0].replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(fixed);
    } catch { /* continue */ }
  }

  // Extract JSON object wrapped in array
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const val = JSON.parse(objMatch[0]);
      return Array.isArray(val) ? val : [val];
    } catch { /* continue */ }
  }

  throw new Error(`Failed to parse cluster JSON. Raw (first 200 chars): ${raw.slice(0, 200)}`);
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();

    // Master cookie bypass
    let master = false;
    const masterToken = cookieStore.get("seoranko_master")?.value;
    if (masterToken) {
      const masterEmail = process.env.MASTER_EMAIL;
      const masterPassword = process.env.MASTER_PASSWORD;
      if (masterEmail && masterPassword) {
        const expected = createHash("sha256")
          .update(`${masterEmail}:${masterPassword}:master`)
          .digest("hex");
        if (masterToken === expected) master = true;
      }
    }

    if (!master) {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      master = user.email === process.env.MASTER_EMAIL;
    }

    const body = await req.json();
    const { keywords }: { keywords: KeywordResult[] } = body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: "keywords array is required" }, { status: 400 });
    }

    // Cap at top 50 by volume to prevent token limit truncation
    const topKeywords = [...keywords]
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 50);

    const keywordList = topKeywords
      .map((k) => `${k.keyword} (vol: ${k.volume}, kd: ${k.kd}, intent: ${k.intent})`)
      .join("\n");

    const raw = await callClaude(
      SYSTEM_PROMPT,
      `Cluster these ${topKeywords.length} keywords:\n${keywordList}`,
      2048
    );

    console.log("[cluster] raw response (first 300):", raw.slice(0, 300));
    const clusters = extractClusters(raw);
    return NextResponse.json({ clusters, master });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[cluster] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
