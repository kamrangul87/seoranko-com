import { NextRequest, NextResponse } from "next/server";
import { extractAndVerifyFacts } from "@/lib/fact-verifier";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { keyword, raw_facts } = await req.json();
    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }
    const result = await extractAndVerifyFacts(keyword, raw_facts ?? "");
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    console.error("[pipeline/verify]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
