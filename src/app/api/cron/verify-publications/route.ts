import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runPublicationsVerificationSweep } from '@/lib/publish-verification'

// Step 4's post-publish verification job. Same auth pattern as the other
// cron routes (weekly-jobs, send-digests, verify-liveness) — Authorization:
// Bearer ${CRON_SECRET}. Once-daily schedule only (vercel.json) — this
// project is on Vercel's Hobby plan, which rejects any cron more frequent
// than once per day (see verify-liveness/route.ts's own note on this — the
// same constraint applies here, do not add a sub-daily schedule).
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

  const result = await runPublicationsVerificationSweep(supabase, { limit: 50 })
  return NextResponse.json(result)
}
