import { NextRequest, NextResponse } from "next/server";
import { editorialAudit } from "@/lib/fact-verifier";
import type { VerifiedFact } from "@/lib/fact-verifier";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { article, verified_facts, unverifiable_claims, published_pages } = await req.json();
    if (!article) {
      return NextResponse.json({ error: "article is required" }, { status: 400 });
    }
    const audit = await editorialAudit(
      article,
      (verified_facts ?? []) as VerifiedFact[],
      unverifiable_claims ?? [],
      published_pages ?? [],
    );
    return NextResponse.json({
      final_article: audit.final_article,
      article_clean: audit.article_clean,
      broken_links: audit.broken_links,
      fact_audit: audit.fact_audit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audit failed";
    console.error("[pipeline/audit]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
