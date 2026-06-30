/**
 * Manual image cleanup endpoint.
 *
 * TODO (future cron job): images not referenced by a published article after 30 days
 * should be deleted from Supabase Storage to control CDN costs. This endpoint
 * provides the manual trigger path for now; a scheduled job should call it
 * or replicate its logic on a monthly basis.
 *
 * Usage: POST /api/images/cleanup
 * Body:  { "dryRun": true }  — lists what would be deleted without deleting
 *        { "dryRun": false } — actually deletes
 *
 * Auth:  master cookie required (server-side admin only).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createHash } from "crypto";

export const maxDuration = 60;

const RETENTION_DAYS = 30;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  // Master-only endpoint
  const cookieStore = cookies();
  const masterToken = cookieStore.get("seoranko_master")?.value;
  const masterEmail = process.env.MASTER_EMAIL;
  const masterPassword = process.env.MASTER_PASSWORD;

  if (!masterEmail || !masterPassword || !masterToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expected = createHash("sha256")
    .update(`${masterEmail}:${masterPassword}:master`)
    .digest("hex");

  if (masterToken !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dryRun = true } = await req.json().catch(() => ({ dryRun: true }));
  const supabase = getSupabase();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffISO = cutoff.toISOString();

  // Find old log entries (images generated before cutoff)
  const { data: oldLogs, error: logError } = await supabase
    .from("image_generation_logs")
    .select("storage_path, created_at")
    .not("storage_path", "is", null)
    .lt("created_at", cutoffISO)
    .eq("success", true);

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  const paths = (oldLogs ?? [])
    .map((r) => r.storage_path as string)
    .filter(Boolean);

  if (paths.length === 0) {
    return NextResponse.json({ deleted: 0, dryRun, message: "Nothing to clean up" });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldDelete: paths.length,
      paths: paths.slice(0, 20), // preview first 20
      retentionDays: RETENTION_DAYS,
    });
  }

  // Delete from Storage in batches of 100
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from("article-images").remove(batch);
    if (error) {
      console.error("[images/cleanup] batch delete error:", error.message);
    } else {
      deleted += batch.length;
    }
  }

  return NextResponse.json({
    dryRun: false,
    deleted,
    total: paths.length,
    cutoff: cutoffISO,
  });
}
