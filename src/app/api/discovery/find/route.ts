import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

type SourceStatus = "loading" | "done" | "error" | "skipped";

interface Signal {
  youtube: string[];
  reddit: string[];
  trends: { term: string; value: number }[];
  news: string[];
}

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

async function fetchReddit(niche: string): Promise<string[]> {
  const signals: string[] = [];

  try {
    const searchRes = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(niche)}&sort=top&t=month&limit=25`,
      { headers: { "User-Agent": "Seoranko/1.0" } }
    );
    const searchData = await searchRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posts = searchData?.data?.children ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const post of posts.slice(0, 25) as any[]) {
      const p = post.data;
      if (p.title) signals.push(`POST: ${p.title}`);
      if (p.selftext && p.selftext.length > 20) signals.push(`BODY: ${p.selftext.slice(0, 200)}`);
      if (p.subreddit) {
        // Extract pain-signal posts
        const title: string = p.title ?? "";
        if (/^(why|how|anyone else|is it worth|what|does|can|should)/i.test(title)) {
          signals.push(`PAIN: ${title}`);
        }
      }
    }
  } catch { /* graceful fallback */ }

  // Fetch from a relevant subreddit if identifiable
  try {
    const subRes = await fetch(
      `https://www.reddit.com/r/${niche.replace(/\s+/g, "")}/top.json?t=month&limit=25`,
      { headers: { "User-Agent": "Seoranko/1.0" } }
    );
    if (subRes.ok) {
      const subData = await subRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subPosts = subData?.data?.children ?? [] as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const post of subPosts.slice(0, 15) as any[]) {
        const p = post.data;
        if (p.title) signals.push(`SUBREDDIT: ${p.title}`);
      }
    }
  } catch { /* skip */ }

  return signals;
}

async function fetchTrends(niche: string): Promise<{ term: string; value: number }[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(niche)}&data_type=RELATED_QUERIES&api_key=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rising = data?.related_queries?.rising ?? [] as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rising.slice(0, 20).map((item: any) => ({
      term: item.query ?? "",
      value: parseInt(item.value ?? "0") || 0,
    }));
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

async function checkAuth(): Promise<boolean> {
  const cookieStore = await cookies();

  // Master bypass
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

  // Supabase session check
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

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

        const limit = depth === "deep" ? 30 : 20;
        const [ytResult, rdResult, trResult, nwResult] = await Promise.allSettled([
          process.env.YOUTUBE_API_KEY ? fetchYouTube(niche) : Promise.resolve([]),
          fetchReddit(niche),
          process.env.SERPAPI_KEY ? fetchTrends(niche) : Promise.resolve([]),
          process.env.NEWS_API_KEY ? fetchNews(niche) : Promise.resolve([]),
        ]);

        const signals: Signal = {
          youtube: ytResult.status === "fulfilled" ? ytResult.value : [],
          reddit:  rdResult.status === "fulfilled" ? rdResult.value : [],
          trends:  trResult.status === "fulfilled" ? trResult.value as { term: string; value: number }[] : [],
          news:    nwResult.status === "fulfilled" ? nwResult.value : [],
        };

        status.youtube = process.env.YOUTUBE_API_KEY ? (ytResult.status === "fulfilled" ? "done" : "error") : "skipped";
        status.reddit  = rdResult.status === "fulfilled" ? "done" : "error";
        status.trends  = process.env.SERPAPI_KEY ? (trResult.status === "fulfilled" ? "done" : "error") : "skipped";
        status.news    = process.env.NEWS_API_KEY ? (nwResult.status === "fulfilled" ? "done" : "error") : "skipped";

        controller.enqueue(sse({ stage: "analysing", status }));

        const allSignals = [
          ...signals.youtube.slice(0, limit),
          ...signals.reddit.slice(0, limit),
          ...signals.trends.slice(0, 20).map(t => `TREND: ${t.term} (${t.value})`),
          ...signals.news.slice(0, limit),
        ].join("\n");

        const analysisRaw = await callClaude(
          `You are a content opportunity analyser. Here are raw signals from YouTube, Reddit, Google Trends, and News about '${niche}'.
Identify the top 10 content opportunities where real people are expressing problems or asking questions that have poor or no existing content answers.
Return ONLY a JSON array of 10 objects, each with:
- rank: number
- problem: string (the core question/problem people are expressing)
- gapScore: number 0-100 (100 = nobody has answered this well)
- volume: number (estimated monthly searches)
- competition: 'Low' | 'Medium' | 'High'
- intent: 'Informational' | 'Commercial' | 'Transactional'
- sources: { youtube: number, reddit: number, trends: number, news: number }
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
