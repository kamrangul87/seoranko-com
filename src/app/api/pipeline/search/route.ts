import { NextRequest, NextResponse } from "next/server";
import { searchAndCollectFacts } from "@/lib/fact-verifier";
import type { RiskLevel } from "@/lib/fact-verifier";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { keyword, queries, risk_level } = await req.json();
    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }
    const rawFacts = await searchAndCollectFacts(
      keyword,
      Array.isArray(queries) ? queries : [],
      (risk_level as RiskLevel) ?? "medium",
    );
    return NextResponse.json({ raw_facts: rawFacts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    console.error("[pipeline/search]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
