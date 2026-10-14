/**
 * Daily Fix Agent fixture e2e (Hobby: once per day).
 * Auth: Authorization: Bearer $CRON_SECRET
 * Optional ?continue=<runId> to resume a running run.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import {
  startE2eRunIfIdle,
  tickE2eRun,
  getE2eRun,
} from '@/lib/fix-agent-e2e'
import { scheduleE2eContinue } from '@/lib/fix-agent-e2e/schedule-continue'
import { claimTickLease } from '@/lib/run-heartbeat/claim-tick-lease'

export const dynamic = 'force-dynamic'
export const maxDuration = 300


export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const continueId = req.nextUrl.searchParams.get('continue')
  try {
    let runId = continueId
    if (!runId) {
      const started = await startE2eRunIfIdle()
      if (!started.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: started.error,
            code: 'already_running',
            run: started.run,
          },
          { status: 409 },
        )
      }
      runId = started.run.id
    } else {
      const existing = await getE2eRun(runId)
      if (!existing) {
        return NextResponse.json({ ok: false, error: 'Run not found' }, { status: 404 })
      }
    }

    const claimed = await claimTickLease('e2e', runId)
    if (!claimed) {
      const run = await getE2eRun(runId)
      return NextResponse.json({
        ok: true,
        run,
        advanced: false,
        done: false,
        detail: 'e2e tick lease held by another worker',
      })
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
