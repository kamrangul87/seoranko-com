import { KeywordResult, SearchIntent } from "@/types";
import { LOCATION_CODES } from "./rank-tracker";

const BASE_URL = "https://api.dataforseo.com/v3";

export function getAuthHeader(): string {
  const email = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!email || !password) throw new Error("DataForSEO credentials not configured");
  return "Basic " + Buffer.from(`${email}:${password}`).toString("base64");
}

// Previously only recognised "UK"/"US", silently returning US data (2840)
// for every other market — keyword research for Germany, Pakistan, UAE etc.
// was returning US search volumes with no indication anything was wrong.
// rank-tracker.ts's LOCATION_CODES is the canonical, complete map (14
// countries + global); this just looks up into it instead of duplicating
// a narrower one. Accepts either a 2-letter code ("DE") or a full market
// name ("Germany") since callers use both.
export function getLocationCode(country: string): number {
  const key = country.trim().toLowerCase();
  const byCode = LOCATION_CODES[key];
  if (byCode) return byCode.code;

  const byName = Object.values(LOCATION_CODES).find(v => v.name.toLowerCase() === key);
  if (byName) return byName.code;

  console.warn(`[dataforseo] Unrecognised market "${country}" — defaulting to Global (2840). Add it to LOCATION_CODES in rank-tracker.ts if this market should be supported.`);
  return LOCATION_CODES.global.code;
}

// keyword_ideas returns intent strings like "informational", "commercial", etc.
// Fall back to text-based inference if the field is absent.
function inferIntent(keyword: string): SearchIntent {
  const kw = keyword.toLowerCase();
  if (/^(how|what|why|when|who|where|is|are|does|do|can|should)\b/.test(kw)) return "informational";
  if (/\b(buy|purchase|order|shop|deal|discount|price|cheap|best|top|review|vs|compare|versus)\b/.test(kw)) return "commercial";
  if (/\b(near me|for sale|download|sign up|register|login|get|hire|service)\b/.test(kw)) return "transactional";
  return "informational";
}

function normaliseIntent(raw: string | null | undefined): SearchIntent {
  const v = (raw ?? "").toLowerCase();
  if (v === "commercial" || v === "transactional" || v === "navigational") return v as SearchIntent;
  return "informational";
}

// ── Response shape for keyword_ideas/live ────────────────────────────────────

interface KeywordIdeaItem {
  keyword: string;
  keyword_data: {
    keyword_info: {
      search_volume: number | null;
      cpc: number | null;
      monthly_searches?: { search_volume: number | null; year: number; month: number }[];
    };
    keyword_difficulty: number | null;
    search_intent?: {
      main_intent: string | null;
    };
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function fetchKeywords(keyword: string, country: string): Promise<KeywordResult[]> {
  const locationCode = getLocationCode(country);

  const res = await fetch(`${BASE_URL}/dataforseo_labs/google/keyword_ideas/live`, {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([{
      keyword: keyword.trim().toLowerCase(),
      location_code: locationCode,
      language_code: "en",
      limit: 20,
      include_seed_keyword: true,
    }]),
  });

  if (!res.ok) throw new Error(`DataForSEO API error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const task = data?.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(task?.status_message || "DataForSEO returned no data");
  }

  const items: KeywordIdeaItem[] = task.result?.[0]?.items ?? [];

  const results: KeywordResult[] = items.map((item) => {
    const info = item.keyword_data?.keyword_info ?? {};
    const rawKd = item.keyword_data?.keyword_difficulty;
    const rawIntent = item.keyword_data?.search_intent?.main_intent;

    return {
      keyword: item.keyword,
      volume: info.search_volume ?? 0,
      kd: rawKd != null ? Math.min(100, Math.max(0, Math.round(rawKd))) : 0,
      cpc: parseFloat(((info.cpc ?? 0) as number).toFixed(2)),
      intent: rawIntent ? normaliseIntent(rawIntent) : inferIntent(item.keyword),
      trend: (info.monthly_searches ?? [])
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
        .slice(-6)
        .map((m) => m.search_volume ?? 0),
    };
  });

  return results.sort((a, b) => b.volume - a.volume);
}
