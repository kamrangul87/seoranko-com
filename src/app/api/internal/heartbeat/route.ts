/**
 * POST /api/internal/heartbeat
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Called every minute by Supabase pg_cron → pg_net. Advances unfinished
 * crawl / fix / e2e runs and fails frozen ones (15m no progress).
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createSupabaseHeartbeatDeps,
  runHeartbeat,
} from '@/lib/run-heartbeat'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return unauthorized()
  }

  try {
    const result = await runHeartbeat(createSupabaseHeartbeatDeps())
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[internal/heartbeat]', err)
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'heartbeat failed',
      },
      { status: 500 },
    )
  }
}

/** Allow GET with the same auth for manual curl checks. */
export async function GET(req: NextRequest) {
  return POST(req)
}
