import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";
import { getCachedEntityPresence } from "@/lib/entity-checker";

const anthropic = new Anthropic();

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

type SourceStatus = "loading" | "done" | "error" | "skipped";

// Map region code to YouTube regionCode param
const REGION_TO_YT: Record<string, string> = {
  UK: "GB", US: "US", AU: "AU", CA: "CA", DE: "DE",
  FR: "FR", IN: "IN", AE: "AE", SA: "SA", SG: "SG",
  ZA: "ZA", PK: "PK",
};

// ─── Source fetchers ──────────────────────────────────────────────────────────

async function fetchYouTube(niche: string, region: string): Promise<string[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];

  const regionParam = region && REGION_TO_YT[region]
    ? `&regionCode=${REGION_TO_YT[region]}`
    : "";

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?q=${encodeURIComponent(niche)}&part=snippet&type=video${regionParam}&maxResults=20&key=${key}`;
  const res = await fetch(searchUrl);
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videos: { id: string; title: string; desc: string }[] = (data.items ?? []).map((v: any) => ({
    id: v.id?.videoId ?? "",
    title: v.snippet?.title ?? "",
    desc: v.snippet?.description ?? "",
  }));

  const signals: string[] = videos.map(v => `VIDEO: ${v.title} — ${v.desc}`);

  const top3 = videos.slice(0, 3).filter(v => v.id);
  for (const vid of top3) {
    try {
      const commUrl = `https://www.googleapis.com/youtube/v3/commentThreads?videoId=${vid.id}&part=snippet&maxResults=20&key=${key}`;
      const commRes = await fetch(commUrl);
      const commData = await commRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const comments = (commData.items ?? []).map((c: any) =>
        c.snippet?.topLevelComment?.snippet?.textDisplay ?? ""
      ).filter(Boolean).slice(0, 10);
      signals.push(...comments.map((c: string) => `COMMENT (${vid.title}): ${c}`));
    } catch { /* skip */ }
  }

  return signals;
}

async function fetchTrends(niche: string): Promise<{ term: string; value: number }[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(niche)}&date=today+3-m&api_key=${key}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.text();
      console.error('[fetchTrends] failed:', res.status, body);
      return [];
    }

    const data = await res.json();

    // SerpApi returns an error field when credits are exhausted or key is invalid
    if (data.error) {
      console.error('[fetchTrends] SerpApi error:', data.error);
      return [];
    }

    const results: { term: string; value: number }[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeline: any[] = data?.interest_over_time?.timeline_data ?? [];
    for (const point of timeline.slice(-4)) {
      const val = point.values?.[0]?.extracted_value ?? 0;
      if (point.date) results.push({ term: `Trend: ${point.date}`, value: val });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rising: any[] = data?.related_queries?.rising ?? [];
    for (const item of rising.slice(0, 20)) {
      results.push({ term: item.query ?? "", value: parseInt(item.value ?? "0") || 0 });
    }

    if (results.length <= 4) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const top: any[] = data?.related_queries?.top ?? [];
      for (const item of top.slice(0, 10)) {
        results.push({ term: item.query ?? "", value: parseInt(item.value ?? "0") || 0 });
      }
    }

    return results;
  } catch (err) {
    console.error('[fetchTrends] exception:', err);
    return [];
  }
}

