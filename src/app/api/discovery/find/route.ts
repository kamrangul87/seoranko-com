import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

type SourceStatus = "loading" | "done" | "error" | "skipped";

const REDDIT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; SEORANKO/1.0; +https://seoranko.com)",
  "Accept": "application/json",
};

// ─── Source fetchers ──────────────────────────────────────────────────────────

async function fetchYouTube(niche: string): Promise<string[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?q=${encodeURIComponent(niche)}&part=snippet&type=video&regionCode=GB&maxResults=20&key=${key}`;
  const res = await fetch(searchUrl);
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videos: { id: string; title: string; desc: string }[] = (data.items ?? []).map((v: any) => ({
    id: v.id?.videoId ?? "",
    title: v.snippet?.title ?? "",
    desc: v.snippet?.description ?? "",
  }));

  const signals: string[] = videos.map(v => `VIDEO: ${v.title} — ${v.desc}`);

  // Fetch comments for top 3 videos
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
    } catch { /* skip failed comment fetch */ }
  }

  return signals;
}

// Ask Claude for the 3 most relevant subreddits for the niche
async function getSubreddits(niche: string): Promise<string[]> {
  try {
    const raw = await callClaude(
      `Return ONLY a valid JSON array of exactly 3 subreddit names (no r/ prefix) most relevant for researching content gaps about this niche. Return only the JSON array, no markdown, no explanation.`,
      `Niche: "${niche}"`,
      150
    );
    const subs = parseJsonResponse<string[]>(raw);
    return Array.isArray(subs) ? subs.slice(0, 3).map(s => String(s).replace(/^r\//, "").trim()) : [];
  } catch {
    return [];
  }
}

// Fetch posts from a subreddit or search endpoint and extract signal strings
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPosts(data: any, label: string): string[] {
  const signals: string[] = [];
  const posts = data?.data?.children ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const post of posts.slice(0, 20) as any[]) {
    const p = post.data;
    if (!p?.title) continue;
    signals.push(`${label}: ${p.title}`);
    if (p.selftext && p.selftext.length > 20) signals.push(`BODY: ${p.selftext.slice(0, 200)}`);
    if (/^(why|how|anyone else|is it worth|what|does|can|should)/i.test(p.title)) {
      signals.push(`PAIN: ${p.title}`);
    }
  }
  return signals;
}

async function fetchTrends(niche: string): Promise<{ term: string; value: number }[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(niche)}&date=today+3-m&api_key=${key}`;
    const res = await fetch(url);
    const data = await res.json();

    const results: { term: string; value: number }[] = [];

    // Timeline data: last 4 data points show recent trend direction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeline: any[] = data?.interest_over_time?.timeline_data ?? [];
    for (const point of timeline.slice(-4)) {
      const val = point.values?.[0]?.extracted_value ?? 0;
      if (point.date) results.push({ term: `Trend: ${point.date}`, value: val });
    }

    // Rising related queries give the strongest content gap signals
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rising: any[] = data?.related_queries?.rising ?? [];
    for (const item of rising.slice(0, 20)) {
      results.push({ term: item.query ?? "", value: parseInt(item.value ?? "0") || 0 });
    }

    // Fall back to top queries if no rising
    if (results.length <= 4) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const top: any[] = data?.related_queries?.top ?? [];
      for (const item of top.slice(0, 10)) {
        results.push({ term: item.query ?? "", value: parseInt(item.value ?? "0") || 0 });
      }
    }

    return results;
  } catch {
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

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const { niche, depth = "quick" } = await req.json() as { niche: string; depth?: "quick" | "deep" };
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
          reddit: "loading",
          trends: process.env.SERPAPI_KEY ? "loading" : "skipped",
          news: process.env.NEWS_API_KEY ? "loading" : "skipped",
        };

        controller.enqueue(sse({ stage: "fetching", status }));

        // Phase 1: Claude subreddit lookup runs in parallel with non-Reddit sources
        const [subResult, ytResult, trResult, nwResult] = await Promise.allSettled([
          getSubreddits(niche),
          process.env.YOUTUBE_API_KEY ? fetchYouTube(niche) : Promise.resolve([]),
          process.env.SERPAPI_KEY ? fetchTrends(niche) : Promise.resolve([]),
          process.env.NEWS_API_KEY ? fetchNews(niche) : Promise.resolve([]),
        ]);

        const subs = subResult.status === "fulfilled" ? subResult.value : [];

        // Phase 2: 3 Reddit fetches in parallel — 2 targeted subreddits + 1 general search
        const redditFetches = await Promise.allSettled([
          subs[0]
            ? fetch(`https://www.reddit.com/r/${subs[0]}/top.json?t=month&limit=20`, { headers: REDDIT_HEADERS }).then(r => r.json())
            : Promise.resolve(null),
          subs[1]
            ? fetch(`https://www.reddit.com/r/${subs[1]}/top.json?t=month&limit=20`, { headers: REDDIT_HEADERS }).then(r => r.json())
            : Promise.resolve(null),
          fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(niche)}&sort=top&t=month&limit=25`, { headers: REDDIT_HEADERS }).then(r => r.json()),
        ]);

        const redditSignals: string[] = [];
        const labels = [
          subs[0] ? `r/${subs[0]}` : null,
          subs[1] ? `r/${subs[1]}` : null,
          "POST",
        ];
        for (let i = 0; i < redditFetches.length; i++) {
          const result = redditFetches[i];
          const label = labels[i];
          if (result.status !== "fulfilled" || !result.value || !label) continue;
          redditSignals.push(...extractPosts(result.value, label));
        }

        const limit = depth === "deep" ? 30 : 20;
        const youtube = ytResult.status === "fulfilled" ? ytResult.value : [];
        const trends  = trResult.status === "fulfilled" ? trResult.value as { term: string; value: number }[] : [];
        const news    = nwResult.status === "fulfilled" ? nwResult.value : [];

        status.youtube = process.env.YOUTUBE_API_KEY
          ? (youtube.length > 0 ? "done" : "error") : "skipped";
        status.reddit  = redditSignals.length > 0 ? "done" : "error";
        status.trends  = process.env.SERPAPI_KEY
          ? (trends.length > 0 ? "done" : "error") : "skipped";
        status.news    = process.env.NEWS_API_KEY
          ? (news.length > 0 ? "done" : "error") : "skipped";

        const counts = {
          youtube: youtube.length,
          reddit:  redditSignals.length,
          trends:  trends.length,
          news:    news.length,
        };

        controller.enqueue(sse({ stage: "analysing", status, counts }));

        const allSignals = [
          ...youtube.slice(0, limit),
          ...redditSignals.slice(0, limit),
          ...trends.slice(0, 20).map(t => `TREND: ${t.term} (${t.value})`),
          ...news.slice(0, limit),
        ].join("\n");

        const totalSignals = counts.youtube + counts.reddit + counts.trends + counts.news;

        const analysisRaw = await callClaude(
          `You are a content opportunity analyser. Here are raw signals from YouTube, Reddit, Google Trends, and News about '${niche}'.
Signal counts available: YouTube ${counts.youtube}, Reddit ${counts.reddit}, Trends ${counts.trends}, News ${counts.news}.
Identify the top 10 content opportunities where real people are expressing problems or asking questions that have poor or no existing content answers.
Return ONLY a JSON array of 10 objects, each with:
- rank: number
- problem: string (the core question/problem people are expressing)
- gapScore: number 0-100 (100 = nobody has answered this well)
- volume: number (estimated monthly searches)
- competition: 'Low' | 'Medium' | 'High'
- intent: 'Informational' | 'Commercial' | 'Transactional'
- entities: string[]
- whyGapExists: string (1 sentence)
Return only valid JSON array, no markdown.`,
          `Niche: "${niche}"\n\nSignals:\n${allSignals.slice(0, 8000)}`,
          4000
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let opportunities: any[] = [];
        try {
          opportunities = parseJsonResponse<object[]>(analysisRaw);
        } catch {
          opportunities = [];
        }

        // Distribute signal counts proportionally across opportunities (Claude can't attribute per-opportunity)
        if (opportunities.length > 0 && totalSignals > 0) {
          const n = opportunities.length;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          opportunities = opportunities.map((opp: any) => ({
            ...opp,
            sources: {
              youtube: Math.round(counts.youtube / n),
              reddit:  Math.round(counts.reddit  / n),
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

        controller.enqueue(sse({
          done: true,
          opportunities,
          summary: {
            total: opportunities.length,
            avgGapScore: avgGap,
            zeroContentGaps: zeroContentCount,
            sourcesActive: Object.values(status).filter(s => s === "done").length,
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
