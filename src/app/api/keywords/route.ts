import { NextRequest, NextResponse } from "next/server";
import { fetchKeywords } from "@/lib/dataforseo";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, country } = body;

    if (!keyword || typeof keyword !== "string") {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    const keywords = await fetchKeywords(keyword, country ?? "UK");
    return NextResponse.json({ keywords });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
