import { KeywordResult, SearchIntent } from "@/types";

const BASE_URL = "https://api.dataforseo.com/v3";

export function getAuthHeader(): string {
  const email = process.env.DATAFORSEO_EMAIL;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!email || !password) throw new Error("DataForSEO credentials not configured");
  return "Basic " + Buffer.from(`${email}:${password}`).toString("base64");
}

export function getLocationCode(country: string): number {
  switch (country) {
    case "UK":  return 2826;
    case "US":  return 2840;
    default:    return 2840;
  }
}

function inferIntent(keyword: string): SearchIntent {
  const kw = keyword.toLowerCase();
  if (/^(how|what|why|when|who|where|is|are|does|do|can|should)\b/.test(kw)) return "informational";
  if (/\b(buy|purchase|order|shop|deal|discount|price|cheap|best|top|review|vs|compare|versus)\b/.test(kw)) return "commercial";
  if (/\b(near me|for sale|download|sign up|register|login|get|hire|service)\b/.test(kw)) return "transactional";
  return "informational";
}

function generateKeywordVariations(seed: string): string[] {
  const base = seed.trim().toLowerCase();
  return [
    base,
    `best ${base}`,
    `how to ${base}`,
    `${base} guide`,
    `${base} tips`,
    `${base} for beginners`,
    `${base} examples`,
    `${base} tools`,
    `${base} strategy`,
    `${base} 2025`,
    `what is ${base}`,
    `${base} vs`,
    `${base} tutorial`,
    `${base} checklist`,
    `${base} mistakes`,
    `${base} benefits`,
    `${base} cost`,
    `${base} review`,
    `${base} software`,
    `${base} services`,
  ];
}

// ── Response shapes ───────────────────────────────────────────────────────────

interface VolumeItem {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  monthly_searches?: { search_volume: number | null; year: number; month: number }[];
}

interface DifficultyItem {
  keyword: string;
  keyword_difficulty: number | null;
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchSearchVolume(
  keywords: string[],
  locationCode: number
): Promise<VolumeItem[]> {
  const res = await fetch(`${BASE_URL}/keywords_data/google_ads/search_volume/live`, {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([{ keywords, location_code: locationCode, language_code: "en" }]),
  });

  if (!res.ok) throw new Error(`Volume API error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const task = data?.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(task?.status_message || "DataForSEO volume: no data");
  }
  return (task.result ?? []) as VolumeItem[];
}

async function fetchKeywordDifficulty(
  keywords: string[],
  locationCode: number
): Promise<Map<string, number>> {
  const res = await fetch(`${BASE_URL}/dataforseo_labs/google/bulk_keyword_difficulty/live`, {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([{ keywords, location_code: locationCode, language_code: "en" }]),
  });

  if (!res.ok) throw new Error(`KD API error: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const task = data?.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    // KD endpoint may not be available on all plans — return empty map gracefully
    console.warn("[dataforseo] KD endpoint:", task?.status_message ?? "no data");
    return new Map();
  }

  const map = new Map<string, number>();
  for (const item of (task.result ?? []) as DifficultyItem[]) {
    if (item.keyword && item.keyword_difficulty != null) {
      map.set(item.keyword, Math.min(100, Math.max(0, Math.round(item.keyword_difficulty))));
    }
  }
  return map;
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function fetchKeywords(keyword: string, country: string): Promise<KeywordResult[]> {
  const keywords = generateKeywordVariations(keyword);
  const locationCode = getLocationCode(country);
  const auth = getAuthHeader(); // validate credentials once before parallel calls
  void auth;

  // Run both API calls in parallel
  const [volumeItems, kdMap] = await Promise.all([
    fetchSearchVolume(keywords, locationCode),
    fetchKeywordDifficulty(keywords, locationCode),
  ]);

  const results: KeywordResult[] = volumeItems.map((item) => ({
    keyword: item.keyword,
    volume: item.search_volume ?? 0,
    kd: kdMap.get(item.keyword) ?? 0,
    cpc: parseFloat((item.cpc ?? 0).toFixed(2)),
    intent: inferIntent(item.keyword),
    trend: (item.monthly_searches ?? [])
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
      .slice(-6)
      .map((m) => m.search_volume ?? 0),
  }));

  return results.sort((a, b) => b.volume - a.volume);
}
