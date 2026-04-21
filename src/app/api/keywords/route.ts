import { NextRequest, NextResponse } from "next/server";
import { fetchKeywords } from "@/lib/dataforseo";
import { isMasterSession } from "@/lib/master-auth";

export async function POST(req: NextRequest) {
  try {
    const master = isMasterSession();
    const body = await req.json();
    const { keyword, country } = body;

    if (!keyword || typeof keyword !== "string") {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    // Rate-limit enforcement goes here — master session bypasses all limits.
    // if (!master && dailyUsageExceeded()) {
    //   return NextResponse.json({ error: "Daily limit reached" }, { status: 429 });
    // }

    const keywords = await fetchKeywords(keyword, country ?? "UK");
    return NextResponse.json({ keywords, master });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
