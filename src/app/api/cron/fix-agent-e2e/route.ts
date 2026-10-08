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

    // Chain continue while still running. When we only waited (no advance),
    // delay the next tick to avoid overlapping reset/wait races.
    if (result.run.status === 'running') {
      const host =
        process.env.VERCEL_URL != null
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXT_PUBLIC_SITE_URL || null
      if (host && process.env.CRON_SECRET) {
        const cont = `${host}/api/cron/fix-agent-e2e?continue=${result.run.id}`
        const delayMs = result.advanced ? 500 : 20_000
        void (async () => {
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
          await fetch(cont, {
            headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
          }).catch(() => undefined)
        })()
      }
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
