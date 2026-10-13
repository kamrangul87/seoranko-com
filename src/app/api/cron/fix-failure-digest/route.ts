/**
 * Daily Fix Agent failure digest → MASTER_EMAIL via Resend.
 * Skips quiet days with a passing e2e (except weekly Monday summary).
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import {
  buildFailureDigestPayload,
  formatFailureDigestText,
  sendFailureDigestEmail,
  shouldSendFailureDigest,
} from '@/lib/fix-strategies/findings-ui/fix-run/failure-learning'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const denied = requireCronSecret(req)
  if (denied) return denied
  try {
    const payload = await buildFailureDigestPayload()
    if (!shouldSendFailureDigest(payload)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'quiet day — no new signatures and e2e passing',
        consecutivePassDays: payload.consecutivePassDays,
      })
    }
    const text = formatFailureDigestText(payload)
    const { emailOk } = await sendFailureDigestEmail(text)
    return NextResponse.json({
      ok: true,
      skipped: false,
      emailOk,
      newSignatures: payload.newSignatures.length,
      paused: payload.paused.length,
      consecutivePassDays: payload.consecutivePassDays,
      weeklySummary: payload.weeklySummary,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'digest failed' },
      { status: 500 },
    )
  }
}
