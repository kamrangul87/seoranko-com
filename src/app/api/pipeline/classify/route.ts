import { NextRequest, NextResponse } from "next/server";
import { classifyTopic } from "@/lib/fact-verifier";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { keyword } = await req.json();
    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }
    const classification = await classifyTopic(keyword);
    return NextResponse.json(classification);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("[pipeline/classify] unhandled error:", error);
    return NextResponse.json(
      { error: error?.message || "Unknown error in classify step" },
      { status: 500 }
    );
  }
}
