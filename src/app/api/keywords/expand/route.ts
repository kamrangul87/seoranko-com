import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { findLongTailVariants } from "@/lib/longtail-expander";

// Manual per-keyword "Expand" — for when the user wants long-tail variants
// of a single keyword without building a full multi-keyword cluster.
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
    const keyword: string = typeof body.keyword === "string" ? body.keyword.trim() : "";
    const country: string = typeof body.country === "string" ? body.country : "UK";

    if (!keyword) {
      return NextResponse.json({ error: "keyword is required" }, { status: 400 });
    }

    const variants = await findLongTailVariants(keyword, country);
    return NextResponse.json({ variants });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[keywords/expand] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
