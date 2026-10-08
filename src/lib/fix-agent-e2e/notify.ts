/**
 * Failure notifications: Resend email to MASTER_EMAIL + Sentry event.
 */

import * as Sentry from '@sentry/nextjs'

export async function notifyE2eFailure(input: {
  runId: string
  failingStep: string
  reason: string
}): Promise<{ emailOk: boolean; sentryOk: boolean }> {
  const master = process.env.MASTER_EMAIL?.trim()
  let emailOk = false
  let sentryOk = false

  try {
    Sentry.captureMessage(
      `Fix Agent e2e failed at ${input.failingStep}: ${input.reason}`,
      {
        level: 'error',
        tags: {
          e2e: 'fix_agent_fixture',
          e2e_step: input.failingStep,
        },
        extra: {
          runId: input.runId,
          failingStep: input.failingStep,
          reason: input.reason,
        },
      },
    )
    sentryOk = true
  } catch {
    sentryOk = false
  }

  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (apiKey && master) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'SEORANKO E2E <noreply@seoranko.com>',
          to: [master],
          subject: `[SEORANKO] Fix Agent e2e failed — ${input.failingStep}`,
          text: [
            `Fix Agent fixture e2e failed.`,
            ``,
            `Run id: ${input.runId}`,
            `Failing step: ${input.failingStep}`,
            `Reason: ${input.reason}`,
            ``,
            `Open /admin/fix-agent-e2e for details.`,
          ].join('\n'),
        }),
        signal: AbortSignal.timeout(20_000),
      })
      emailOk = res.ok
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        console.info('[e2e] resend failed', res.status, t.slice(0, 200))
      }
    } catch (e) {
      console.info('[e2e] resend error', e instanceof Error ? e.message : e)
    }
  } else {
    console.info('[e2e] skip email — missing RESEND_API_KEY or MASTER_EMAIL')
  }

  return { emailOk, sentryOk }
}
