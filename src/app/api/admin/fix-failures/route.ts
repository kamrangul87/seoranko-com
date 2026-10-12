/**
 * Master-only Fix Agent failure ledger + circuit breaker control.
 * GET — signatures + paused types
 * POST { action: 'resume', topic, verdict }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireMasterUser } from '@/lib/github-app/require-master'
import {
  listFailureSignatures,
  listPausedFixTypes,
  resumeFixType,
  e2ePassedSince,
} from '@/lib/fix-strategies/findings-ui/fix-run/failure-learning'

export const dynamic = 'force-dynamic'

export async function GET() {
  const master = await requireMasterUser()
  if (!master.ok) {
    return NextResponse.json({ error: master.error }, { status: master.status })
  }
  try {
    const [signatures, paused] = await Promise.all([
      listFailureSignatures(100),
      listPausedFixTypes(),
    ])
    const pausedWithResume = await Promise.all(
      paused.map(async (p) => ({
        ...p,
        canResume: p.pausedAt ? await e2ePassedSince(p.pausedAt) : false,
      })),
    )
    return NextResponse.json({
      ok: true,
      signatures,
      paused: pausedWithResume,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Lookup failed' },
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
    action?: string
    topic?: string
    verdict?: string
  }
  if (body.action !== 'resume') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (!body.topic?.trim() || !body.verdict?.trim()) {
    return NextResponse.json(
      { error: 'topic and verdict required' },
      { status: 400 },
    )
  }
  const result = await resumeFixType({
    topic: body.topic.trim(),
    verdict: body.verdict.trim(),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
