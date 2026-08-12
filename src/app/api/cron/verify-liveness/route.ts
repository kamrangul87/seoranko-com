import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runVerificationSweep } from '@/lib/publisher-verification-runner'

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
    process.env.SUPABASE_SERVICE_ROLE_KEY!
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
  return NextResponse.json(result)
}
