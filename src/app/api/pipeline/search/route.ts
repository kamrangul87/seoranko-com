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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("[pipeline/search] unhandled error:", error);
    return NextResponse.json(
      { error: error?.message || "Unknown error in search step" },
      { status: 500 }
    );
  }
}
