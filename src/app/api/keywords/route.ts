import { NextRequest, NextResponse } from "next/server";
import { isMasterSession } from "@/lib/master-auth";
import type { KeywordResult, SearchIntent } from "@/types";

const BASE = "https://api.dataforseo.com/v3/dataforseo_labs/google";

function getAuth(): string {
  return Buffer.from(
    `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
  ).toString("base64");
}

function locationCode(country: string): number {
  return country === "US" ? 2840 : 2826;
}

function normaliseIntent(raw: string | null | undefined): SearchIntent {
  const v = (raw ?? "").toLowerCase();
  if (v === "commercial" || v === "transactional" || v === "navigational")
    return v as SearchIntent;
  return "informational";
}

// ── Suggestions item (seed call) ──────────────────────────────────────────────

interface SuggestionsItem {
  keyword: string;
  keyword_info?: {
    search_volume?: number | null;
    cpc?: number | null;
    monthly_searches?: { search_volume?: number | null }[];
  };
  keyword_properties?: { keyword_difficulty?: number | null };
  search_intent_info?: { main_intent?: string | null };
}

// ── Ideas item (related keywords call) ───────────────────────────────────────

interface IdeasItem {
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
}

function normIdea(item: IdeasItem): KeywordResult {
  const info = item.keyword_data?.keyword_info ?? {};
  return {
    keyword: item.keyword,
    volume: info.search_volume ?? 0,
    kd: Math.min(100, Math.max(0, Math.round(item.keyword_data?.keyword_difficulty ?? 0))),
    cpc: parseFloat(((info.cpc ?? 0) as number).toFixed(2)),
    intent: normaliseIntent(item.keyword_data?.search_intent?.main_intent),
    trend: (info.monthly_searches ?? [])
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
      .slice(-6)
      .map((m) => m.search_volume ?? 0),
  };
}

export async function POST(req: NextRequest) {
  try {
    const master = isMasterSession();
    const body = await req.json();
    const { keyword, country = "UK" } = body as { keyword: string; country?: string };

    if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    const auth = getAuth();
    const loc = locationCode(country);
    const seed = keyword.trim().toLowerCase();

    const headers = { Authorization: `Basic ${auth}`, "Content-Type": "application/json" };

    // Run seed lookup and ideas in parallel
    const [seedRes, ideasRes] = await Promise.all([
      fetch(`${BASE}/keyword_suggestions/live`, {
        method: "POST",
        headers,
        body: JSON.stringify([{
          keyword: seed,
          location_code: loc,
          language_code: "en",
          limit: 1,
          include_seed_keyword: true,
        }]),
      }),
      fetch(`${BASE}/keyword_ideas/live`, {
        method: "POST",
        headers,
        body: JSON.stringify([{
          keyword: seed,
          location_code: loc,
          language_code: "en",
          limit: 99,
        }]),
      }),
    ]);

    const [seedData, ideasData] = await Promise.all([seedRes.json(), ideasRes.json()]);

    console.log("[keywords] seed status:", seedData?.tasks?.[0]?.status_code);
    console.log("[keywords] ideas status:", ideasData?.tasks?.[0]?.status_code);

    // Build seed item from suggestions response
    const rawSeed: SuggestionsItem | undefined = seedData?.tasks?.[0]?.result?.[0]?.items?.[0];
    const seedItem: KeywordResult = {
      keyword: seed,
      volume: rawSeed?.keyword_info?.search_volume ?? 0,
      kd: Math.min(100, Math.max(0, Math.round(rawSeed?.keyword_properties?.keyword_difficulty ?? 0))),
      cpc: parseFloat(((rawSeed?.keyword_info?.cpc ?? 0) as number).toFixed(2)),
      intent: normaliseIntent(rawSeed?.search_intent_info?.main_intent),
      trend: rawSeed?.keyword_info?.monthly_searches?.map((m) => m.search_volume ?? 0) ?? [],
    };

    // Parse ideas and remove duplicates of seed
    const ideasItems: IdeasItem[] = ideasData?.tasks?.[0]?.result?.[0]?.items ?? [];
    const ideas = ideasItems
      .map(normIdea)
      .filter((item) => item.keyword.toLowerCase().trim() !== seed);

    // Sort ideas by volume desc, then prepend seed as row 0
    ideas.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    const keywords = [seedItem, ...ideas];

    console.log(`[keywords] returning ${keywords.length} keywords (1 seed + ${ideas.length} ideas)`);
    return NextResponse.json({ keywords, master });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
