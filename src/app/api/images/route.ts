import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  generateArticleImages,
  injectImagesIntoArticle,
  buildImageMeta,
  type ImageTier,
} from "@/lib/image-generator";
import type { GeneratedImage } from "@/lib/image-generator";

export const maxDuration = 120;

// Maintain backward-compat with existing ImagePrompt type
interface ImageResponse {
  images: (GeneratedImage & { altText: string })[];
  hero?: GeneratedImage;
  content?: GeneratedImage[];
  mobile?: GeneratedImage;
  injectedHtml?: string;
  imageMeta?: string;
  tier: ImageTier;
  stored: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get(name: string) { return cookieStore.get(name)?.value; } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { article = "", keyword = "", tier = "free", count = 3, siteId } = await req.json();

    if (!keyword && !article) {
      return NextResponse.json({ error: "keyword or article is required" }, { status: 400 });
    }

    const topic = keyword || article.slice(0, 200);
    const imageTier = (tier === "premium" ? "premium" : "free") as ImageTier;

    const imageSet = await generateArticleImages({
      topic,
      keyword: keyword || topic,
      tier: imageTier,
      count: Math.min(Number(count) || 3, 5),
      siteId: typeof siteId === 'string' ? siteId : 'shared',
    });

    // Inject into article HTML if provided
    let injectedHtml: string | undefined;
    let imageMeta: string | undefined;
    if (article) {
      injectedHtml = injectImagesIntoArticle(article, imageSet);
      imageMeta = buildImageMeta(imageSet, keyword);
    }

    // Flatten to backward-compatible ImagePrompt shape (altText alias)
    const allImages = [imageSet.hero, ...imageSet.content].map((img) => ({
      ...img,
      altText: img.alt,  // legacy alias
    }));

    const response: ImageResponse & { niche?: string; styleDescriptor?: string } = {
      images: allImages,
      hero: imageSet.hero,
      content: imageSet.content,
      mobile: imageSet.mobile,
      injectedHtml,
      imageMeta,
      tier: imageTier,
      stored: allImages.some((img) => img.url.includes("supabase")),
      niche: imageSet.niche,
      styleDescriptor: imageSet.styleDescriptor,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[images] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
