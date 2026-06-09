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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("[pipeline/verify] unhandled error:", error);
    return NextResponse.json(
      { error: error?.message || "Unknown error in verify step" },
      { status: 500 }
    );
  }
}
