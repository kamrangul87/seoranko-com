import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";

const DFS_BASE = "https://api.dataforseo.com/v3";

function getAuth(): string {
  return Buffer.from(
    `${process.env.DATAFORSEO_EMAIL}:${process.env.DATAFORSEO_PASSWORD}`
  ).toString("base64");
}

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return parseJsonResponse<T>(raw);
  } catch {
    return fallback;
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

  const body = await req.json() as {
    keyword: string;
    draft?: string;
    location_code?: number;
    language_code?: string;
  };
  const { keyword, draft, location_code, language_code } = body;

  if (!keyword?.trim()) {
    return new Response(JSON.stringify({ error: "keyword is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── STAGE 1: SERP fetch + NLP analysis ────────────────────────────
        controller.enqueue(sse({ stage: "Running SERP analysis…" }));

        const serpPayload: Record<string, unknown> = { keyword: keyword.trim(), depth: 10 };
        if (location_code) serpPayload.location_code = location_code;
        if (language_code) serpPayload.language_code = language_code;

        let serpText = "";
        try {
          const serpRes = await fetch(`${DFS_BASE}/serp/google/organic/live/advanced`, {
            method: "POST",
            headers: { Authorization: `Basic ${getAuth()}`, "Content-Type": "application/json" },
            body: JSON.stringify([serpPayload]),
          });
          const serpData = await serpRes.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const items = (serpData?.tasks?.[0]?.result?.[0]?.items ?? []).filter((i: any) => i.type === "organic").slice(0, 10);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serpText = items.map((item: any, i: number) =>
            `${i + 1}. Title: ${item.title ?? ""}\nSnippet: ${item.description ?? ""}\nURL: ${item.url ?? ""}`
          ).join("\n\n");
        } catch {
          serpText = "SERP data unavailable — analyse based on keyword context only.";
        }

        const call1 = safeJson(await callClaude(
          `You are an NLP analysis engine. Analyse these SERP results and return ONLY a JSON object with:
- intent: { type: string, confidence: number, explanation: string }
- entities: string[] (named entities across all results — brands, products, organisations, certifications)
- subtopics: string[] (topical subtopics covered across results)
- serpFeatures: { name: string, available: boolean, tip: string }[]
Return only valid JSON, no markdown.`,
          `Keyword: "${keyword}"\n\nTop SERP results:\n${serpText}`,
          2000
        ), {
          intent: { type: "informational", confidence: 50, explanation: "Unable to determine intent" },
          entities: [] as string[],
          subtopics: [] as string[],
          serpFeatures: [] as { name: string; available: boolean; tip: string }[],
        });

        // ── STAGE 2: E-E-A-T + gap analysis ───────────────────────────────
        controller.enqueue(sse({ stage: "Scoring E-E-A-T…" }));

        type Eeat = { experience: number; expertise: number; authoritativeness: number; trustworthiness: number };
        type Call2 = {
          eeat: Eeat;
          missingEntities: string[];
          topicalGaps: string[];
          coveredTopics: string[];
          passiveVoiceExamples: { original: string; suggested: string }[];
          readability: { fleschKincaid: number; avgSentenceLength: number; passiveVoicePercent: number; tone: string };
          message?: string;
        };

        let call2: Call2;
        if (draft?.trim()) {
          call2 = safeJson(await callClaude(
            `You are an E-E-A-T and content gap analyser. Given this draft content and competitor data, return ONLY a JSON object with:
- eeat: { experience: number, expertise: number, authoritativeness: number, trustworthiness: number } (0-100 each)
- missingEntities: string[]
- topicalGaps: string[]
- coveredTopics: string[]
- passiveVoiceExamples: { original: string, suggested: string }[]
- readability: { fleschKincaid: number, avgSentenceLength: number, passiveVoicePercent: number, tone: string }
Return only valid JSON, no markdown.`,
            `Keyword: "${keyword}"\nDraft:\n${draft.trim().slice(0, 4000)}\n\nCompetitor entities: ${JSON.stringify(call1.entities)}\nCompetitor subtopics: ${JSON.stringify(call1.subtopics)}`,
            2000
          ), {
            eeat: { experience: 0, expertise: 0, authoritativeness: 0, trustworthiness: 0 },
            missingEntities: call1.entities,
            topicalGaps: call1.subtopics,
            coveredTopics: [],
            passiveVoiceExamples: [],
            readability: { fleschKincaid: 12, avgSentenceLength: 20, passiveVoicePercent: 0, tone: "N/A" },
          });
        } else {
          call2 = {
            eeat: { experience: 0, expertise: 0, authoritativeness: 0, trustworthiness: 0 },
            missingEntities: call1.entities ?? [],
            topicalGaps: call1.subtopics ?? [],
            coveredTopics: [],
            passiveVoiceExamples: [],
            readability: { fleschKincaid: 0, avgSentenceLength: 0, passiveVoicePercent: 0, tone: "N/A" },
            message: "Provide draft content for full analysis",
          };
        }

        // ── STAGE 3: Content brief ─────────────────────────────────────────
        controller.enqueue(sse({ stage: "Generating brief…" }));

        const call3 = safeJson(await callClaude(
          `You are a content strategist. Generate a full content brief and return ONLY a JSON object with:
- brief: { recommendedH1: string, structure: { tag: string, text: string }[], wordCount: number, tone: string, targetAudience: string }
- lsiTerms: { term: string, frequency: string, status: string }[]
- schema: string (complete JSON-LD schema markup as a string)
- internalLinkSuggestions: { anchor: string, targetPage: string, relevance: number }[]
- semanticSimilarityZone: { score: number, verdict: string, recommendation: string }
Return only valid JSON, no markdown.`,
          `Keyword: "${keyword}"\nIntent: ${JSON.stringify(call1.intent)}\nEntities: ${JSON.stringify(call1.entities)}\nSubtopics: ${JSON.stringify(call1.subtopics)}\nCovered: ${JSON.stringify(call2.coveredTopics)}\nGaps: ${JSON.stringify(call2.topicalGaps)}\nE-E-A-T: ${JSON.stringify(call2.eeat)}`,
          3000
        ), {
          brief: { recommendedH1: keyword, structure: [] as { tag: string; text: string }[], wordCount: 1500, tone: "professional", targetAudience: "general readers" },
          lsiTerms: [] as { term: string; frequency: string; status: string }[],
          schema: "",
          internalLinkSuggestions: [] as { anchor: string; targetPage: string; relevance: number }[],
          semanticSimilarityZone: { score: 50, verdict: "Moderate", recommendation: "Add more topical depth" },
        });

        // ── Overall score ──────────────────────────────────────────────────
        const hasDraft = !!draft?.trim();

        if (hasDraft) {
          // 5-factor score (draft provided)
          const totalEntities = Math.max(call1.entities?.length ?? 0, 1);
          const missing = call2.missingEntities?.length ?? 0;
          const entityDensity = Math.max(0, ((totalEntities - missing) / totalEntities) * 100);

          const totalSubtopics = Math.max(call1.subtopics?.length ?? 0, 1);
          const covered = call2.coveredTopics?.length ?? 0;
          const topicalCoverage = Math.min(100, (covered / totalSubtopics) * 100);

          const eeaVals = Object.values(call2.eeat) as number[];
          const eeaAvg = eeaVals.reduce((a, b) => a + b, 0) / Math.max(eeaVals.length, 1);

          const fk = call2.readability?.fleschKincaid ?? 12;
          const readabilityScore = Math.max(0, Math.min(100, 100 - fk * 4));

          const overallScore = Math.min(100, Math.max(0, Math.round(
            (call1.intent?.confidence ?? 50) * 0.2 +
            entityDensity * 0.25 +
            topicalCoverage * 0.25 +
            eeaAvg * 0.2 +
            readabilityScore * 0.1
          )));

          controller.enqueue(sse({ done: true, results: { ...call1, ...call2, ...call3, overallScore } }));
        } else {
          // 3-factor score (no draft — use signal richness only)
          const entityCountScore = Math.min(100, (call1.entities?.length ?? 0) / 20 * 100);
          const topicalCoverage = Math.min(100, (call1.subtopics?.length ?? 0) / 15 * 100);
          const intentScore = call1.intent?.confidence ?? 50;

          const overallScore = Math.min(100, Math.max(0, Math.round(
            intentScore * 0.4 +
            entityCountScore * 0.3 +
            topicalCoverage * 0.3
          )));

          controller.enqueue(sse({ done: true, results: { ...call1, ...call2, ...call3, overallScore } }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Analysis failed";
        console.error("[nlp/analyse] error:", message);
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