async function fetchNews(niche: string): Promise<string[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(niche)}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.articles ?? [] as any[]).map((a: any) =>
      `NEWS: ${a.title ?? ""} — ${a.description ?? ""}`
    ).filter((s: string) => s.length > 10);
  } catch {
    return [];
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function checkAuth(): Promise<boolean> {
  const cookieStore = await cookies();

  const masterToken = cookieStore.get("seoranko_master")?.value;
  if (masterToken) {
    const masterEmail = process.env.MASTER_EMAIL;
    const masterPassword = process.env.MASTER_PASSWORD;
    if (masterEmail && masterPassword) {
      const expected = createHash("sha256")
        .update(`${masterEmail}:${masterPassword}:master`)
        .digest("hex");
      if (masterToken === expected) return true;
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

// Satisfy unused import (callClaude used by other routes in this file tree)
void callClaude;

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const { niche, depth = "quick", region = "Global" } = await req.json() as {
    niche: string;
    depth?: "quick" | "deep";
    region?: string;
  };

  if (!niche?.trim()) {
    return new Response(JSON.stringify({ error: "niche is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const status: Record<string, SourceStatus> = {
          youtube: process.env.YOUTUBE_API_KEY ? "loading" : "skipped",
          trends:  process.env.SERPAPI_KEY      ? "loading" : "skipped",
          news:    process.env.NEWS_API_KEY     ? "loading" : "skipped",
        };

        controller.enqueue(sse({ stage: "fetching", status }));

        // Fetch all sources in parallel
        const [ytResult, trResult, nwResult] = await Promise.allSettled([
          process.env.YOUTUBE_API_KEY ? fetchYouTube(niche, region) : Promise.resolve([]),
          process.env.SERPAPI_KEY     ? fetchTrends(niche)          : Promise.resolve([]),
          process.env.NEWS_API_KEY    ? fetchNews(niche)            : Promise.resolve([]),
        ]);

        const limit = depth === "deep" ? 30 : 20;
        const youtube = ytResult.status === "fulfilled" ? ytResult.value : [];
        const trends  = trResult.status === "fulfilled" ? trResult.value as { term: string; value: number }[] : [];
        const news    = nwResult.status === "fulfilled" ? nwResult.value : [];

        status.youtube = process.env.YOUTUBE_API_KEY
          ? (youtube.length > 0 ? "done" : "error") : "skipped";
        status.trends  = process.env.SERPAPI_KEY
          ? (trends.length > 0  ? "done" : "error") : "skipped";
        status.news    = process.env.NEWS_API_KEY
          ? (news.length > 0    ? "done" : "error") : "skipped";

        if (trends.length === 0 && process.env.SERPAPI_KEY) {
          console.error('[discovery] Trends returned 0 results despite SERPAPI_KEY being set — credits may be exhausted or key invalid');
        }

        const counts = {
          youtube: youtube.length,
          trends:  trends.length,
          news:    news.length,
        };

        controller.enqueue(sse({ stage: "analysing", status, counts }));

        const allSignals = [
          ...youtube.slice(0, limit),
          ...trends.slice(0, 20).map(t => `TREND: ${t.term} (${t.value})`),
          ...news.slice(0, limit),
        ].join("\n");

        const totalSignals = counts.youtube + counts.trends + counts.news;
        const marketLabel = region && region !== "Global" ? region : "global";

        const analysisRaw = await (async () => {
          const msg = await anthropic.messages.create({
            model: "claude-sonnet-4-5",
            max_tokens: 4000,
            messages: [{
              role: "user",
              content: `You are a content opportunity analyser for the ${marketLabel} market. Here are raw signals from YouTube, Google Trends, and News about '${niche}'.
Signal counts: YouTube ${counts.youtube}, Trends ${counts.trends}, News ${counts.news}.
Identify the top 10 content opportunities where real people are expressing problems or asking questions that have poor or no existing content answers.
Return ONLY a JSON array of 10 objects, each with:
- rank: number
- problem: string (the core question/problem people are expressing)
- gapScore: number 0-100 (100 = nobody has answered this well)
- volume: number (estimated monthly searches in the ${marketLabel} market)
- competition: 'Low' | 'Medium' | 'High'
- intent: 'Informational' | 'Commercial' | 'Transactional'
- entities: string[]
- whyGapExists: string (1 sentence)
Return only valid JSON array, no markdown.

Niche: "${niche}"
Market: ${marketLabel}

Signals:
${allSignals.slice(0, 8000)}`,
            }],
          });
          return msg.content[0].type === "text" ? msg.content[0].text : "[]";
        })();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let opportunities: any[] = [];
        try {
          opportunities = parseJsonResponse<object[]>(analysisRaw);
        } catch {
          opportunities = [];
        }

        // Distribute signal counts proportionally across opportunities
        if (opportunities.length > 0 && totalSignals > 0) {
          const n = opportunities.length;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          opportunities = opportunities.map((opp: any) => ({
            ...opp,
            sources: {
              youtube: Math.round(counts.youtube / n),
              trends:  Math.round(counts.trends  / n),
              news:    Math.round(counts.news    / n),
            },
          }));
        }

        const avgGap = opportunities.length
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? Math.round(opportunities.reduce((s, o: any) => s + (o.gapScore ?? 0), 0) / opportunities.length)
          : 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const zeroContentCount = opportunities.filter((o: any) => (o.gapScore ?? 0) >= 80).length;

        // Cache-only entity lookup — no API call, just shows if we already know
        const entityPresence = await getCachedEntityPresence(niche).catch(() => null);

        controller.enqueue(sse({
          done: true,
          opportunities,
          entityPresence,
          summary: {
            total: opportunities.length,
            avgGapScore: avgGap,
            zeroContentGaps: zeroContentCount,
            sourcesActive: Object.values(status).filter(s => s === "done").length,
            entityScore: entityPresence?.score ?? null,
          },
          status,
          counts,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Discovery failed";
        console.error("[discovery/find] error:", message);
        controller.enqueue(sse({ error: message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
