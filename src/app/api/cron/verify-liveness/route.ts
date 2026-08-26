import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runVerificationSweep } from '@/lib/publisher-verification-runner'
import { auditRegistryLinkRows } from '@/lib/registry-url-health'

// Same auth pattern as the existing cron routes (weekly-jobs,
// send-digests) — Authorization: Bearer ${CRON_SECRET}, checked by Vercel
// Cron's own request against this env var.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Originally scheduled every 5 minutes to be the long-tail fallback for
  // the 5m/15m/30min-ceiling backoff steps — confirmed that broke every
  // deployment on this project's Vercel Hobby plan, which only allows
  // once-per-day cron schedules (build-time failure: "Hobby accounts are
  // limited to daily Cron Jobs"). Now runs once daily (vercel.json) as a
  // slow safety net only — it will eventually clear anything stuck, but
  // not within the backoff schedule's intended timeframe. Real near-
  // real-time verification for the short steps (30s/1m/2m) still depends
  // on /api/publish/verify being polled on-demand by a client actively
  // watching a publish — no such poller is wired into any UI yet, so today
  // this daily sweep is the ONLY verification that actually runs
  // unprompted. Revisit once either the Vercel plan changes or an
  // on-demand polling UI exists.
  const result = await runVerificationSweep(supabase, { limit: 50 })

  // Same daily window: correct known-wrong registry tool URLs and deactivate
  // unreachable entries so articles cannot keep linking to 404 paths.
  let registry:
    | {
        scanned: number
        updated: number
        corrected: number
        deactivated: number
      }
    | { error: string }
    | undefined
  try {
    const { data: rows, error } = await supabase
      .from('internal_link_registry')
      .select('id, page_url, site_url, is_active')
      .eq('is_active', true)
      .limit(500)
    if (error) {
      registry = { error: error.message }
    } else {
      const { actions, updates } = await auditRegistryLinkRows(rows || [])
      let updated = 0
      for (const u of updates) {
        const patch: Record<string, unknown> = {}
        if (u.page_url !== undefined) patch.page_url = u.page_url
        if (u.site_url !== undefined) patch.site_url = u.site_url
        if (u.is_active !== undefined) patch.is_active = u.is_active
        const { error: upErr } = await supabase
          .from('internal_link_registry')
          .update(patch)
          .eq('id', u.id)
        if (!upErr) updated++
      }
      registry = {
        scanned: (rows || []).length,
        updated,
        corrected: actions.filter((a) => a.action === 'corrected').length,
        deactivated: actions.filter((a) => a.action === 'deactivated').length,
      }
    }
  } catch (err) {
    registry = {
      error: err instanceof Error ? err.message : String(err),
    }
  }

  return NextResponse.json({ ...result, registry })
}
