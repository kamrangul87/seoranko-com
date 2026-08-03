import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clusterKeywords, type KeywordClusterInput } from "@/lib/keyword-cluster";
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

    if (keywords.length < 2) {
      return NextResponse.json({ error: "Select at least 2 keywords to build a cluster brief" }, { status: 400 });
    }

    const clustered = await clusterKeywords(keywords);

    const { data: page, error } = await supabase
      .from("pages")
      .insert({
        user_id: user.id,
        stage: STAGE.PLAN,
        status: "in_progress",
        primary_keyword: clustered.primaryKeyword,
        secondary_keywords: clustered.secondaryKeywords,
        intent: clustered.intent,
        last_action: `Clustered from ${keywords.length} selected keywords`,
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
      intent: clustered.intent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords/build-page] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
