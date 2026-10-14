/**
 * Master-only Fix Agent e2e control plane.
 * GET — status + consecutive days + recent runs
 * POST { action: 'run_now' | 'tick', runId? } — start/continue
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireMasterUser } from '@/lib/github-app/require-master'
import {
  consecutivePassingE2eDays,
  listRecentE2eRuns,
  getActiveE2eRun,
  startE2eRunIfIdle,
  tickE2eRun,
  getE2eRun,
  expectedReadmeDiff,
  E2E_FIXTURE_SITE_ID,
} from '@/lib/fix-agent-e2e'
import { scheduleE2eContinue } from '@/lib/fix-agent-e2e/schedule-continue'
import { claimTickLease } from '@/lib/run-heartbeat/claim-tick-lease'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const master = await requireMasterUser()
  if (!master.ok) {
    return NextResponse.json({ error: master.error }, { status: master.status })
  }
  try {
    const [days, recent, active] = await Promise.all([
      consecutivePassingE2eDays(),
      listRecentE2eRuns(15),
      getActiveE2eRun(),
    ])
    return NextResponse.json({
      ok: true,
      consecutivePassingDays: days,
      active,
      recent,
      fixtureSiteId: E2E_FIXTURE_SITE_ID,
      readmeDiff: expectedReadmeDiff(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Lookup failed' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const master = await requireMasterUser()
  if (!master.ok) {
    return NextResponse.json({ error: master.error }, { status: master.status })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'run_now' | 'tick'
    runId?: string
  }
  const action = body.action || 'run_now'

  try {
    if (action === 'run_now') {
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
      const claimed = await claimTickLease('e2e', started.run.id)
      if (!claimed) {
        return NextResponse.json({
          ok: true,
          run: started.run,
          advanced: false,
          done: false,
          detail: 'e2e tick lease held by another worker',
        })
      }
      const result = await tickE2eRun({ runId: started.run.id })
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
    }

    if (action === 'tick') {
      if (!body.runId) {
        return NextResponse.json({ error: 'runId required' }, { status: 400 })
      }
      const claimed = await claimTickLease('e2e', body.runId)
      if (!claimed) {
        const existing = await getE2eRun(body.runId)
        return NextResponse.json({
          ok: true,
          run: existing,
          advanced: false,
          done: false,
          detail: 'e2e tick lease held by another worker',
        })
      }
      const result = await tickE2eRun({ runId: body.runId })
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
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[admin/fix-agent-e2e]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'E2E failed' },
      { status: 500 },
    )
  }
}
