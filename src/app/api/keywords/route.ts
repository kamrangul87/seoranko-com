import { NextRequest, NextResponse } from "next/server";
import { isMasterSession } from "@/lib/master-auth";
import type { KeywordResult, SearchIntent } from "@/types";

const DFS_URL = "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live";

function getAuth(): string {
  const email = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!email || !password) throw new Error("DATAFORSEO_EMAIL or DATAFORSEO_PASSWORD not set");
  return Buffer.from(`${email}:${password}`).toString("base64");
}

function locationCode(country: string): number {
  return country === "US" ? 2840 : 2826;
}

function normaliseIntent(raw: string | null | undefined): SearchIntent {
  const v = (raw ?? "").toLowerCase();
  if (v === "commercial" || v === "transactional" || v === "navigational") return v as SearchIntent;
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

    const requestBody = [
      {
        keyword: keyword.trim().toLowerCase(),
        location_code: locationCode(country),
        language_code: "en",
        limit: 20,
        include_seed_keyword: true,
      },
    ];

    console.log("[keywords] request →", JSON.stringify(requestBody));

    const res = await fetch(DFS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${getAuth()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const raw = await res.json();
    console.log("[keywords] raw response →", JSON.stringify(raw).slice(0, 1000));

    if (!res.ok) {
      const msg = raw?.tasks?.[0]?.status_message ?? `HTTP ${res.status}`;
      console.error("[keywords] API HTTP error:", msg);
      return NextResponse.json({ error: `DataForSEO error: ${msg}` }, { status: 502 });
    }

    const task = raw?.tasks?.[0];
    if (!task || task.status_code !== 20000) {
      const msg = task?.status_message ?? "DataForSEO returned no data";
      console.error("[keywords] task error:", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const items: Array<{
      keyword: string;
      keyword_data?: {
        keyword_info?: {
          search_volume?: number | null;
          cpc?: number | null;
          monthly_searches?: { search_volume?: number | null; year: number; month: number }[];
        };
        keyword_difficulty?: number | null;
        search_intent?: { main_intent?: string | null };
      };
    }> = task.result?.[0]?.items ?? [];

    const keywords: KeywordResult[] = items.map((item) => {
      const info = item.keyword_data?.keyword_info ?? {};
      const rawKd = item.keyword_data?.keyword_difficulty;
      const rawIntent = item.keyword_data?.search_intent?.main_intent;

      return {
        keyword: item.keyword,
        volume: info.search_volume ?? 0,
        kd: rawKd != null ? Math.min(100, Math.max(0, Math.round(rawKd))) : 0,
        cpc: parseFloat(((info.cpc ?? 0) as number).toFixed(2)),
        intent: normaliseIntent(rawIntent),
        trend: (info.monthly_searches ?? [])
          .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
          .slice(-6)
          .map((m) => m.search_volume ?? 0),
      };
    });

    keywords.sort((a, b) => b.volume - a.volume);

    console.log(`[keywords] returning ${keywords.length} results`);
    return NextResponse.json({ keywords, master });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords] caught error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
