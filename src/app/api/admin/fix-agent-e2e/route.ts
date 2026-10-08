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
  startOrGetE2eRun,
  tickE2eRun,
  expectedReadmeDiff,
  E2E_FIXTURE_SITE_ID,
} from '@/lib/fix-agent-e2e'

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
      const run = await startOrGetE2eRun()
      const result = await tickE2eRun({ runId: run.id })
      // Chain continue like cron when still running
      if (result.run.status === 'running' && process.env.CRON_SECRET) {
        const host =
          process.env.VERCEL_URL != null
            ? `https://${process.env.VERCEL_URL}`
            : process.env.NEXT_PUBLIC_SITE_URL || 'https://www.seoranko.com'
        void (async () => {
          await new Promise((r) => setTimeout(r, 8_000))
          await fetch(
            `${host}/api/cron/fix-agent-e2e?continue=${result.run.id}`,
            { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } },
          ).catch(() => undefined)
        })()
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
      const result = await tickE2eRun({ runId: body.runId })
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
