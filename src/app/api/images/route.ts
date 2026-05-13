import { NextRequest, NextResponse } from "next/server";
import { callClaude, parseJsonResponse } from "@/lib/anthropic";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import type { ImagePrompt } from "@/types";

interface RawImagePrompt {
  id: string;
  placement: string;
  altText: string;
  prompt: string;
  caption: string;
}

const SYSTEM = `You are a visual content strategist. Based on an article, generate image prompts for stock-photo-style AI image generation. Return ONLY valid JSON array, no markdown.`;

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();

    // Master cookie bypass
    let master = false;
    const masterToken = cookieStore.get("seoranko_master")?.value;
    if (masterToken) {
      const masterEmail = process.env.MASTER_EMAIL;
      const masterPassword = process.env.MASTER_PASSWORD;
      if (masterEmail && masterPassword) {
        const expected = createHash("sha256")
          .update(`${masterEmail}:${masterPassword}:master`)
          .digest("hex");
        if (masterToken === expected) master = true;
      }
    }

    if (!master) {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { article, keyword } = await req.json();

    if (!article) {
      return NextResponse.json({ error: "article is required" }, { status: 400 });
    }

    const user = `Generate 3 image prompts for an article about "${keyword}".

Each prompt should be photorealistic, professional, and suitable for a B2B blog.

Return ONLY this JSON array:
[
  {
    "id": "hero",
    "placement": "Hero image (top of article)",
    "altText": "descriptive alt text for SEO",
    "prompt": "photorealistic image prompt for AI generation, detailed, professional",
    "caption": "Short image caption for the article"
  }
]

Article excerpt (first 800 chars):
${article.slice(0, 800)}`;

    const raw = await callClaude(SYSTEM, user, 1024);
    const prompts = parseJsonResponse<RawImagePrompt[]>(raw);

    const images: ImagePrompt[] = prompts.map((p) => ({
      ...p,
      url: `https://image.pollinations.ai/prompt/${encodeURIComponent(p.prompt)}?width=1200&height=600&nologo=true`,
    }));

    return NextResponse.json({ images });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[images] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
