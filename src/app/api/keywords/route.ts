import { NextRequest, NextResponse } from "next/server";
import { isMasterSession } from "@/lib/master-auth";
import type { KeywordResult, SearchIntent } from "@/types";

const BASE = "https://api.dataforseo.com/v3/dataforseo_labs/google";

function normaliseIntent(raw: string | null | undefined): SearchIntent {
  const v = (raw ?? "").toLowerCase();
  if (v === "commercial" || v === "transactional" || v === "navigational")
    return v as SearchIntent;
  return "informational";
}

function getAuth(): string {
  return Buffer.from(
    `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
  ).toString("base64");
}

// ── Normalise keyword_suggestions item ───────────────────────────────────────

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

function normSuggestion(item: SuggestionsItem): KeywordResult {
  return {
    keyword: item.keyword,
    volume: item.keyword_info?.search_volume || 0,
    kd: Math.min(100, Math.max(0, Math.round(item.keyword_properties?.keyword_difficulty || 0))),
    cpc: parseFloat(((item.keyword_info?.cpc ?? 0) as number).toFixed(2)),
    intent: normaliseIntent(item.search_intent_info?.main_intent),
    trend: item.keyword_info?.monthly_searches?.map((m) => m.search_volume ?? 0) || [],
  };
}

// ── Normalise keyword_ideas item ─────────────────────────────────────────────

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
    volume: info.search_volume || 0,
    kd: Math.min(100, Math.max(0, Math.round(item.keyword_data?.keyword_difficulty || 0))),
    cpc: parseFloat(((info.cpc ?? 0) as number).toFixed(2)),
    intent: normaliseIntent(item.keyword_data?.search_intent?.main_intent),
    trend: (info.monthly_searches ?? [])
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
      .slice(-6)
      .map((m) => m.search_volume ?? 0),
  };
}

// ── API calls (run in parallel) ───────────────────────────────────────────────

async function fetchSuggestions(
  keyword: string,
  locationCode: number,
  auth: string
): Promise<KeywordResult[]> {
  const res = await fetch(`${BASE}/keyword_suggestions/live`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([{
      keyword,
      location_code: locationCode,
      language_code: "en",
      limit: 50,
      include_seed_keyword: true,
      order_by: ["keyword_info.search_volume,desc"],
    }]),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const task = data?.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    console.warn("[keywords] suggestions:", task?.status_message);
    return [];
  }
  return ((task.result?.[0]?.items ?? []) as SuggestionsItem[]).map(normSuggestion);
}

async function fetchIdeas(
  keyword: string,
  locationCode: number,
  auth: string
): Promise<KeywordResult[]> {
  const res = await fetch(`${BASE}/keyword_ideas/live`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([{
      keyword,
      location_code: locationCode,
      language_code: "en",
      limit: 50,
      include_seed_keyword: true,
    }]),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const task = data?.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    console.warn("[keywords] ideas:", task?.status_message);
    return [];
  }
  return ((task.result?.[0]?.items ?? []) as IdeasItem[]).map(normIdea);
}

// ── Route ─────────────────────────────────────────────────────────────────────

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

    const auth = getAuth();
    const locationCode = country === "US" ? 2840 : 2826;
    const seed = keyword.trim().toLowerCase();

    console.log("[keywords] fetching suggestions + ideas for:", seed);

    // Run both API calls in parallel
    const [suggestions, ideas] = await Promise.all([
      fetchSuggestions(seed, locationCode, auth),
      fetchIdeas(seed, locationCode, auth),
    ]);

    console.log(`[keywords] suggestions: ${suggestions.length}, ideas: ${ideas.length}`);

    // Merge, deduplicate, sort seed first then by volume
    const allItems = [...suggestions, ...ideas];
    const unique = allItems.filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.keyword === item.keyword)
    );
    const final = unique.sort((a, b) => {
      const aMatch = a.keyword.toLowerCase().trim() === keyword.toLowerCase().trim();
      const bMatch = b.keyword.toLowerCase().trim() === keyword.toLowerCase().trim();
      if (aMatch) return -1;
      if (bMatch) return 1;
      return (b.volume || 0) - (a.volume || 0);
    });

    console.log(`[keywords] returning ${final.length} unique keywords`);
    return NextResponse.json({ keywords: final, master });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords] caught error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
