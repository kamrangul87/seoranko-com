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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Classification failed";
    console.error("[pipeline/classify]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
