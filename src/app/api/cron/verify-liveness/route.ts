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

  // This is the long-tail fallback for the 5m/15m/30min-ceiling backoff
  // steps — /api/publish/verify handles the short early steps (30s/1m/2m)
  // on-demand from a client that's actively watching. Existing crons in
  // this repo run weekly; this one needs to run far more often (every few
  // minutes) for the backoff schedule to actually mean anything — see
  // vercel.json.
  const result = await runVerificationSweep(supabase, { limit: 50 })
  return NextResponse.json(result)
}
