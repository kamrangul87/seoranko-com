import { NextRequest, NextResponse } from "next/server";
import { isMasterSession } from "@/lib/master-auth";
import type { SearchIntent } from "@/types";

const DFS_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live";

function normaliseIntent(raw: string | null | undefined): SearchIntent {
  const v = (raw ?? "").toLowerCase();
  if (v === "commercial" || v === "transactional" || v === "navigational")
    return v as SearchIntent;
  return "informational";
}

export async function POST(req: NextRequest) {
  try {
    const master = isMasterSession();
    const body = await req.json();
    const { keyword, country = "UK" } = body as { keyword: string; country?: string };

    if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    // Rate-limit enforcement goes here — master session bypasses all limits.
    // if (!master && dailyUsageExceeded()) {
    //   return NextResponse.json({ error: "Daily limit reached" }, { status: 429 });
    // }

    const auth = Buffer.from(
      `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
    ).toString("base64");

    const requestBody = [
      {
        keyword: keyword.trim().toLowerCase(),
        location_code: country === "US" ? 2840 : 2826,
        language_code: "en",
        limit: 20,
        include_seed_keyword: true,
        order_by: ["keyword_info.search_volume,desc"],
      },
    ];

    console.log("[keywords] request →", JSON.stringify(requestBody));

    const res = await fetch(DFS_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await res.json();
    console.log("DataForSEO response:", JSON.stringify(data, null, 2));

    if (!res.ok) {
      const msg = data?.tasks?.[0]?.status_message ?? `HTTP ${res.status}`;
      return NextResponse.json({ error: `DataForSEO error: ${msg}` }, { status: 502 });
    }

    const task = data?.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      const msg = task?.status_message ?? "DataForSEO returned no data";
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const items: Array<{
      keyword: string;
      keyword_info?: { search_volume?: number | null; cpc?: number | null; monthly_searches?: { search_volume?: number | null }[] };
      keyword_properties?: { keyword_difficulty?: number | null };
      search_intent_info?: { main_intent?: string | null };
    }> = data.tasks[0].result[0].items;

    const keywords = items.map((item) => ({
      keyword: item.keyword,
      volume: item.keyword_info?.search_volume || 0,
      kd: item.keyword_properties?.keyword_difficulty || 0,
      cpc: item.keyword_info?.cpc || 0,
      intent: normaliseIntent(item.search_intent_info?.main_intent),
      trend: item.keyword_info?.monthly_searches?.map((m) => m.search_volume ?? 0) || [],
    }));

    return NextResponse.json({ keywords, master });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords] caught error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
