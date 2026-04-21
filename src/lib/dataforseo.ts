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
    case "UK": return 2826;
    case "US": return 2840;
    default:   return 2840; // Global defaults to US for volume data
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
  ];
}

export async function fetchKeywords(keyword: string, country: string): Promise<KeywordResult[]> {
  const keywords = generateKeywordVariations(keyword);
  const locationCode = getLocationCode(country);

  const response = await fetch(
    `${BASE_URL}/keywords_data/google_ads/search_volume/live`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keywords,
          location_code: locationCode,
          language_code: "en",
        },
      ]),
    }
  );

  if (!response.ok) {
    throw new Error(`DataForSEO API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const tasks = data?.tasks?.[0];
  if (!tasks || tasks.status_code !== 20000) {
    throw new Error(tasks?.status_message || "DataForSEO returned no data");
  }

  const items: KeywordResult[] = (tasks.result || []).map(
    (item: {
      keyword: string;
      search_volume: number;
      competition_index: number;
      cpc: number;
      monthly_searches?: { search_volume: number }[];
    }) => ({
      keyword: item.keyword,
      volume: item.search_volume ?? 0,
      kd: Math.round((item.competition_index ?? 0) * 100),
      cpc: parseFloat((item.cpc ?? 0).toFixed(2)),
      intent: inferIntent(item.keyword),
      trend: (item.monthly_searches ?? []).slice(-6).map(
        (m: { search_volume: number }) => m.search_volume ?? 0
      ),
    })
  );

  return items.sort((a, b) => b.volume - a.volume);
}
