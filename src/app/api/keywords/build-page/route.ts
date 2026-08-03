import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clusterKeywords, type KeywordClusterInput } from "@/lib/keyword-cluster";
import { findLongTailVariants, calculateSafeLongTailCount } from "@/lib/longtail-expander";
import { STAGE } from "@/lib/pages";

// Station 2 (Plan) — takes 2+ keywords the user selected together in the
// Keywords screen and creates ONE `pages` row for them (§3: one Page per
// CLUSTER, not one Page per keyword), with primary_keyword/secondary_keywords
// populated so Write can pull the full set in.
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

    const body = await req.json();
    const keywords: KeywordClusterInput[] = Array.isArray(body.keywords) ? body.keywords : [];
    const country: string = typeof body.country === "string" ? body.country : "UK";
    const targetWordCount: number = typeof body.wordCount === "number" ? body.wordCount : 2000;

    if (keywords.length < 2) {
      return NextResponse.json({ error: "Select at least 2 keywords to build a cluster brief" }, { status: 400 });
    }

    const clustered = await clusterKeywords(keywords);

    // Automatic long-tail expansion — pulls easier-to-rank variants of the
    // primary keyword so the cluster gets ranking surface area without
    // diluting the primary keyword's density (see article-master.ts's
    // LONG-TAIL KEYWORDS rule, which caps each to 1-2 mentions).
    const longTailCandidates = await findLongTailVariants(clustered.primaryKeyword, country);
    const maxToInclude = calculateSafeLongTailCount(targetWordCount);
    const longTailSuggestions = longTailCandidates.slice(0, maxToInclude);

    const allSecondaryKeywords = [
      ...clustered.secondaryKeywords,
      ...longTailSuggestions.map(lt => lt.keyword),
    ];

    const { data: page, error } = await supabase
      .from("pages")
      .insert({
        user_id: user.id,
        stage: STAGE.PLAN,
        status: "in_progress",
        primary_keyword: clustered.primaryKeyword,
        secondary_keywords: allSecondaryKeywords,
        intent: clustered.intent,
        brief_json: longTailSuggestions.length > 0 ? { longtailSources: longTailSuggestions } : null,
        last_action: `Clustered from ${keywords.length} selected keywords${longTailSuggestions.length > 0 ? ` + ${longTailSuggestions.length} long-tail variants` : ""}`,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[keywords/build-page] failed to create page:", error);
      return NextResponse.json({ error: "Failed to save cluster" }, { status: 500 });
    }

    return NextResponse.json({
      pageId: page.id,
      primaryKeyword: clustered.primaryKeyword,
      secondaryKeywords: clustered.secondaryKeywords,
      longTailSuggestions,
      intent: clustered.intent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords/build-page] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
