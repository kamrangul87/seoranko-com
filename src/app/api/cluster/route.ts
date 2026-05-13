import { NextRequest, NextResponse } from "next/server";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import type { Cluster, KeywordResult } from "@/types";

const SYSTEM_PROMPT = `You are an SEO strategist. Group these keywords by search intent into 3 clusters: informational, commercial, transactional. Score each cluster opportunity 0-100. Return ONLY a valid JSON array with no markdown, no explanation, no code block: [{"name":"...","intent":"...","keywords":["..."],"opportunity":0,"color":"..."}]`;

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

    // Rate-limit enforcement goes here — master session bypasses all limits.
    // if (!master && dailyClusterUsageExceeded()) {
    //   return NextResponse.json({ error: "Daily limit reached" }, { status: 429 });
    // }

    const keywordList = keywords.map((k) => `${k.keyword} (vol: ${k.volume}, kd: ${k.kd}, intent: ${k.intent})`).join("\n");

    const raw = await callClaude(
      SYSTEM_PROMPT,
      `Cluster these ${keywords.length} keywords:\n${keywordList}`,
      1024
    );

    const clusters = parseJsonResponse<Cluster[]>(raw);
    return NextResponse.json({ clusters, master });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[cluster] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
