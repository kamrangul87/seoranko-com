/**
 * Daily Fix Agent fixture e2e (Hobby: once per day).
 * Auth: Authorization: Bearer $CRON_SECRET
 * Optional ?continue=<runId> to resume a running run.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  startOrGetE2eRun,
  tickE2eRun,
  getE2eRun,
} from '@/lib/fix-agent-e2e'
import { scheduleE2eContinue } from '@/lib/fix-agent-e2e/schedule-continue'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return unauthorized()
  }

  const continueId = req.nextUrl.searchParams.get('continue')
  try {
    let runId = continueId
    if (!runId) {
      const run = await startOrGetE2eRun()
      runId = run.id
    } else {
      const existing = await getE2eRun(runId)
      if (!existing) {
        return NextResponse.json({ ok: false, error: 'Run not found' }, { status: 404 })
      }
    }

    const result = await tickE2eRun({ runId })

    // Chain continue while still running (waitUntil keeps the delayed fetch alive).
    if (result.run.status === 'running') {
      scheduleE2eContinue({
        runId: result.run.id,
        advanced: result.advanced,
      })
    }

    return NextResponse.json({
      ok: true,
      run: result.run,
      advanced: result.advanced,
      done: result.done,
      detail: result.detail,
    })
  } catch (err) {
    console.error('[cron/fix-agent-e2e]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'e2e failed' },
      { status: 500 },
    )
  }
}
